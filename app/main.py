import os
import re
import secrets
import hashlib
from uuid import uuid4
from datetime import datetime, timezone, date
from typing import Optional, Literal, Any

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from supabase import create_client, Client


# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
#
# NOTE ON SCHEMA:
# The real `users` table (confirmed from Supabase Table Editor) has NO
# auth_user_id / auth_provider / google_sub columns. Identity is matched
# by email only. Columns that exist:
#   id (uuid, pk)            user_id (text)          api_token_hash (text)
#   impressions_count (int8) clicks_count (int8)     earnings_usd (numeric)
#   total_paid_usd (numeric) payout_account (jsonb)  payout_status (jsonb)
#   created_at (timestamptz) updated_at (timestamptz)
#   email (text, optional)   name (text, optional)   api_token_last4 (text, optional)
# Optional additive column used for audit only (safe to add, see migration.sql):
#   token_regenerated_at (timestamptz, nullable)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

# Required to call the two admin-only endpoints below. Set this in your
# backend's environment (Render, etc.) — never in any client-side code.
ADMIN_SECRET = os.environ.get("ADMIN_SECRET", "")

ALLOWED_ORIGINS = os.environ.get("ALLOWED_ORIGINS", "*")

AD_PROVIDER = os.environ.get("AD_PROVIDER", "playayield")

CPM_USD = float(os.environ.get("CPM_USD", "0.20"))
CPC_USD = float(os.environ.get("CPC_USD", "0.00"))

USER_SHARE = float(os.environ.get("USER_SHARE", "0.70"))
HOODAI_SHARE = float(os.environ.get("HOODAI_SHARE", "0.30"))

PAYOUT_THRESHOLD_USD = float(os.environ.get("PAYOUT_THRESHOLD_USD", "10"))

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
app = FastAPI(title="HoodAI Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if ALLOWED_ORIGINS == "*" else [o.strip() for o in ALLOWED_ORIGINS.split(",")],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------

class AuthBootstrapIn(BaseModel):
    name: Optional[str] = None


class PayoutAccountIn(BaseModel):
    method: Literal["upi", "paypal", "bank_transfer", "bitcoin"]

    upi_id: Optional[str] = None

    paypal_email: Optional[str] = None

    account_holder_name: Optional[str] = None
    account_number: Optional[str] = None
    confirm_account_number: Optional[str] = None
    ifsc_code: Optional[str] = None

    bitcoin_address: Optional[str] = None
    bitcoin_network: Literal["bitcoin_mainnet"] = "bitcoin_mainnet"


class AdEventIn(BaseModel):
    ad_id: str = Field(..., min_length=1)
    ad_title: Optional[str] = None
    provider: str = Field(default=AD_PROVIDER)
    impression_id: Optional[str] = None


class PayoutRequestIn(BaseModel):
    pass


class MarkPaidIn(BaseModel):
    user_id: str = Field(..., min_length=3)
    payout_id: str = Field(..., min_length=1)


# -----------------------------------------------------------------------------
# Helpers — time / ids / tokens
# -----------------------------------------------------------------------------

def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


def month_start_utc() -> date:
    now = datetime.now(timezone.utc)
    return date(now.year, now.month, 1)


def generate_user_id() -> str:
    return f"usr_{secrets.token_urlsafe(10)}"


def generate_api_token() -> str:
    return f"hood_{secrets.token_urlsafe(32)}"


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def token_last4(token: str) -> str:
    return token[-4:]


def normalize_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    if not authorization.startswith("Bearer "):
        return None
    token = authorization[len("Bearer "):].strip()
    return token or None


def auth_error(message: str) -> HTTPException:
    return HTTPException(status_code=401, detail=message)


# -----------------------------------------------------------------------------
# Helpers — masking / validation
# -----------------------------------------------------------------------------

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
BITCOIN_RE = re.compile(r"^(bc1[a-z0-9]{25,59}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$")


def mask_tail(value: Optional[str], keep: int = 4) -> Optional[str]:
    if not value:
        return value
    if len(value) <= keep:
        return "*" * len(value)
    return "*" * (len(value) - keep) + value[-keep:]


def masked_payout_account(account: dict) -> dict:
    """Never return raw bank account numbers or full bitcoin addresses."""
    if not account:
        return {}

    safe = dict(account)

    if safe.get("account_number"):
        safe["account_number"] = mask_tail(safe["account_number"])

    if safe.get("bitcoin_address"):
        addr = safe["bitcoin_address"]
        safe["bitcoin_address"] = (addr[:6] + "…" + addr[-4:]) if len(addr) > 12 else mask_tail(addr)

    return safe


# -----------------------------------------------------------------------------
# Helpers — user lookup (email-based, matches real schema)
# -----------------------------------------------------------------------------

def get_user_by_token(token: str) -> Optional[dict]:
    token_hash = hash_token(token)
    res = (
        supabase.table("users")
        .select("*")
        .eq("api_token_hash", token_hash)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def get_user_by_id(user_id: str) -> Optional[dict]:
    res = (
        supabase.table("users")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def get_user_by_email(email: str) -> Optional[dict]:
    res = (
        supabase.table("users")
        .select("*")
        .eq("email", email)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


def require_user_from_token(authorization: Optional[str]) -> dict:
    """Strict HoodAI API-token auth. Used only by VS Code extension endpoints."""
    token = normalize_bearer_token(authorization)
    if not token:
        raise auth_error("Missing Bearer token")

    user = get_user_by_token(token)
    if not user:
        raise auth_error("Invalid token")

    return user


def resolve_user(authorization: Optional[str]) -> dict:
    """
    Dual authentication for dashboard-facing endpoints:

    1. Tries the value as a HoodAI API token first (works for anyone who
       still has it saved).
    2. Falls back to a Supabase Auth session access token — the session
       supabase-js already persists in the browser — resolved to the
       matching HoodAI profile by email.

    This is account recovery layered on the SAME token system, not a
    second auth system: the Supabase session (the root identity for the
    account) is what lets a signed-in user reach their dashboard, or
    regenerate a new HoodAI token, even if they never saved the old one
    or are on a new device.
    """
    token = normalize_bearer_token(authorization)
    if not token:
        raise auth_error("Missing Bearer token")

    user = get_user_by_token(token)
    if user:
        return user

    try:
        auth_user = get_supabase_auth_user(authorization)
    except HTTPException:
        raise auth_error("Invalid token")

    email = get_auth_user_email(auth_user)
    user = get_user_by_email(email)
    if not user:
        raise auth_error("No HoodAI profile found for this account")

    return user


def require_admin(x_admin_secret: Optional[str]) -> None:
    if not ADMIN_SECRET or not x_admin_secret or not secrets.compare_digest(x_admin_secret, ADMIN_SECRET):
        raise HTTPException(status_code=401, detail="Admin authentication required")


def payout_state(user: dict) -> dict:
    raw = user.get("payout_status")
    return raw if isinstance(raw, dict) else {"current": "none", "history": []}


def payout_account(user: dict) -> dict:
    raw = user.get("payout_account")
    return raw if isinstance(raw, dict) else {}


def can_withdraw(user: dict) -> bool:
    return float(user.get("earnings_usd", 0.0)) >= PAYOUT_THRESHOLD_USD


def append_payout_history(user: dict, entry: dict) -> list:
    state = payout_state(user)
    history = list(state.get("history", []))
    history.append(entry)
    return history


def public_user_payload(user: dict) -> dict:
    """Shared shape for /auth/bootstrap, /auth/me. Name always comes
    straight from the users table, never invented client-side."""
    return {
        "user_id": user["user_id"],
        "email": user.get("email"),
        "name": user.get("name"),
        "earnings_usd": float(user.get("earnings_usd", 0.0)),
        "impressions_count": int(user.get("impressions_count", 0)),
        "clicks_count": int(user.get("clicks_count", 0)),
        "total_paid_usd": float(user.get("total_paid_usd", 0.0)),
        "payout_account": masked_payout_account(payout_account(user)),
        "payout_status": payout_state(user),
        "api_token_last4": user.get("api_token_last4"),
        "created_at": user.get("created_at"),
    }


# -----------------------------------------------------------------------------
# Supabase Auth verification (for /auth/bootstrap only)
# -----------------------------------------------------------------------------

def get_supabase_auth_user(authorization: Optional[str]) -> dict:
    """
    Verifies the Supabase Auth session access token (NOT the HoodAI API
    token). Supabase Auth owns password/session verification entirely —
    this backend never sees or stores a password.
    """
    token = normalize_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing Supabase access token")

    try:
        response = supabase.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired Supabase session")

    auth_user = getattr(response, "user", None)
    if not auth_user:
        raise HTTPException(status_code=401, detail="Invalid Supabase user")

    return auth_user


def get_auth_user_email(auth_user: object) -> str:
    email = getattr(auth_user, "email", None)
    if not email:
        raise HTTPException(status_code=400, detail="Authenticated account has no email")
    return email.strip().lower()


def get_auth_user_name(auth_user: object) -> Optional[str]:
    metadata = getattr(auth_user, "user_metadata", None) or {}
    return metadata.get("name") or metadata.get("full_name") or metadata.get("display_name")


def get_or_create_hoodai_user(auth_user: object, name: Optional[str] = None) -> tuple[dict, Optional[str]]:
    email = get_auth_user_email(auth_user)
    profile_name = name.strip() if (name and name.strip()) else get_auth_user_name(auth_user)

    existing = get_user_by_email(email)

    if existing:
        patch: dict[str, Any] = {"updated_at": now_utc()}
        if profile_name and not existing.get("name"):
            patch["name"] = profile_name

        updated = (
            supabase.table("users")
            .update(patch)
            .eq("user_id", existing["user_id"])
            .execute()
        )
        return updated.data[0], None

    user_id = generate_user_id()
    api_token = generate_api_token()

    row = {
        "user_id": user_id,
        "email": email,
        "name": profile_name,
        "api_token_hash": hash_token(api_token),
        "api_token_last4": token_last4(api_token),
        "impressions_count": 0,
        "clicks_count": 0,
        "earnings_usd": 0.0,
        "total_paid_usd": 0.0,
        "payout_account": {},
        "payout_status": {"current": "none", "history": []},
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }

    created = supabase.table("users").insert(row).execute()
    if not created.data:
        raise HTTPException(status_code=500, detail="Failed to create HoodAI profile")

    return created.data[0], api_token


# -----------------------------------------------------------------------------
# Ad event helpers
# -----------------------------------------------------------------------------

def save_event(
    *,
    user_id: str,
    ad_id: str,
    ad_title: Optional[str],
    provider: str,
    event_type: str,
    impression_id: Optional[str],
    estimated_value: float,
):
    supabase.table("ad_events").insert({
        "user_id": user_id,
        "provider": provider,
        "ad_id": ad_id,
        "ad_title": ad_title,
        "event_type": event_type,
        "impression_id": impression_id,
        "estimated_value_usd": estimated_value,
        "cpm_usd": CPM_USD,
        "cpc_usd": CPC_USD,
        "user_share": USER_SHARE,
        "hoodai_share": HOODAI_SHARE,
        "created_at": now_utc(),
    }).execute()


def update_user_totals(user: dict, *, impression: bool = False, click: bool = False, earnings_delta: float = 0.0):
    patch: dict[str, Any] = {}

    if impression:
        patch["impressions_count"] = int(user.get("impressions_count", 0)) + 1

    if click:
        patch["clicks_count"] = int(user.get("clicks_count", 0)) + 1

    patch["earnings_usd"] = round(float(user.get("earnings_usd", 0.0)) + earnings_delta, 6)
    patch["updated_at"] = now_utc()

    updated = supabase.table("users").update(patch).eq("user_id", user["user_id"]).execute()
    if not updated.data:
        raise HTTPException(status_code=500, detail="Failed to update user totals")

    return updated.data[0]


def impression_estimate() -> float:
    return (CPM_USD / 1000.0) * USER_SHARE


def click_estimate() -> float:
    return CPC_USD * USER_SHARE


# -----------------------------------------------------------------------------
# POST /auth/bootstrap
# -----------------------------------------------------------------------------

@app.post("/auth/bootstrap")
def auth_bootstrap(payload: AuthBootstrapIn, authorization: str = Header(...)):
    """
    Called right after Supabase signup/login succeeds.
    Authorization here is the SUPABASE session access token, not the
    HoodAI API token.
    """
    auth_user = get_supabase_auth_user(authorization)
    user, api_token = get_or_create_hoodai_user(auth_user=auth_user, name=payload.name)

    response = {"success": True, "user": public_user_payload(user)}

    # Only returned the moment the HoodAI profile is first created.
    if api_token:
        response["api_token"] = api_token
        response["warning"] = "Save your HoodAI API token now. It will not be shown again."

    return response


# -----------------------------------------------------------------------------
# GET /auth/me
# -----------------------------------------------------------------------------

@app.get("/auth/me")
def auth_me(authorization: str = Header(...)):
    """Accepts either a HoodAI API token or a Supabase session token."""
    user = resolve_user(authorization)
    return {"success": True, "user": public_user_payload(user)}


# -----------------------------------------------------------------------------
# POST /auth/verify
# -----------------------------------------------------------------------------

@app.post("/auth/verify")
def auth_verify(authorization: str = Header(...)):
    """Used by the VS Code extension to confirm its stored token still works."""
    user = require_user_from_token(authorization)
    return {
        "success": True,
        "user_id": user["user_id"],
        "email": user.get("email"),
        "name": user.get("name"),
        "api_token_last4": user.get("api_token_last4"),
    }


# -----------------------------------------------------------------------------
# POST /auth/regenerate-token
# -----------------------------------------------------------------------------

@app.post("/auth/regenerate-token")
def auth_regenerate_token(authorization: str = Header(...)):
    """
    Accepts either the current HoodAI API token OR the Supabase session
    token — so a signed-in user can always get a fresh token even if
    they never saved the old one. Generates a brand-new token, hashes
    it, replaces the stored hash/last4, and returns the raw token
    exactly once. The old token stops working immediately.
    """
    user = resolve_user(authorization)

    new_token = generate_api_token()

    patch = {
        "api_token_hash": hash_token(new_token),
        "api_token_last4": token_last4(new_token),
        "token_regenerated_at": now_utc(),
        "updated_at": now_utc(),
    }

    updated = supabase.table("users").update(patch).eq("user_id", user["user_id"]).execute()
    if not updated.data:
        raise HTTPException(status_code=500, detail="Failed to regenerate token")

    return {
        "success": True,
        "api_token": new_token,
        "api_token_last4": token_last4(new_token),
        "message": "API token regenerated successfully. Update your HoodAI extension.",
    }


# -----------------------------------------------------------------------------
# Ads
# -----------------------------------------------------------------------------

@app.get("/ad/next")
def ad_next(authorization: str = Header(...)):
    require_user_from_token(authorization)

    # Placeholder ad — replace with a real PlayaYield fetch when ready.
    return {
        "ad_id": "test-001",
        "provider": "Higgsfield AI",
        "title": "Sponsored",
        "text": "Get Free Higgsfield AI.",
        "image": "https://via.placeholder.com/1200x630.png?text=Sponsored",
        "link": "https://higgsfield.ai/",
    }


@app.post("/ad/impression")
def ad_impression(payload: AdEventIn, authorization: str = Header(...)):
    user = require_user_from_token(authorization)
    value = impression_estimate()

    save_event(
        user_id=user["user_id"], ad_id=payload.ad_id, ad_title=payload.ad_title,
        provider=payload.provider, event_type="impression",
        impression_id=payload.impression_id, estimated_value=value,
    )
    updated = update_user_totals(user, impression=True, earnings_delta=value)

    return {
        "success": True,
        "credited_estimate": value,
        "impressions": updated["impressions_count"],
        "balance": updated["earnings_usd"],
    }


@app.post("/ad/click")
def ad_click(payload: AdEventIn, authorization: str = Header(...)):
    user = require_user_from_token(authorization)
    value = click_estimate()

    save_event(
        user_id=user["user_id"], ad_id=payload.ad_id, ad_title=payload.ad_title,
        provider=payload.provider, event_type="click",
        impression_id=payload.impression_id, estimated_value=value,
    )
    updated = update_user_totals(user, click=True, earnings_delta=value)

    return {
        "success": True,
        "credited_estimate": value,
        "clicks": updated["clicks_count"],
        "balance": updated["earnings_usd"],
    }


# -----------------------------------------------------------------------------
# Stats
# -----------------------------------------------------------------------------

@app.get("/stats/me")
def stats_me(authorization: str = Header(...)):
    user = resolve_user(authorization)

    events_res = (
        supabase.table("ad_events")
        .select("*")
        .eq("user_id", user["user_id"])
        .order("created_at", desc=False)
        .execute()
    )
    events = events_res.data or []

    today = today_utc()
    month_start = month_start_utc()

    today_impressions = 0
    today_clicks = 0
    today_earnings = 0.0

    month_impressions = 0
    month_clicks = 0
    month_earnings = 0.0

    series_map: dict[str, dict[str, float | int]] = {}

    for e in events:
        created_at_raw = e.get("created_at")
        try:
            created_at = datetime.fromisoformat(str(created_at_raw).replace("Z", "+00:00"))
        except Exception:
            continue

        created_date = created_at.date()
        day_key = created_date.isoformat()

        if day_key not in series_map:
            series_map[day_key] = {"date": day_key, "impressions": 0, "clicks": 0, "earnings_usd": 0.0}

        series_map[day_key]["earnings_usd"] = round(
            float(series_map[day_key]["earnings_usd"]) + float(e.get("estimated_value_usd", 0.0)), 6
        )

        if e.get("event_type") == "impression":
            series_map[day_key]["impressions"] = int(series_map[day_key]["impressions"]) + 1
            if created_date == today:
                today_impressions += 1
                today_earnings += float(e.get("estimated_value_usd", 0.0))
            if created_date >= month_start:
                month_impressions += 1
                month_earnings += float(e.get("estimated_value_usd", 0.0))

        elif e.get("event_type") == "click":
            series_map[day_key]["clicks"] = int(series_map[day_key]["clicks"]) + 1
            if created_date == today:
                today_clicks += 1
                today_earnings += float(e.get("estimated_value_usd", 0.0))
            if created_date >= month_start:
                month_clicks += 1
                month_earnings += float(e.get("estimated_value_usd", 0.0))

    series = list(series_map.values())

    return {
        "success": True,
        "user": {
            "user_id": user["user_id"],
            "email": user.get("email"),
            "name": user.get("name"),
            "balance_usd": float(user.get("earnings_usd", 0.0)),
            "total_paid_usd": float(user.get("total_paid_usd", 0.0)),
            "withdraw_enabled": can_withdraw(user),
            "payout_account": masked_payout_account(payout_account(user)),
            "payout_status": payout_state(user),
            "api_token_last4": user.get("api_token_last4"),
        },
        "today": {
            "earnings_usd": round(today_earnings, 6),
            "impressions": today_impressions,
            "clicks": today_clicks,
        },
        "month": {
            "earnings_usd": round(month_earnings, 6),
            "impressions": month_impressions,
            "clicks": month_clicks,
        },
        "graph": series[-30:],
        "payout_threshold_usd": PAYOUT_THRESHOLD_USD,
    }


# -----------------------------------------------------------------------------
# Admin-only: full user dashboard (was PUBLIC — now locked behind admin secret)
# -----------------------------------------------------------------------------

@app.get("/dashboard")
def dashboard(x_admin_secret: Optional[str] = Header(None)):
    require_admin(x_admin_secret)

    rows = supabase.table("users").select("*").order("earnings_usd", desc=True).execute()
    users = rows.data or []

    return {
        "totals": {
            "users": len(users),
            "impressions_total": sum(int(u.get("impressions_count", 0)) for u in users),
            "clicks_total": sum(int(u.get("clicks_count", 0)) for u in users),
            "earnings_usd": round(sum(float(u.get("earnings_usd", 0.0)) for u in users), 6),
            "paid_usd": round(sum(float(u.get("total_paid_usd", 0.0)) for u in users), 6),
        },
        "users": users,
    }


# -----------------------------------------------------------------------------
# Payout account
# -----------------------------------------------------------------------------

@app.post("/account/payout-account")
def set_payout_account(payload: PayoutAccountIn, authorization: str = Header(...)):
    user = resolve_user(authorization)

    details: dict[str, Any] = {"method": payload.method, "updated_at": now_utc()}

    if payload.method == "upi":
        if not payload.upi_id or "@" not in payload.upi_id:
            raise HTTPException(status_code=400, detail="A valid UPI ID is required (e.g. name@bank)")
        details["upi_id"] = payload.upi_id.strip()

    elif payload.method == "paypal":
        if not payload.paypal_email or not EMAIL_RE.match(payload.paypal_email):
            raise HTTPException(status_code=400, detail="A valid PayPal email is required")
        details["paypal_email"] = payload.paypal_email.strip().lower()

    elif payload.method == "bank_transfer":
        if not payload.account_holder_name or not payload.account_holder_name.strip():
            raise HTTPException(status_code=400, detail="Account holder name is required")
        if not payload.account_number or not payload.account_number.strip():
            raise HTTPException(status_code=400, detail="Account number is required")
        if payload.confirm_account_number != payload.account_number:
            raise HTTPException(status_code=400, detail="Account numbers do not match")
        if not payload.ifsc_code or not IFSC_RE.match(payload.ifsc_code.strip().upper()):
            raise HTTPException(status_code=400, detail="IFSC code format is invalid")

        details["account_holder_name"] = payload.account_holder_name.strip()
        details["account_number"] = payload.account_number.strip()
        details["ifsc_code"] = payload.ifsc_code.strip().upper()
        # confirm_account_number is intentionally never stored.

    elif payload.method == "bitcoin":
        addr = (payload.bitcoin_address or "").strip()
        if not addr or not BITCOIN_RE.match(addr):
            raise HTTPException(status_code=400, detail="Bitcoin address format looks invalid")
        details["bitcoin_address"] = addr
        details["bitcoin_network"] = "bitcoin_mainnet"

    supabase.table("users").update({
        "payout_account": details,
        "updated_at": now_utc(),
    }).eq("user_id", user["user_id"]).execute()

    return {"success": True, "payout_account": masked_payout_account(details)}


# -----------------------------------------------------------------------------
# Payouts
# -----------------------------------------------------------------------------

@app.post("/payout/request")
def payout_request(payload: PayoutRequestIn, authorization: str = Header(...)):
    user = resolve_user(authorization)
    state = payout_state(user)
    balance = float(user.get("earnings_usd", 0.0))
    account = payout_account(user)

    if balance < PAYOUT_THRESHOLD_USD:
        raise HTTPException(status_code=400, detail=f"Balance is below the ${PAYOUT_THRESHOLD_USD:g} threshold")

    if not account.get("method"):
        raise HTTPException(status_code=400, detail="Add a payout method before requesting a payout")

    if state.get("current") == "pending":
        raise HTTPException(status_code=409, detail="A payout is already pending")

    payout_id = f"pay_{uuid4().hex}"

    entry = {
        "id": payout_id,
        "amount_usd": round(balance, 6),
        "method": account.get("method"),
        "status": "pending",
        "requested_at": now_utc(),
        "details": masked_payout_account(account),
    }

    new_history = append_payout_history(user, entry)

    supabase.table("users").update({
        "payout_status": {"current": "pending", "history": new_history},
        "updated_at": now_utc(),
    }).eq("user_id", user["user_id"]).execute()

    return {
        "success": True,
        "payout_id": payout_id,
        "status": "pending",
        "amount_usd": round(balance, 6),
        "method": account.get("method"),
    }


# -----------------------------------------------------------------------------
# Admin-only: mark a payout paid (was callable by any logged-in user — fixed)
# -----------------------------------------------------------------------------

@app.post("/payout/mark-paid")
def payout_mark_paid(payload: MarkPaidIn, x_admin_secret: Optional[str] = Header(None)):
    require_admin(x_admin_secret)

    user = get_user_by_id(payload.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    state = payout_state(user)
    history = list(state.get("history", []))

    target = None
    target_index = None
    for i in range(len(history) - 1, -1, -1):
        if history[i].get("id") == payload.payout_id:
            target = history[i]
            target_index = i
            break

    if not target:
        raise HTTPException(status_code=404, detail="Payout request not found")

    if target.get("status") == "paid":
        return {"success": True, "already_paid": True}

    amount = float(target.get("amount_usd", 0.0))
    current_balance = float(user.get("earnings_usd", 0.0))

    if current_balance < amount:
        raise HTTPException(status_code=400, detail="Insufficient balance to mark paid")

    target["status"] = "paid"
    target["paid_at"] = now_utc()
    history[target_index] = target

    new_paid_total = float(user.get("total_paid_usd", 0.0)) + amount
    new_balance = current_balance - amount

    supabase.table("users").update({
        "earnings_usd": round(new_balance, 6),
        "total_paid_usd": round(new_paid_total, 6),
        "payout_status": {"current": "paid", "history": history},
        "updated_at": now_utc(),
    }).eq("user_id", user["user_id"]).execute()

    return {
        "success": True,
        "payout_id": payload.payout_id,
        "status": "paid",
        "amount_usd": round(amount, 6),
        "new_balance_usd": round(new_balance, 6),
    }


# -----------------------------------------------------------------------------
# Health
# -----------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok"}
