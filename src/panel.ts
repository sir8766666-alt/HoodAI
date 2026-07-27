import * as vscode from "vscode";
import { Ad, logClick } from "./api";
import { escapeHtml } from "./utils";

/**
 * Opens a webview panel that shows the current sponsored ad.
 */
export function showAdPanel(
  context: vscode.ExtensionContext,
  deviceId: string,
  ad: Ad | null,
): void {
  if (!ad) {
    vscode.window.showInformationMessage("hoodAI: no ad loaded yet.");
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "hoodaiSponsoredPanel",
    "Sponsored",
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  const safeTitle = escapeHtml(ad.title ?? "Sponsored");
  const safeText = escapeHtml(ad.text);
  const safeLink = ad.link ? escapeHtml(ad.link) : "";
  const safeImage = ad.image ? escapeHtml(ad.image) : "";

  panel.webview.html = getWebviewHtml(safeTitle, safeText, safeLink, safeImage);

  panel.webview.onDidReceiveMessage(async (message) => {
    if (message?.type === "click" && ad.link) {
      try {
        await logClick(deviceId, ad.ad_id);
        await vscode.env.openExternal(vscode.Uri.parse(ad.link));
      } catch (error) {
        vscode.window.showErrorMessage("hoodAI: failed to open sponsor link.");
      }
    }
  });
}

function getWebviewHtml(
  title: string,
  text: string,
  link: string,
  image: string,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sponsored</title>
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #111;
      color: #fff;
    }

    .card {
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      padding: 16px;
      background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
    }

    .badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #ff8a3d;
      margin-bottom: 12px;
    }

    .title {
      font-size: 18px;
      font-weight: 700;
      margin: 0 0 8px 0;
    }

    .text {
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 14px 0;
      color: rgba(255,255,255,0.85);
    }

    .image {
      width: 100%;
      max-width: 280px;
      border-radius: 12px;
      margin-bottom: 14px;
      display: block;
    }

    .btn {
      display: inline-block;
      border: none;
      border-radius: 999px;
      padding: 10px 16px;
      background: #ff6a00;
      color: white;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      text-decoration: none;
    }

    .footer {
      margin-top: 14px;
      font-size: 11px;
      color: rgba(255,255,255,0.5);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Sponsored</div>
    <div class="title">${title}</div>
    ${image ? `<img class="image" src="${image}" alt="Sponsored ad" />` : ""}
    <div class="text">${text}</div>
    ${
      link
        ? `<button class="btn" id="openLink">Learn More</button>`
        : ""
    }
    <div class="footer">via hoodAI</div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const btn = document.getElementById("openLink");
    if (btn) {
      btn.addEventListener("click", () => {
        vscode.postMessage({ type: "click" });
      });
    }
  </script>
</body>
</html>`;
}
