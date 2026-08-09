import * as vscode from "vscode";

export class HoodPanel {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly websiteUrl: string
    ) {}

    public show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside, false);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            "hoodaiWebsite",
            "HoodAI",
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getHtml();

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    public dispose(): void {
        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }

    private getHtml(): string {
        const safeUrl = escapeHtml(this.websiteUrl);

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      frame-src https:;
      img-src https: data:;
      style-src 'unsafe-inline';
      script-src 'unsafe-inline';
    "
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HoodAI</title>
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
      width: 100%;
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    }

    .wrap {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      background: rgba(255,255,255,.03);
      flex-shrink: 0;
    }

    .brand {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .brand strong {
      color: var(--text);
      font-size: 13px;
      line-height: 1.2;
    }

    .brand span {
      color: var(--muted);
      font-size: 11px;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    button {
      border: 0;
      border-radius: 10px;
      padding: 9px 12px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
      color: var(--text);
      background: rgba(255,255,255,.08);
    }

    button.primary {
      background: var(--accent);
      color: white;
    }

    iframe {
      flex: 1;
      width: 100%;
      border: 0;
      background: #fff;
    }

    .fallback {
      flex: 1;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
      color: var(--muted);
      line-height: 1.55;
    }

    .fallback code {
      color: var(--text);
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="brand">
        <strong>HoodAI</strong>
        <span>Showing your website while Claude Code is active</span>
      </div>

      <div class="actions">
        <button id="refreshBtn">Refresh</button>
        <button id="openBtn" class="primary">Open in Browser</button>
      </div>
    </div>

    <iframe
      id="hoodFrame"
      src="${safeUrl}"
      title="HoodAI Website"
    ></iframe>

    <div class="fallback" id="fallback">
      <div>
        This site could not be embedded inside the webview.<br />
        Open it in your browser instead:<br /><br />
        <code>${safeUrl}</code>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const url = ${JSON.stringify(this.websiteUrl)};

    const frame = document.getElementById("hoodFrame");
    const fallback = document.getElementById("fallback");
    const refreshBtn = document.getElementById("refreshBtn");
    const openBtn = document.getElementById("openBtn");

    refreshBtn?.addEventListener("click", () => {
      if (frame) {
        frame.src = url;
      }
    });

    openBtn?.addEventListener("click", () => {
      vscode.postMessage({
        type: "openExternal",
        url
      });
    });

    if (frame) {
      frame.addEventListener("error", () => {
        if (fallback) {
          fallback.style.display = "flex";
        }
      });
    }
  </script>
</body>
</html>`;
    }
}

function escapeHtml(input: string): string {
    return input
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}
