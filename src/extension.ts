import * as vscode from "vscode";
import { detectorRegistry } from "./detector";

interface Ad {
  ad_id: string;
  title: string;
  text: string;
  image: string;
  link: string;
  provider: string;
  impression_id?: string;
}

const API_BASE = "https://hoodai-zscw.onrender.com";
const POLL_INTERVAL_MS = 1000;
const IMPRESSION_DELAY_MS = 2000;

let statusBarItem: vscode.StatusBarItem | null = null;
let pollTimer: NodeJS.Timeout | undefined;
let impressionTimer: NodeJS.Timeout | undefined;

let generationActive = false;
let currentSessionId = 0;
let impressionSent = false;
let currentAd: Ad | null = null;
let currentPanel: vscode.WebviewPanel | null = null;
let currentDetectorName = "Unknown";

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("hoodai");
  return {
    enabled: cfg.get<boolean>("enabled", true),
    apiToken: cfg.get<string>("apiToken", "").trim(),
  };
}

function updateStatusBar(generating: boolean): void {
  if (!statusBarItem) {
    return;
  }

  const { enabled } = getConfig();

  if (!enabled) {
    statusBarItem.text = "$(circle-slash) HoodAI";
    statusBarItem.tooltip = "HoodAI is disabled";
    statusBarItem.command = "hoodai.showEarnings";
    statusBarItem.show();
    return;
  }

  if (generating) {
    statusBarItem.text = `$(sync~spin) HoodAI · ${currentDetectorName}`;
    statusBarItem.tooltip = `Sponsored card active while ${currentDetectorName} is generating`;
  } else {
    statusBarItem.text = "$(megaphone) HoodAI";
    statusBarItem.tooltip = "HoodAI is ready";
  }

  statusBarItem.command = "hoodai.showAd";
  statusBarItem.show();
}

async function requestJson<T>(
  method: string,
  endpoint: string,
  body?: unknown
): Promise<T> {
  const { apiToken } = getConfig();

  if (!apiToken) {
    throw new Error("Missing HoodAI API token.");
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();

  let parsed: any = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!response.ok) {
    const detail =
      parsed?.detail ||
      parsed?.error ||
      `HTTP ${response.status}`;
    throw new Error(typeof detail === "string" ? detail : String(detail));
  }

  return parsed as T;
}

async function getNextAd(): Promise<Ad> {
  return requestJson<Ad>("GET", "/ad/next");
}

async function sendImpression(ad: Ad): Promise<void> {
  await requestJson("POST", "/ad/impression", {
    provider: ad.provider,
    ad_id: ad.ad_id,
    ad_title: ad.title,
    impression_id: ad.impression_id,
  });
}

async function sendClick(ad: Ad): Promise<void> {
  await requestJson("POST", "/ad/click", {
    provider: ad.provider,
    ad_id: ad.ad_id,
    ad_title: ad.title,
    impression_id: ad.impression_id,
  });
}

function clearImpressionTimer(): void {
  if (impressionTimer) {
    clearTimeout(impressionTimer);
    impressionTimer = undefined;
  }
}

function closePanel(): void {
  if (currentPanel) {
    try {
      currentPanel.dispose();
    } catch {
      // ignore
    }
    currentPanel = null;
  }
}

function resetSessionState(): void {
  clearImpressionTimer();
  closePanel();
  currentAd = null;
  impressionSent = false;
  detectorRegistry.reset();
}

function getNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildWebviewHtml(webview: vscode.Webview, ad: Ad): string {
  const nonce = getNonce();
  const safeTitle = escapeHtml(ad.title || "Sponsored");
  const safeText = escapeHtml(ad.text || "");
  const safeLink = escapeHtml(ad.link || "#");
  const imageHtml = ad.image
    ? `<img class="hero" src="${escapeHtml(ad.image)}" alt="Sponsored" />`
    : "";

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      img-src ${webview.cspSource} https: data:;
      style-src ${webview.cspSource} 'unsafe-inline';
      script-src 'nonce-${nonce}';
    "
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HoodAI Sponsored</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0b0d;
      --card: #121216;
      --border: rgba(255,255,255,.10);
      --text: #f5f5f7;
      --muted: rgba(245,245,247,.72);
      --accent: #ff7a18;
    }

    html, body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    body {
      padding: 14px;
    }

    .card {
      border: 1px solid var(--border);
      background: linear-gradient(180deg, rgba(255,255,255,.03), rgba(255,255,255,.01));
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 16px 40px rgba(0,0,0,.28);
    }

    .hero {
      width: 100%;
      height: 168px;
      object-fit: cover;
      display: block;
      background: #1a1a1f;
    }

    .content {
      padding: 16px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 800;
      margin-bottom: 10px;
    }

    h1 {
      margin: 0 0 10px 0;
      font-size: 18px;
      line-height: 1.25;
    }

    p {
      margin: 0;
      color: var(--muted);
      line-height: 1.55;
      font-size: 13px;
    }

    .actions {
      display: flex;
      gap: 10px;
      margin-top: 16px;
      flex-wrap: wrap;
    }

    button, a.btn {
      appearance: none;
      border: none;
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .primary {
      background: var(--accent);
      color: white;
    }

    .secondary {
      background: rgba(255,255,255,.08);
      color: var(--text);
    }

    .footer {
      margin-top: 14px;
      font-size: 11px;
      color: rgba(245,245,247,.52);
    }
  </style>
</head>
<body>
  <div class="card">
    ${imageHtml}
    <div class="content">
      <div class="badge">Sponsored</div>
      <h1>${safeTitle}</h1>
      <p>${safeText}</p>

      <div class="actions">
        <button class="primary" id="openLink">Learn More</button>
        <button class="secondary" id="closeCard">Close</button>
      </div>

      <div class="footer">HoodAI · developer sponsored content</div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const openBtn = document.getElementById("openLink");
    const closeBtn = document.getElementById("closeCard");

    openBtn?.addEventListener("click", () => {
      vscode.postMessage({ type: "click" });
    });

    closeBtn?.addEventListener("click", () => {
      vscode.postMessage({ type: "close" });
    });
  </script>
</body>
</html>`;
}

function showSponsoredPanel(ad: Ad, sessionId: number): void {
  closePanel();

  const panel = vscode.window.createWebviewPanel(
    "hoodaiSponsored",
    "HoodAI Sponsored",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    }
  );

  currentPanel = panel;

  panel.webview.html = buildWebviewHtml(panel.webview, ad);

  panel.onDidDispose(() => {
    if (currentPanel === panel) {
      currentPanel = null;
    }
  });

  panel.webview.onDidReceiveMessage(async (message: { type?: string }) => {
    if (sessionId !== currentSessionId || !currentAd) {
      return;
    }

    if (message?.type === "click") {
      try {
        await sendClick(currentAd);
      } catch (err) {
        console.error("[HoodAI] click tracking failed:", err);
      }

      if (currentAd.link) {
        try {
          await vscode.env.openExternal(vscode.Uri.parse(currentAd.link));
        } catch (err) {
          console.error("[HoodAI] opening link failed:", err);
        }
      }
    }

    if (message?.type === "close") {
      panel.dispose();
    }
  });
}

function scheduleImpression(sessionId: number): void {
  clearImpressionTimer();

  impressionTimer = setTimeout(async () => {
    if (
      sessionId !== currentSessionId ||
      !generationActive ||
      impressionSent ||
      !currentAd
    ) {
      return;
    }

    impressionSent = true;

    try {
      await sendImpression(currentAd);
    } catch (err) {
      console.error("[HoodAI] impression tracking failed:", err);
    }
  }, IMPRESSION_DELAY_MS);
}

async function startGenerationCycle(): Promise<void> {
  const sessionId = ++currentSessionId;
  impressionSent = false;
  currentAd = null;

  clearImpressionTimer();
  closePanel();

  try {
    const ad = await getNextAd();

    if (sessionId !== currentSessionId || !generationActive) {
      return;
    }

    currentAd = ad;
    showSponsoredPanel(ad, sessionId);
    scheduleImpression(sessionId);
  } catch (err) {
    console.error("[HoodAI] ad fetch failed:", err);
  }
}

function endGenerationCycle(): void {
  generationActive = false;
  clearImpressionTimer();
  closePanel();
  currentAd = null;
  impressionSent = false;
  detectorRegistry.reset();
  updateStatusBar(false);
}

async function checkGenerationState(): Promise<void> {
  const { enabled, apiToken } = getConfig();

  if (!enabled) {
    if (generationActive) {
      endGenerationCycle();
    }
    updateStatusBar(false);
    return;
  }

  if (!apiToken) {
    updateStatusBar(false);
    return;
  }

  currentDetectorName = detectorRegistry.getDetectorName();
  const generating = detectorRegistry.isGenerating();

  updateStatusBar(generating);

  if (generating && !generationActive) {
    generationActive = true;
    await startGenerationCycle();
    return;
  }

  if (!generating && generationActive) {
    endGenerationCycle();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "$(megaphone) HoodAI";
  statusBarItem.tooltip = "HoodAI";
  statusBarItem.command = "hoodai.showAd";
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showAd", async () => {
      if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.Beside, false);
        return;
      }

      if (generationActive && currentAd) {
        showSponsoredPanel(currentAd, currentSessionId);
        return;
      }

      vscode.window.showInformationMessage(
        "HoodAI shows sponsored content automatically while Claude Code is generating."
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showEarnings", async () => {
      vscode.window.showInformationMessage(
        "Open the HoodAI dashboard to view earnings, impressions, and payouts."
      );
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(
      (event: vscode.ConfigurationChangeEvent) => {
        if (
          event.affectsConfiguration("hoodai.enabled") ||
          event.affectsConfiguration("hoodai.apiToken")
        ) {
          void checkGenerationState();
        }
      }
    )
  );

  context.subscriptions.push(
    vscode.window.onDidWriteTerminalData((event) => {
      detectorRegistry.observeTerminalData(event.data);
    })
  );

  pollTimer = setInterval(() => {
    void checkGenerationState();
  }, POLL_INTERVAL_MS);

  context.subscriptions.push({
    dispose: () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }

      clearImpressionTimer();
      closePanel();
    },
  });

  void checkGenerationState();
}

export function deactivate(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }

  clearImpressionTimer();
  closePanel();

  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = null;
  }
}
