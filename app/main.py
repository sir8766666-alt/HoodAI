"""
HoodAI backend — Part 1

Foundation:
- FastAPI app
- Supabase connection
- API token generation + verification helpers
- User bootstrap helpers

Next part will add the actual routes:
- /auth/signup
- /auth/verify
- /account/payout-account
- /ad/impression
- /ad/click
- /stats/me
- /payout/request
- /payout/mark-paid
"""

import os
import secrets
import hashlib
from datetime import datetime, timezone
from typing import Optional, Literal

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

PAYOUT_THRESHOLD_USD = float(os.environ.get("PAYOUT_THRESHOLD_USD", "20"))

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
app = FastAPI(title="hoodAI-backend")


# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------

class SignupIn(BaseModel):
    email: str
    name: Optional[str] = None


class PayoutAccountIn(BaseModel):
    method: Literal["paypal"] = "paypal"
    paypal_email: str = Field(..., min_length=5)


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
# Token helpers
# -----------------------------------------------------------------------------

def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


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
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return None
    token = authorization[len(prefix):].strip()
    return token or None


# -----------------------------------------------------------------------------
# User helpers
# -----------------------------------------------------------------------------

def get_user_by_id(user_id: str) -> Optional[dict]:
    res = (
        supabase.table("users")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else None


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


def create_user_row(email: str, name: Optional[str] = None) -> tuple[dict, str]:
    user_id = generate_user_id()
    api_token = generate_api_token()

    row = {
        "user_id": user_id,
        "email": email,
        "name": name,
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
    return created.data[0], api_token


def require_user_from_token(authorization: Optional[str]) -> dict:
    token = normalize_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing Bearer token")

    user = get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid token")

    return user

# -----------------------------------------------------------------------------
# Authentication
# -----------------------------------------------------------------------------

@app.post("/auth/signup")
def signup(payload: SignupIn):
    """
    Creates a new HoodAI user.

    Returns:
    - user_id
    - api_token (ONLY ONCE)
    """

    existing = (
        supabase.table("users")
        .select("user_id")
        .eq("email", payload.email)
        .limit(1)
        .execute()
    )

    if existing.data:
        raise HTTPException(
            status_code=409,
            detail="An account with this email already exists."
        )

    user, api_token = create_user_row(
        email=payload.email,
        name=payload.name
    )

    return {
        "success": True,
        "message": "Account created successfully.",
        "user_id": user["user_id"],
        "api_token": api_token,
        "warning": "Save this API token now. It will not be shown again."
    }


@app.get("/auth/me")
def auth_me(
    authorization: str = Header(...)
):
    """
    Used by the dashboard or extension
    to verify the API token.
    """

    user = require_user_from_token(authorization)

    return {
        "success": True,
        "user": {
            "user_id": user["user_id"],
            "email": user["email"],
            "name": user["name"],
            "earnings_usd": user["earnings_usd"],
            "impressions_count": user["impressions_count"],
            "clicks_count": user["clicks_count"],
            "created_at": user["created_at"]
        }
    }


@app.post("/auth/verify")
def verify_token(
    authorization: str = Header(...)
):
    """
    Lightweight endpoint used by
    VS Code / Chrome Extension.

    Returns 401 if token is invalid.
    """

    user = require_user_from_token(authorization)

    return {
        "success": True,
        "user_id": user["user_id"],
        "email": user["email"]
    }

# -----------------------------------------------------------------------------
# Earnings helpers
# -----------------------------------------------------------------------------

def impression_estimate() -> float:
    return (CPM_USD / 1000.0) * USER_SHARE


def click_estimate() -> float:
    return CPC_USD * USER_SHARE


def save_event(
    *,
    user_id: str,
    ad_id: str,
    ad_title: str | None,
    provider: str,
    event_type: str,
    impression_id: str | None,
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
        "created_at": now_utc()
    }).execute()


def update_user_totals(user: dict, *, impression=False, click=False, earnings_delta=0):
    patch = {}

    if impression:
        patch["impressions_count"] = user["impressions_count"] + 1

    if click:
        patch["clicks_count"] = user["clicks_count"] + 1

    patch["earnings_usd"] = round(
        float(user["earnings_usd"]) + earnings_delta,
        6
    )

    patch["updated_at"] = now_utc()

    supabase.table("users") \
        .update(patch) \
        .eq("user_id", user["user_id"]) \
        .execute()

    return patch

@app.post("/ad/impression")
def ad_impression(
    payload: AdEventIn,
    authorization: str = Header(...)
):
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

    totals = update_user_totals(
        user,
        impression=True,
        earnings_delta=value
    )

    return {
        "success": True,
        "credited_estimate": value,
        "impressions": totals["impressions_count"],
        "balance": totals["earnings_usd"]
    }


@app.post("/ad/click")
def ad_click(
    payload: AdEventIn,
    authorization: str = Header(...)
):
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

    totals = update_user_totals(
        user,
        click=True,
        earnings_delta=value
    )

    return {
        "success": True,
        "credited_estimate": value,
        "clicks": totals["clicks_count"],
        "balance": totals["earnings_usd"]
    }

@app.get("/stats/me")
def stats_me(
    authorization: str = Header(...)
):
    user = require_user_from_token(authorization)

    return {
        "user_id": user["user_id"],
        "earnings_usd": user["earnings_usd"],
        "total_paid_usd": user["total_paid_usd"],
        "impressions": user["impressions_count"],
        "clicks": user["clicks_count"],
        "withdraw_enabled": (
            float(user["earnings_usd"]) >= PAYOUT_THRESHOLD_USD
        ),
        "threshold": PAYOUT_THRESHOLD_USD
    }

# -----------------------------------------------------------------------------
# Validation helpers
# -----------------------------------------------------------------------------

def ad_event_exists(user_id: str, event_type: str, impression_id: Optional[str], ad_id: str) -> bool:
    query = (
        supabase.table("ad_events")
        .select("id")
        .eq("user_id", user_id)
        .eq("event_type", event_type)
        .eq("ad_id", ad_id)
    )

    if impression_id:
        query = query.eq("impression_id", impression_id)

    res = query.limit(1).execute()
    return bool(res.data)


def payout_state(user: dict) -> dict:
    raw = user.get("payout_status")
    if isinstance(raw, dict):
        return raw
    return {"current": "none", "history": []}


def payout_account(user: dict) -> dict:
    raw = user.get("payout_account")
    if isinstance(raw, dict):
        return raw
    return {}


def has_valid_paypal_account(user: dict) -> bool:
    acc = payout_account(user)
    return (
        acc.get("method") == "paypal"
        and isinstance(acc.get("paypal_email"), str)
        and len(acc["paypal_email"].strip()) > 4
    )


def can_withdraw(user: dict) -> bool:
    return (
        float(user.get("earnings_usd", 0.0)) >= PAYOUT_THRESHOLD_USD
        and has_valid_paypal_account(user)
        and payout_state(user).get("current") != "pending"
    )


def append_payout_history(user: dict, entry: dict) -> list:
    state = payout_state(user)
    history = list(state.get("history", []))
    history.append(entry)
    return history


# -----------------------------------------------------------------------------
# Payout account
# -----------------------------------------------------------------------------

@app.post("/account/payout-account")
def set_payout_account(
    payload: PayoutAccountIn,
    authorization: str = Header(...)
):
    user = require_user_from_token(authorization)

    payout_account_value = {
        "method": "paypal",
        "paypal_email": payload.paypal_email.strip().lower(),
        "updated_at": now_utc(),
    }

    supabase.table("users").update({
        "payout_account": payout_account_value,
        "updated_at": now_utc(),
    }).eq("user_id", user["user_id"]).execute()

    return {
        "success": True,
        "payout_account": payout_account_value,
    }


# -----------------------------------------------------------------------------
# Validated ad events
# -----------------------------------------------------------------------------



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
# Payout flow
# -----------------------------------------------------------------------------

@app.post("/payout/request")
def payout_request(
    payload: PayoutRequestIn,
    authorization: str = Header(...)
):
    user = require_user_from_token(authorization)
    balance = float(user.get("earnings_usd", 0.0))
    state = payout_state(user)

    if balance < PAYOUT_THRESHOLD_USD:
        raise HTTPException(status_code=400, detail="Balance is below the $20 threshold")
    if not has_valid_paypal_account(user):
        raise HTTPException(status_code=400, detail="PayPal payout account is missing")
    if state.get("current") == "pending":
        raise HTTPException(status_code=400, detail="A payout is already pending")

    payout_id = f"pay_{uuid4().hex}"

    entry = {
        "id": payout_id,
        "amount_usd": round(balance, 6),
        "method": "paypal",
        "status": "pending",
        "requested_at": now_utc(),
        "paypal_email": payout_account(user).get("paypal_email"),
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
def payout_mark_paid(
    payload: MarkPaidIn,
    authorization: str = Header(...)
):
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
