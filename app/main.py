"""
HoodAI backend.

Tracks:
- users
- impressions
- clicks
- estimated earnings from CPM
- payout eligibility

PlayaYield is the only ad source on the client side.
This backend is for tracking and dashboard accounting.
"""

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

CPM_USD = float(os.environ.get("CPM_USD", "0.20"))
USER_SHARE = float(os.environ.get("USER_SHARE", "0.70"))
HOODAI_SHARE = float(os.environ.get("HOODAI_SHARE", "0.30"))
PAYOUT_THRESHOLD_USD = float(os.environ.get("PAYOUT_THRESHOLD_USD", "10"))

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
app = FastAPI(title="hoodAI backend")


class AdEvent(BaseModel):
    device_id: str
    ad_id: str
    ad_title: Optional[str] = None


class PayoutRequest(BaseModel):
    device_id: str


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def impression_value() -> float:
    return CPM_USD / 1000.0


def get_or_create_user(device_id: str) -> dict:
    res = (
        supabase.table("users")
        .select("*")
        .eq("device_id", device_id)
        .execute()
    )
    if res.data:
        return res.data[0]

    row = {
        "device_id": device_id,
        "impressions_count": 0,
        "clicks_count": 0,
        "estimated_earnings_usd": 0.0,
        "last_ad_id": None,
        "last_ad_title": None,
        "last_seen_at": now_utc(),
        "paid_out": False,
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
    created = supabase.table("users").insert(row).execute()
    return created.data[0]


def update_user(device_id: str, patch: dict) -> None:
    patch["updated_at"] = now_utc()
    supabase.table("users").update(patch).eq("device_id", device_id).execute()


@app.get("/health")
def health():
    return {"status": "ok", "cpm_usd": CPM_USD}


@app.get("/ad/next")
def ad_next(device_id: str):
    """
    This endpoint is where your extension asks for the next ad payload.

    If PlayaYield returns ads directly in the client SDK, you may not need this.
    But keeping this endpoint is useful for tracking and future control.
    """
    user = get_or_create_user(device_id)
    return {
        "ok": True,
        "device_id": device_id,
        "cpm_usd": CPM_USD,
        "user_share": USER_SHARE,
        "hoodai_share": HOODAI_SHARE,
        "payout_threshold_usd": PAYOUT_THRESHOLD_USD,
        "user": {
            "impressions_count": user["impressions_count"],
            "clicks_count": user["clicks_count"],
            "estimated_earnings_usd": float(user["estimated_earnings_usd"]),
        },
    }


@app.post("/ad/impression")
def ad_impression(event: AdEvent):
    user = get_or_create_user(event.device_id)
    value = impression_value()

    new_impressions = int(user["impressions_count"]) + 1
    new_earnings = float(user["estimated_earnings_usd"]) + value

    supabase.table("ad_events").insert(
        {
            "device_id": event.device_id,
            "ad_id": event.ad_id,
            "ad_title": event.ad_title,
            "event_type": "impression",
            "cpm_usd": CPM_USD,
            "estimated_value_usd": value,
            "created_at": now_utc(),
        }
    ).execute()

    update_user(
        event.device_id,
        {
            "impressions_count": new_impressions,
            "estimated_earnings_usd": new_earnings,
            "last_ad_id": event.ad_id,
            "last_ad_title": event.ad_title,
            "last_seen_at": now_utc(),
        },
    )

    return {
        "ok": True,
        "impressions_count": new_impressions,
        "estimated_earnings_usd": round(new_earnings, 6),
    }


@app.post("/ad/click")
def ad_click(event: AdEvent):
    user = get_or_create_user(event.device_id)
    new_clicks = int(user["clicks_count"]) + 1

    supabase.table("ad_events").insert(
        {
            "device_id": event.device_id,
            "ad_id": event.ad_id,
            "ad_title": event.ad_title,
            "event_type": "click",
            "cpm_usd": CPM_USD,
            "estimated_value_usd": 0,
            "created_at": now_utc(),
        }
    ).execute()

    update_user(
        event.device_id,
        {
            "clicks_count": new_clicks,
            "last_ad_id": event.ad_id,
            "last_ad_title": event.ad_title,
            "last_seen_at": now_utc(),
        },
    )

    return {
        "ok": True,
        "clicks_count": new_clicks,
    }


@app.get("/stats/{device_id}")
def stats(device_id: str):
    user = get_or_create_user(device_id)
    estimated = float(user["estimated_earnings_usd"])

    return {
        "device_id": device_id,
        "impressions_total": int(user["impressions_count"]),
        "clicks_total": int(user["clicks_count"]),
        "estimated_earnings_usd": round(estimated, 6),
        "payout_threshold_usd": PAYOUT_THRESHOLD_USD,
        "eligible_for_payout": estimated >= PAYOUT_THRESHOLD_USD and not bool(user["paid_out"]),
        "last_ad_id": user.get("last_ad_id"),
        "last_ad_title": user.get("last_ad_title"),
    }


@app.get("/dashboard")
def dashboard():
    rows = supabase.table("users").select("*").order("estimated_earnings_usd", desc=True).execute()
    users = rows.data or []

    totals = {
        "users": len(users),
        "impressions_total": sum(int(u.get("impressions_count", 0)) for u in users),
        "clicks_total": sum(int(u.get("clicks_count", 0)) for u in users),
        "estimated_earnings_usd": round(sum(float(u.get("estimated_earnings_usd", 0)) for u in users), 6),
    }

    return {
        "totals": totals,
        "users": users,
    }


@app.post("/payout/mark-paid")
def mark_paid(req: PayoutRequest):
    user = get_or_create_user(req.device_id)
    estimated = float(user["estimated_earnings_usd"])

    if estimated < PAYOUT_THRESHOLD_USD:
        raise HTTPException(status_code=400, detail="User has not reached payout threshold")

    update_user(
        req.device_id,
        {
            "estimated_earnings_usd": 0.0,
            "paid_out": True,
        },
    )

    return {"ok": True}
