"""
Backend for spinner-ad integration (Claude Code / dev tools).
Connects to EthicalAds for ad supply, logs activity to a single
Supabase table, and exposes simple stats + payout endpoints.
"""

import os
import random
from datetime import datetime, timezone, date

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

USE_MOCK_ADS = os.environ.get("USE_MOCK_ADS", "true").lower() == "true"
ETHICALADS_API_KEY = os.environ.get("ETHICALADS_API_KEY", "")
ETHICALADS_PUBLISHER = os.environ.get("ETHICALADS_PUBLISHER", "")
ETHICALADS_PLACEMENT = os.environ.get("ETHICALADS_PLACEMENT", "spinner-text")

PAYOUT_THRESHOLD_USD = float(os.environ.get("PAYOUT_THRESHOLD_USD", "10"))
USER_REVENUE_SHARE = float(os.environ.get("USER_REVENUE_SHARE", "0.5"))  # 50%

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

app = FastAPI(title="hoodai-backend")

MOCK_ADS = [
    {
        "ad_id": "test-001",
        "text": "Ship faster with Ramp — corporate cards for startups",
        "image": "https://via.placeholder.com/130x100?text=Ramp",
        "link": "https://example.com/sponsor-test",
    },
    {
        "ad_id": "test-002",
        "text": "Deploy in seconds — try Render free",
        "image": "https://via.placeholder.com/130x100?text=Render",
        "link": "https://example.com/sponsor-test-2",
    },
]

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ImpressionEvent(BaseModel):
    device_id: str
    ad_id: str


class ClickEvent(BaseModel):
    device_id: str
    ad_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_or_create_user(device_id: str) -> dict:
    """Single source of truth: one row per device, holds everything."""
    res = supabase.table("users").select("*").eq("device_id", device_id).execute()
    if res.data:
        return res.data[0]

    new_row = {
        "device_id": device_id,
        "suggestions": [],          # ad_ids we plan to prioritize for this user
        "clicked_ad_ids": [],       # history of ad_ids clicked
        "impressions_count": 0,
        "clicks_count": 0,
        "earnings": 0.0,
        "paid_out": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    created = supabase.table("users").insert(new_row).execute()
    return created.data[0]


async def fetch_ad(device_id: str) -> dict:
    if USE_MOCK_ADS:
        return random.choice(MOCK_ADS)

    async with httpx.AsyncClient(timeout=5) as client:
        resp = await client.get(
            "https://server.ethicalads.io/api/v1/decision/",
            params={"placement": ETHICALADS_PLACEMENT, "format": "text"},
            headers={"Authorization": f"Token {ETHICALADS_API_KEY}"},
        )
        resp.raise_for_status()
        data = resp.json()

    # normalize EthicalAds' response into our internal shape
    return {
        "ad_id": data.get("nonce", "unknown"),
        "text": data.get("text", ""),
        "image": data.get("image", ""),
        "link": data.get("link", ""),
    }


# ---------------------------------------------------------------------------
# Ad serving
# ---------------------------------------------------------------------------

@app.get("/ad/next")
async def get_next_ad(device_id: str):
    user = get_or_create_user(device_id)
    ad = await fetch_ad(device_id)

    # simple "suggestions" update: keep last 5 ad_ids we've shown this user
    suggestions = user.get("suggestions", []) or []
    suggestions = ([ad["ad_id"]] + suggestions)[:5]
    supabase.table("users").update({"suggestions": suggestions}).eq(
        "device_id", device_id
    ).execute()

    return ad


@app.post("/ad/impression")
def log_impression(event: ImpressionEvent):
    user = get_or_create_user(event.device_id)
    supabase.table("users").update(
        {"impressions_count": user["impressions_count"] + 1}
    ).eq("device_id", event.device_id).execute()
    return {"ok": True}


@app.post("/ad/click")
def log_click(event: ClickEvent):
    user = get_or_create_user(event.device_id)
    clicked = user.get("clicked_ad_ids", []) or []
    clicked.append({"ad_id": event.ad_id, "at": datetime.now(timezone.utc).isoformat()})

    supabase.table("users").update(
        {
            "clicks_count": user["clicks_count"] + 1,
            "clicked_ad_ids": clicked,
        }
    ).eq("device_id", event.device_id).execute()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Stats — shaped for a chart (AdMob-style: today + monthly series)
# ---------------------------------------------------------------------------

@app.get("/stats/{device_id}")
def get_user_stats(device_id: str):
    user = get_or_create_user(device_id)

    return {
        "impressions_total": user["impressions_count"],
        "clicks_total": user["clicks_count"],
        "earnings_total": user["earnings"],
        "payout_threshold": PAYOUT_THRESHOLD_USD,
        "eligible_for_payout": user["earnings"] >= PAYOUT_THRESHOLD_USD
        and not user["paid_out"],
        # today / monthly breakdowns require a proper events table for real
        # per-day granularity — see NOTE in README. Placeholder shape below
        # so a chart component can be wired up immediately.
        "today": {"impressions": None, "clicks": None, "earnings": None},
        "monthly": {"impressions": None, "clicks": None, "earnings": None},
    }


# ---------------------------------------------------------------------------
# Payout — apply revenue from network's monthly report, then check threshold
# ---------------------------------------------------------------------------

class RevenueUpdate(BaseModel):
    device_id: str
    amount_usd: float  # this user's computed share for the period


@app.post("/payout/apply-revenue")
def apply_revenue(update: RevenueUpdate):
    user = get_or_create_user(update.device_id)
    new_earnings = user["earnings"] + update.amount_usd
    supabase.table("users").update({"earnings": new_earnings}).eq(
        "device_id", update.device_id
    ).execute()

    return {
        "earnings": new_earnings,
        "eligible_for_payout": new_earnings >= PAYOUT_THRESHOLD_USD,
    }


@app.post("/payout/mark-paid")
def mark_paid(device_id: str):
    user = get_or_create_user(device_id)
    if user["earnings"] < PAYOUT_THRESHOLD_USD:
        raise HTTPException(400, "User has not reached payout threshold")

    supabase.table("users").update({"earnings": 0.0, "paid_out": True}).eq(
        "device_id", device_id
    ).execute()
    return {"ok": True}


@app.get("/health")
def health():
    return {"status": "ok", "mock_mode": USE_MOCK_ADS}
  
