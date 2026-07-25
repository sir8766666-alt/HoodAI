import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";

interface Ad {
  ad_id: string;
  text: string;
  image?: string;
  link?: string;
}

let statusBarItem: vscode.StatusBarItem;
let currentAd: Ad | null = null;
let deviceId: string;
let refreshTimer: NodeJS.Timeout | undefined;

// ---------------------------------------------------------------------------
// Tiny HTTP helper (no extra deps)
// ---------------------------------------------------------------------------

function request(method: string, url: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const u = new URL(url);

    const req = lib.request(
      u,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Device id — stored in extension global state, anonymous, no PII
// ---------------------------------------------------------------------------

function getOrCreateDeviceId(context: vscode.ExtensionContext): string {
  const existing = context.globalState.get<string>("hoodai.deviceId");
  if (existing) return existing;
  const id = crypto.randomUUID();
  context.globalState.update("hoodai.deviceId", id);
  return id;
}

// ---------------------------------------------------------------------------
// Fetch + display
// ---------------------------------------------------------------------------

function config() {
  const cfg = vscode.workspace.getConfiguration("hoodai");
  return {
    backendUrl: cfg.get<string>("backendUrl")!,
    intervalSec: cfg.get<number>("refreshIntervalSeconds")!,
    enabled: cfg.get<boolean>("enabled")!,
  };
}

async function fetchAndShowAd() {
  const { backendUrl, enabled } = config();
  if (!enabled) return;

  const ad: Ad | null = await request("GET", `${backendUrl}/ad/next?device_id=${deviceId}`);
  if (!ad || !ad.text) return;

  currentAd = ad;
  statusBarItem.text = `$(megaphone) ${truncate(ad.text, 40)}`;
  statusBarItem.tooltip = "Sponsored — click to view (hoodAI)";
  statusBarItem.command = "hoodai.showAd";
  statusBarItem.show();

  // impression fires once the status bar item is actually updated/visible
  request("POST", `${backendUrl}/ad/impression`, { device_id: deviceId, ad_id: ad.ad_id });
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ---------------------------------------------------------------------------
// Webview panel — this is where image + text + clickable link actually render
// ---------------------------------------------------------------------------

function showAdPanel(context: vscode.ExtensionContext) {
  if (!currentAd) {
    vscode.window.showInformationMessage("hoodAI: no ad loaded yet.");
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "hoodaiAd",
    "Sponsored",
    vscode.ViewColumn.Beside,
    { enableScripts: false }
  );

  const ad = currentAd;
  panel.webview.html = `
    <html>
      <body style="font-family: sans-serif; padding: 16px; text-align: center;">
        ${ad.image ? `<img src="${ad.image}" style="max-width: 200px; border-radius: 8px;" />` : ""}
        <p style="font-size: 15px; margin: 16px 0;">${escapeHtml(ad.text)}</p>
        ${ad.link ? `<a href="${ad.link}" style="color:#4ea1f3;">${ad.link}</a>` : ""}
        <p style="font-size: 11px; color: #888; margin-top: 24px;">Sponsored — via hoodAI</p>
      </body>
    </html>
  `;

  if (ad.link) {
    const { backendUrl } = config();
    request("POST", `${backendUrl}/ad/click`, { device_id: deviceId, ad_id: ad.ad_id });
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function showEarnings() {
  const { backendUrl } = config();
  const stats = await request("GET", `${backendUrl}/stats/${deviceId}`);
  if (!stats) {
    vscode.window.showWarningMessage("hoodAI: couldn't reach backend.");
    return;
  }
  vscode.window.showInformationMessage(
    `hoodAI — Impressions: ${stats.impressions_total}, Clicks: ${stats.clicks_total}, Earnings: $${stats.earnings_total.toFixed(2)} (payout at $${stats.payout_threshold})`
  );
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  deviceId = getOrCreateDeviceId(context);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showAd", () => showAdPanel(context))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showEarnings", showEarnings)
  );

  fetchAndShowAd();
  const { intervalSec } = config();
  refreshTimer = setInterval(fetchAndShowAd, intervalSec * 1000);

  context.subscriptions.push({
    dispose: () => {
      if (refreshTimer) clearInterval(refreshTimer);
    },
  });
}

export function deactivate() {
  if (refreshTimer) clearInterval(refreshTimer);
}
