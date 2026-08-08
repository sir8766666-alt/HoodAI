import os
import secrets
import hashlib
from uuid import uuid4
from datetime import datetime, timezone, date
from typing import Optional, Literal, Any

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel, Field
from supabase import create_client, Client


# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

AD_PROVIDER = os.environ.get("AD_PROVIDER", "playayield")

CPM_USD = float(os.environ.get("CPM_USD", "0.20"))
CPC_USD = float(os.environ.get("CPC_USD", "0.00"))

USER_SHARE = float(os.environ.get("USER_SHARE", "0.70"))
HOODAI_SHARE = float(os.environ.get("HOODAI_SHARE", "0.30"))

PAYOUT_THRESHOLD_USD = float(os.environ.get("PAYOUT_THRESHOLD_USD", "10"))

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
app = FastAPI(title="HoodAI Backend")


# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------

class SignupIn(BaseModel):
    name: str
    email: str
    password: str
    auth_provider: Literal["email", "google"] = "email"


class VerifyIn(BaseModel):
    pass


class PayoutAccountIn(BaseModel):
    method: Literal["upi", "paypal"]
    upi_id: Optional[str] = None
    paypal_email: Optional[str] = None
    name_on_account: Optional[str] = None


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
# Helpers
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


def require_user_from_token(authorization: Optional[str]) -> dict:
    token = normalize_bearer_token(authorization)
    if not token:
        raise auth_error("Missing Bearer token")

    user = get_user_by_token(token)
    if not user:
        raise auth_error("Invalid token")

    return user


def create_user_row(
    email: str,
    name: Optional[str] = None,
    auth_provider: str = "email",
    auth_user_id: Optional[str] = None,
) -> tuple[dict, str]:
    user_id = generate_user_id()
    api_token = generate_api_token()

    row = {
        "auth_user_id": auth_user_id,
        "user_id": user_id,
        "email": email,
        "name": name,
        "auth_provider": auth_provider,
        "google_sub": auth_user_id if auth_provider == "google" else None,
        "api_token_hash": hash_token(api_token),
        "api_token_last4": token_last4(api_token),
        "impressions_count": 0,
        "clicks_count": 0,
        "earnings_usd": 0.0,
        "total_paid_usd": 0.0,
        "payout_account": {},
        "payout_status": {
            "current": "none",
            "history": [],
        },
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }

    created = supabase.table("users").insert(row).execute()
    if not created.data:
        raise HTTPException(status_code=500, detail="Failed to create user")
    return created.data[0], api_token


def bootstrap_user_row(
    email: str,
    name: Optional[str] = None,
    auth_provider: str = "email",
    auth_user_id: Optional[str] = None,
) -> tuple[dict, Optional[str]]:
    existing = (
        supabase.table("users")
        .select("*")
        .eq("email", email)
        .limit(1)
        .execute()
    )

    if existing.data:
        user = existing.data[0]
        patch: dict[str, Any] = {
            "updated_at": now_utc(),
        }

        if name and not user.get("name"):
            patch["name"] = name

        if auth_user_id and not user.get("auth_user_id"):
            patch["auth_user_id"] = auth_user_id

        if auth_provider and not user.get("auth_provider"):
            patch["auth_provider"] = auth_provider

        updated = (
            supabase.table("users")
            .update(patch)
            .eq("user_id", user["user_id"])
            .execute()
        )

        return updated.data[0], None

    user, api_token = create_user_row(
        email=email,
        name=name,
        auth_provider=auth_provider,
        auth_user_id=auth_user_id,
    )
    return user, api_token


def payout_state(user: dict) -> dict:
    raw = user.get("payout_status")
    return raw if isinstance(raw, dict) else {"current": "none", "history": []}


def payout_account(user: dict) -> dict:
    raw = user.get("payout_account")
    return raw if isinstance(raw, dict) else {}


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


def update_user_totals(
    user: dict,
    *,
    impression: bool = False,
    click: bool = False,
    earnings_delta: float = 0.0,
):
    patch: dict[str, Any] = {}

    if impression:
        patch["impressions_count"] = int(user.get("impressions_count", 0)) + 1

    if click:
        patch["clicks_count"] = int(user.get("clicks_count", 0)) + 1

    patch["earnings_usd"] = round(float(user.get("earnings_usd", 0.0)) + earnings_delta, 6)
    patch["updated_at"] = now_utc()

    updated = (
        supabase.table("users")
        .update(patch)
        .eq("user_id", user["user_id"])
        .execute()
    )

    if not updated.data:
        raise HTTPException(status_code=500, detail="Failed to update user totals")

    return updated.data[0]


def impression_estimate() -> float:
    return (CPM_USD / 1000.0) * USER_SHARE


def click_estimate() -> float:
    return CPC_USD * USER_SHARE


def can_withdraw(user: dict) -> bool:
    return float(user.get("earnings_usd", 0.0)) >= PAYOUT_THRESHOLD_USD


def append_payout_history(user: dict, entry: dict) -> list:
    state = payout_state(user)
    history = list(state.get("history", []))
    history.append(entry)
    return history


# -----------------------------------------------------------------------------
# Authentication
# -----------------------------------------------------------------------------

class AuthBootstrapIn(BaseModel):
    name: Optional[str] = None


def get_supabase_auth_user(authorization: Optional[str]) -> dict:
    """
    Verifies the Supabase Auth access token.

    Supabase Auth handles:
    - email/password verification
    - Google authentication
    - session/JWT validation

    This backend never stores or checks passwords itself.
    """

    token = normalize_bearer_token(authorization)

    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing Supabase access token"
        )

    try:
        response = supabase.auth.get_user(token)
    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired Supabase session"
        )

    auth_user = getattr(response, "user", None)

    if not auth_user:
        raise HTTPException(
            status_code=401,
            detail="Invalid Supabase user"
        )

    return auth_user


def get_auth_user_email(auth_user: object) -> str:
    email = getattr(auth_user, "email", None)

    if not email:
        raise HTTPException(
            status_code=400,
            detail="Authenticated account has no email"
        )

    return email.strip().lower()


def get_auth_user_name(auth_user: object) -> Optional[str]:
    metadata = getattr(auth_user, "user_metadata", None) or {}

    return (
        metadata.get("name")
        or metadata.get("full_name")
        or metadata.get("display_name")
    )


def get_or_create_hoodai_user(
    auth_user: object,
    name: Optional[str] = None,
) -> tuple[dict, Optional[str]]:

    auth_user_id = str(getattr(auth_user, "id"))
    email = get_auth_user_email(auth_user)

    profile_name = (
        name.strip()
        if name and name.strip()
        else get_auth_user_name(auth_user)
    )

    # ---------------------------------------------------------
    # IMPORTANT:
    # Identity is checked by Supabase Auth user ID first.
    # Email is also checked to prevent duplicate profiles.
    # ---------------------------------------------------------

    existing = (
        supabase.table("users")
        .select("*")
        .eq("auth_user_id", auth_user_id)
        .limit(1)
        .execute()
    )

    if existing.data:
        user = existing.data[0]

        patch = {
            "email": email,
            "updated_at": now_utc(),
        }

        if profile_name:
            patch["name"] = profile_name

        updated = (
            supabase.table("users")
            .update(patch)
            .eq("user_id", user["user_id"])
            .execute()
        )

        return updated.data[0], None

    # ---------------------------------------------------------
    # Fallback email check.
    # This protects older users created before auth_user_id
    # was added.
    # ---------------------------------------------------------

    existing_email = (
        supabase.table("users")
        .select("*")
        .eq("email", email)
        .limit(1)
        .execute()
    )

    if existing_email.data:
        user = existing_email.data[0]

        patch = {
            "auth_user_id": auth_user_id,
            "email": email,
            "updated_at": now_utc(),
        }

        if profile_name:
            patch["name"] = profile_name

        updated = (
            supabase.table("users")
            .update(patch)
            .eq("user_id", user["user_id"])
            .execute()
        )

        return updated.data[0], None

    # ---------------------------------------------------------
    # Brand-new HoodAI profile
    # ---------------------------------------------------------

    user_id = generate_user_id()
    api_token = generate_api_token()

    row = {
        "auth_user_id": auth_user_id,
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
        "payout_status": {
            "current": "none",
            "history": [],
        },

        "created_at": now_utc(),
        "updated_at": now_utc(),
    }

    created = (
        supabase.table("users")
        .insert(row)
        .execute()
    )

    if not created.data:
        raise HTTPException(
            status_code=500,
            detail="Failed to create HoodAI profile"
        )

    return created.data[0], api_token


# -----------------------------------------------------------------------------
# POST /auth/bootstrap
# -----------------------------------------------------------------------------

@app.post("/auth/bootstrap")
def auth_bootstrap(
    payload: AuthBootstrapIn,
    authorization: str = Header(...)
):
    """
    Called immediately after successful Supabase signup/login.

    Supabase has already authenticated:
        email + password
        OR
        Google

    This endpoint creates/loads the HoodAI profile.
    """

    auth_user = get_supabase_auth_user(authorization)

    user, api_token = get_or_create_hoodai_user(
        auth_user=auth_user,
        name=payload.name,
    )

    response = {
        "success": True,
        "user": {
            "user_id": user["user_id"],
            "email": user["email"],
            "name": user.get("name"),

            "earnings_usd": float(
                user.get("earnings_usd", 0)
            ),

            "impressions_count": int(
                user.get("impressions_count", 0)
            ),

            "clicks_count": int(
                user.get("clicks_count", 0)
            ),

            "total_paid_usd": float(
                user.get("total_paid_usd", 0)
            ),

            "payout_account": user.get(
                "payout_account", {}
            ),

            "payout_status": user.get(
                "payout_status",
                {
                    "current": "none",
                    "history": [],
                }
            ),

            "api_token_last4": user.get(
                "api_token_last4"
            ),
        },
    }

    # API token is returned ONLY when the HoodAI
    # profile is created for the first time.
    if api_token:
        response["api_token"] = api_token
        response["warning"] = (
            "Save your HoodAI API token now. "
            "It will not be shown again."
        )

    return response


# -----------------------------------------------------------------------------
# GET /auth/me
# -----------------------------------------------------------------------------

@app.get("/auth/me")
def auth_me(
    authorization: str = Header(...)
):
    """
    Used by the dashboard after it has a HoodAI API token.

    Returns the complete HoodAI profile.
    """

    user = require_user_from_token(authorization)

    return {
        "success": True,
        "user": {
            "user_id": user["user_id"],
            "email": user["email"],
            "name": user.get("name"),

            "earnings_usd": float(
                user.get("earnings_usd", 0)
            ),

            "impressions_count": int(
                user.get("impressions_count", 0)
            ),

            "clicks_count": int(
                user.get("clicks_count", 0)
            ),

            "total_paid_usd": float(
                user.get("total_paid_usd", 0)
            ),

            "payout_account": user.get(
                "payout_account", {}
            ),

            "payout_status": user.get(
                "payout_status",
                {
                    "current": "none",
                    "history": [],
                }
            ),

            "api_token_last4": user.get(
                "api_token_last4"
            ),

            "created_at": user.get(
                "created_at"
            ),
        },
    }


# -----------------------------------------------------------------------------
# POST /auth/verify
# -----------------------------------------------------------------------------

@app.post("/auth/verify")
def auth_verify(
    authorization: str = Header(...)
):
    """
    Used by the VS Code extension.

    IMPORTANT:
    This verifies the HoodAI API token,
    NOT the user's password.
    """

    user = require_user_from_token(authorization)

    return {
        "success": True,
        "user_id": user["user_id"],
        "email": user["email"],
        "name": user.get("name"),
        "api_token_last4": user.get("api_token_last4"),
    }

# -----------------------------------------------------------------------------
# Ads
# -----------------------------------------------------------------------------

@app.get("/ad/next")
def ad_next(authorization: str = Header(...)):
    user = require_user_from_token(authorization)
    if not user:
        raise auth_error("Invalid token")

    # Replace this later with PlayaYield live ad fetch logic
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
        user_id=user["user_id"],
        ad_id=payload.ad_id,
        ad_title=payload.ad_title,
        provider=payload.provider,
        event_type="impression",
        impression_id=payload.impression_id,
        estimated_value=value,
    )

    updated = update_user_totals(
        user,
        impression=True,
        earnings_delta=value,
    )

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
        user_id=user["user_id"],
        ad_id=payload.ad_id,
        ad_title=payload.ad_title,
        provider=payload.provider,
        event_type="click",
        impression_id=payload.impression_id,
        estimated_value=value,
    )

    updated = update_user_totals(
        user,
        click=True,
        earnings_delta=value,
    )

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
    user = require_user_from_token(authorization)

    # Pull all events for this user and compute aggregates in Python for MVP
    events_res = (
        supabase.table("ad_events")
        .select("*")
        .eq("user_id", user["user_id"])
        .order("created_at", desc=False)
        .execute()
    )

    events = events_res.data or []

    now = datetime.now(timezone.utc)
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
            series_map[day_key] = {
                "date": day_key,
                "impressions": 0,
                "clicks": 0,
                "earnings_usd": 0.0,
            }

        series_map[day_key]["earnings_usd"] = round(
            float(series_map[day_key]["earnings_usd"]) + float(e.get("estimated_value_usd", 0.0)),
            6,
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
            "email": user["email"],
            "name": user.get("name"),
            "balance_usd": float(user.get("earnings_usd", 0.0)),
            "total_paid_usd": float(user.get("total_paid_usd", 0.0)),
            "withdraw_enabled": can_withdraw(user),
            "payout_account": payout_account(user),
            "payout_status": payout_state(user),
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
        "graph": series[-30:],  # last 30 days for UI chart
    }


@app.get("/dashboard")
def dashboard():
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
    user = require_user_from_token(authorization)

    details: dict[str, Any] = {
        "method": payload.method,
        "updated_at": now_utc(),
    }

    if payload.method == "upi":
        if not payload.upi_id:
            raise HTTPException(status_code=400, detail="upi_id is required for UPI payouts")
        details["upi_id"] = payload.upi_id.strip()

    if payload.method == "paypal":
        if not payload.paypal_email:
            raise HTTPException(status_code=400, detail="paypal_email is required for PayPal payouts")
        details["paypal_email"] = payload.paypal_email.strip().lower()

    if payload.name_on_account:
        details["name_on_account"] = payload.name_on_account.strip()

    supabase.table("users").update({
        "payout_account": details,
        "updated_at": now_utc(),
    }).eq("user_id", user["user_id"]).execute()

    return {
        "success": True,
        "payout_account": details,
    }


# -----------------------------------------------------------------------------
# Payouts
# -----------------------------------------------------------------------------

@app.post("/payout/request")
def payout_request(payload: PayoutRequestIn, authorization: str = Header(...)):
    user = require_user_from_token(authorization)
    state = payout_state(user)
    balance = float(user.get("earnings_usd", 0.0))
    account = payout_account(user)

    if balance < PAYOUT_THRESHOLD_USD:
        raise HTTPException(
            status_code=400,
            detail=f"Balance is below the ${PAYOUT_THRESHOLD_USD:g} threshold",
        )

    if not account.get("method"):
        raise HTTPException(status_code=400, detail="Payout account is missing")

    if state.get("current") == "pending":
        raise HTTPException(status_code=400, detail="A payout is already pending")

    payout_id = f"pay_{uuid4().hex}"

    entry = {
        "id": payout_id,
        "amount_usd": round(balance, 6),
        "method": account.get("method"),
        "status": "pending",
        "requested_at": now_utc(),
        "details": account,
    }

    new_history = append_payout_history(user, entry)

    supabase.table("users").update({
        "payout_status": {
            "current": "pending",
            "history": new_history,
        },
        "updated_at": now_utc(),
    }).eq("user_id", user["user_id"]).execute()

    return {
        "success": True,
        "payout_id": payout_id,
        "status": "pending",
        "amount_usd": round(balance, 6),
    }


@app.post("/payout/mark-paid")
def payout_mark_paid(payload: MarkPaidIn, authorization: str = Header(...)):
    user = require_user_from_token(authorization)
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
        "payout_status": {
            "current": "paid",
            "history": history,
        },
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
