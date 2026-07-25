hoodai-backend
FastAPI + Supabase backend that serves a sponsored text/image/link into a CLI tool's "thinking…" spinner (e.g. Claude Code's spinnerVerbs setting), logs impressions/clicks, and tracks per-user earnings toward a payout threshold.
Ships with a mock ad mode so you can build and test the whole pipeline before your EthicalAds publisher application is approved.
1. Supabase setup
Create a project at supabase.com
SQL editor → paste and run supabase_schema.sql
Project Settings → API → copy your URL and service_role key
2. Run locally / in Codespaces
Click Code → Codespaces → Create codespace on main on this repo. The devcontainer auto-installs dependencies.
Copy .env.example to .env and fill in your Supabase values.
In Codespaces, add secrets instead of a committed .env: repo → Settings → Secrets and variables → Codespaces → add SUPABASE_URL, SUPABASE_SERVICE_KEY, etc. They're injected automatically.
uvicorn app.main:app --reload
Visit /health to confirm it's running, and try:
curl "http://localhost:8000/ad/next?device_id=test-device-1"
3. Switching from mock ads to EthicalAds
Once approved as a publisher:
Set USE_MOCK_ADS=false
Fill in ETHICALADS_API_KEY, ETHICALADS_PUBLISHER, ETHICALADS_PLACEMENT
No other code changes needed — fetch_ad() already calls their real decision API and normalizes the response into the same shape.
4. Endpoints
Method
Path
Purpose
GET
/ad/next?device_id=
Fetch next ad to show in the spinner
POST
/ad/impression
Log that an ad was actually displayed
POST
/ad/click
Log a click
GET
/stats/{device_id}
Totals for a dashboard/chart
POST
/payout/apply-revenue
Apply a network's per-user revenue share
POST
/payout/mark-paid
Zero out earnings after a real payout is sent
5. On the "today / monthly" stats
The current schema is a single table with lifetime running totals only (as requested). /stats/{device_id} returns null for the today and monthly breakdowns because that needs day-by-day granularity, which a single running-total row can't give you. See the commented-out events table at the bottom of supabase_schema.sql — add it later if/when you want real per-day chart data instead of just lifetime totals.
6. Deploying (Render)
Render detects the Dockerfile automatically:
New → Web Service → connect this repo
Add the same env vars from .env.example in Render's dashboard
Deploy — Render builds the Dockerfile and runs the CMD automatically
7. Wiring into Claude Code's spinner
Claude Code reads spinner text from ~/.claude/settings.json (spinnerVerbs). Your VS Code/CLI extension should, on an interval or on each "thinking" event:
Call GET /ad/next?device_id=<local-anon-id>
Write the returned text into that setting
Fire POST /ad/impression once it's actually rendered
Fire POST /ad/click if the user acts on the sponsored line
This repo only covers the backend half — the extension-side hook is a separate small TypeScript project.
