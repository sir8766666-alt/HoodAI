"""
HoodAI backend.

What it does:
- Tracks users by user_id
- Stores payout_account in JSONB (PayPal email for now)
- Stores payout_status in JSONB with history
- Logs every impression/click into ad_events
- Calculates estimated earnings from CPM and optional CPC
- Enables payout only when balance reaches threshold
"""

import os
from copy import deepcopy
from datetime import datetime, timezone
from typing import Optional, Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from supabase import create_client, Client

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

AD_PROVIDER = os.environ.get("AD_PROVIDER", "playayield")

# Estimated revenue model (for dashboard + user balances)
CPM_USD = float(os.environ.get("CPM_USD", "0.20"))   # per 1000 impressions
CPC_USD = float(os.environ.get("CPC_USD", "0.00"))   # per click, if applicable

# Split between HoodAI and users
USER_SHARE = float(os.environ.get("USER_SHARE", "0.70"))    # 70%
HOODAI_SHARE = float(os.environ.get("HOODAI_SHARE", "0.30"))  # 30%

PAYOUT_THRESHOLD_USD = float(os.environ.get("PAYOUT_THRESHOLD_USD", "20"))

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
app = FastAPI(title="hoodAI-backend")

# -----------------------------------------------------------------------------
# Models
# -----------------------------------------------------------------------------

class UserUpsert(BaseModel):
    user_id: str = Field(..., min_length=3)
    email: Optional[str] = None
    name: Optional[str] = None


class AdEventIn(BaseModel):
    user_id: str = Field(..., min_length=3)
    ad_id: str = Field(..., min_length=1)
    ad_title: Optional[str] = None
    provider: str = Field(default=AD_PROVIDER)
    impression_id: Optional[str] = None


class PayoutAccountIn(BaseModel):
    user_id: str = Field(..., min_length=3)
    method: Literal["paypal"] = "paypal"
    paypal_email: str = Field(..., min_length=5)


class PayoutRequestIn(BaseModel):
    user_id: str = Field(..., min_length=3)


class MarkPaidIn(BaseModel):
    user_id: str = Field(..., min_length=3)
    payout_id: str


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def impression_value_usd() -> float:
    return (CPM_USD / 1000.0) * USER_SHARE


def click_value_usd() -> float:
    return CPC_USD * USER_SHARE


def normalize_jsonb(value, default):
    if isinstance(value, (dict, list)):
        return value
    return deepcopy(default)


def get_or_create_user(user_id: str, email: Optional[str] = None, name: Optional[str] = None) -> dict:
    res = (
        supabase.table("users")
        .select("*")
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )

    if res.data:
        user = res.data[0]
        patch = {}
        if email is not None and user.get("email") != email:
            patch["email"] = email
        if name is not None and user.get("name") != name:
            patch["name"] = name
        if patch:
            patch["updated_at"] = now_utc()
            supabase.table("users").update(patch).eq("user_id", user_id).execute()
            user.update(patch)
        return user

    row = {
        "user_id": user_id,
        "email": email,
        "name": name,
        "impressions_count": 0,
        "clicks_count": 0,
        "earnings_usd": 0.0,
        "total_paid_usd": 0.0,
        "payout_account": None,
        "payout_status": {
            "current": "none",
            "history": [],
        },
        "last_ad_id": None,
        "last_ad_title": None,
        "last_seen_at": now_utc(),
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
    created = supabase.table("users").insert(row).execute()
    return created.data[0]


def save_user(user_id: str, patch: dict) -> None:
    patch["updated_at"] = now_utc()
    supabase.table("users").update(patch).eq("user_id", user_id).execute()


def append_event(
    *,
    user_id: str,
    ad_id: str,
    event_type: Literal["impression", "click"],
    ad_title: Optional[str] = None,
    provider: str = AD_PROVIDER,
    impression_id: Optional[str] = None,
    revenue_usd: float = 0.0,
) -> None:
    supabase.table("ad_events").insert(
        {
            "user_id": user_id,
            "ad_id": ad_id,
            "ad_title": ad_title,
            "provider": provider,
            "event_type": event_type,
            "impression_id": impression_id,
            "cpm_usd": CPM_USD,
            "cpc_usd": CPC_USD,
            "user_share_usd": USER_SHARE,
            "hoodai_share_usd": HOODAI_SHARE,
            "estimated_value_usd": revenue_usd,
            "created_at": now_utc(),
        }
    ).execute()


def current_payout_state(user: dict) -> dict:
    return normalize_jsonb(user.get("payout_status"), {"current": "none", "history": []})


# -----------------------------------------------------------------------------
# Routes
# -----------------------------------------------------------------------------

@app.get("/health")
def health():
    return {
        "status": "ok",
        "provider": AD_PROVIDER,
        "cpm_usd": CPM_USD,
        "cpc_usd": CPC_USD,
        "payout_threshold_usd": PAYOUT_THRESHOLD_USD,
    }


@app.post("/users/upsert")
def users_upsert(payload: UserUpsert):
    user = get_or_create_user(payload.user_id, payload.email, payload.name)
    return {
        "ok": True,
        "user": user,
    }


@app.get("/users/{user_id}")
def get_user(user_id: str):
    user = get_or_create_user(user_id)
    return {
        "user_id": user["user_id"],
        "email": user.get("email"),
        "name": user.get("name"),
        "impressions_count": int(user.get("impressions_count", 0)),
        "clicks_count": int(user.get("clicks_count", 0)),
        "earnings_usd": float(user.get("earnings_usd", 0.0)),
        "total_paid_usd": float(user.get("total_paid_usd", 0.0)),
        "payout_account": user.get("payout_account"),
        "payout_status": user.get("payout_status"),
    }


@app.post("/account/payout-account")
def set_payout_account(payload: PayoutAccountIn):
    user = get_or_create_user(payload.user_id)

    payout_account = {
        "method": "paypal",
        "paypal_email": payload.paypal_email.strip().lower(),
        "updated_at": now_utc(),
    }

    save_user(payload.user_id, {"payout_account": payout_account})
    return {
        "ok": True,
        "payout_account": payout_account,
    }


@app.post("/ad/impression")
def ad_impression(payload: AdEventIn):
    user = get_or_create_user(payload.user_id)

    value = impression_value_usd()
    new_impressions = int(user.get("impressions_count", 0)) + 1
    new_earnings = float(user.get("earnings_usd", 0.0)) + value

    append_event(
        user_id=payload.user_id,
        ad_id=payload.ad_id,
        ad_title=payload.ad_title,
        provider=payload.provider,
        event_type="impression",
        impression_id=payload.impression_id,
        revenue_usd=value,
    )

    save_user(
        payload.user_id,
        {
            "impressions_count": new_impressions,
            "earnings_usd": new_earnings,
            "last_ad_id": payload.ad_id,
            "last_ad_title": payload.ad_title,
            "last_seen_at": now_utc(),
        },
    )

    return {
        "ok": True,
        "event_type": "impression",
        "credited_usd": round(value, 6),
        "impressions_count": new_impressions,
        "earnings_usd": round(new_earnings, 6),
    }


@app.post("/ad/click")
def ad_click(payload: AdEventIn):
    user = get_or_create_user(payload.user_id)

    value = click_value_usd()
    new_clicks = int(user.get("clicks_count", 0)) + 1
    new_earnings = float(user.get("earnings_usd", 0.0)) + value

    append_event(
        user_id=payload.user_id,
        ad_id=payload.ad_id,
        ad_title=payload.ad_title,
        provider=payload.provider,
        event_type="click",
        impression_id=payload.impression_id,
        revenue_usd=value,
    )

    save_user(
        payload.user_id,
        {
            "clicks_count": new_clicks,
            "earnings_usd": new_earnings,
            "last_ad_id": payload.ad_id,
            "last_ad_title": payload.ad_title,
            "last_seen_at": now_utc(),
        },
    )

    return {
        "ok": True,
        "event_type": "click",
        "credited_usd": round(value, 6),
        "clicks_count": new_clicks,
        "earnings_usd": round(new_earnings, 6),
    }


@app.get("/stats/{user_id}")
def stats(user_id: str):
    user = get_or_create_user(user_id)
    payout_status = current_payout_state(user)
    earnings = float(user.get("earnings_usd", 0.0))

    return {
        "user_id": user_id,
        "impressions_total": int(user.get("impressions_count", 0)),
        "clicks_total": int(user.get("clicks_count", 0)),
        "earnings_usd": round(earnings, 6),
        "total_paid_usd": float(user.get("total_paid_usd", 0.0)),
        "payout_threshold_usd": PAYOUT_THRESHOLD_USD,
        "eligible_for_payout": earnings >= PAYOUT_THRESHOLD_USD and payout_status.get("current") != "pending",
        "payout_account": user.get("payout_account"),
        "payout_status": payout_status,
        "last_ad_id": user.get("last_ad_id"),
        "last_ad_title": user.get("last_ad_title"),
    }


@app.post("/payout/request")
def payout_request(payload: PayoutRequestIn):
    user = get_or_create_user(payload.user_id)
    balance = float(user.get("earnings_usd", 0.0))
    payout_account = normalize_jsonb(user.get("payout_account"), None)
    payout_status = current_payout_state(user)

    if balance < PAYOUT_THRESHOLD_USD:
        raise HTTPException(status_code=400, detail="Balance is below payout threshold")
    if not payout_account or payout_account.get("method") != "paypal" or not payout_account.get("paypal_email"):
        raise HTTPException(status_code=400, detail="PayPal payout account is missing")
    if payout_status.get("current") == "pending":
        raise HTTPException(status_code=400, detail="There is already a pending payout request")

    payout_id = f"p_{uuid4().hex}"
    request_entry = {
        "id": payout_id,
        "amount_usd": round(balance, 6),
        "method": "paypal",
        "status": "pending",
        "requested_at": now_utc(),
        "paypal_email": payout_account["paypal_email"],
    }

    history = list(payout_status.get("history", []))
    history.append(request_entry)

    save_user(
        payload.user_id,
        {
            "payout_status": {
                "current": "pending",
                "history": history,
            }
        },
    )

    return {
        "ok": True,
        "payout_id": payout_id,
        "status": "pending",
        "amount_usd": round(balance, 6),
    }


@app.post("/payout/mark-paid")
def payout_mark_paid(payload: MarkPaidIn):
    user = get_or_create_user(payload.user_id)
    payout_status = current_payout_state(user)
    history = list(payout_status.get("history", []))

    match = None
    for item in reversed(history):
        if item.get("id") == payload.payout_id:
            match = item
            break

    if not match:
        raise HTTPException(status_code=404, detail="Payout request not found")
    if match.get("status") == "paid":
        return {"ok": True, "already_paid": True}

    amount = float(match.get("amount_usd", 0.0))
    earnings = float(user.get("earnings_usd", 0.0))
    if earnings < amount:
        raise HTTPException(status_code=400, detail="Not enough balance to mark paid")

    match["status"] = "paid"
    match["paid_at"] = now_utc()

    # update last matching element in history
    for idx in range(len(history) - 1, -1, -1):
        if history[idx].get("id") == payload.payout_id:
            history[idx] = match
            break

    new_paid_total = float(user.get("total_paid_usd", 0.0)) + amount
    save_user(
        payload.user_id,
        {
            "earnings_usd": round(earnings - amount, 6),
            "total_paid_usd": round(new_paid_total, 6),
            "payout_status": {
                "current": "paid",
                "history": history,
            },
        },
    )

    return {
        "ok": True,
        "payout_id": payload.payout_id,
        "status": "paid",
        "amount_usd": round(amount, 6),
    }


@app.get("/dashboard")
def dashboard():
    rows = (
        supabase.table("users")
        .select("*")
        .order("earnings_usd", desc=True)
        .execute()
    )
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
