import * as vscode from "vscode";

export interface Ad {
  ad_id: string;
  title: string;
  text: string;
  image: string;
  link: string;
  provider: string;
  impression_id?: string;
}

type PanelMessage =
  | { type: "click" }
  | { type: "close" };

export class HoodPanel {
  private panel: vscode.WebviewPanel | null = null;
  private readonly onClick: (ad: Ad) => Promise<void> | void;
  private readonly onClose?: () => void;

  constructor(onClick: (ad: Ad) => Promise<void> | void, onClose?: () => void) {
    this.onClick = onClick;
    this.onClose = onClose;
  }

  public isOpen(): boolean {
    return this.panel !== null;
  }

  public show(ad: Ad): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, false);
      this.update(ad);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "hoodaiSponsored",
      "HoodAI Sponsored",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    this.panel.webview.html = this.getHtml(this.panel.webview, ad);

    this.panel.onDidDispose(() => {
      this.panel = null;
      if (this.onClose) {
        this.onClose();
      }
    });

    this.panel.webview.onDidReceiveMessage(async (message: PanelMessage) => {
      if (message.type === "click") {
        await this.onClick(ad);
      }

      if (message.type === "close") {
        this.dispose();
      }
    });
  }

  public update(ad: Ad): void {
    if (!this.panel) return;
    this.panel.webview.html = this.getHtml(this.panel.webview, ad);
  }

  public dispose(): void {
    if (!this.panel) return;
    this.panel.dispose();
    this.panel = null;
  }

  private getHtml(webview: vscode.Webview, ad: Ad): string {
    const nonce = getNonce();
    const safeTitle = escapeHtml(ad.title || "Sponsored");
    const safeText = escapeHtml(ad.text || "");
    const safeLink = escapeHtml(ad.link || "#");
    const safeImage = ad.image ? escapeHtml(ad.image) : "";

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

    button {
      appearance: none;
      border: none;
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 800;
      cursor: pointer;
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
    ${safeImage ? `<img class="hero" src="${safeImage}" alt="Sponsored" />` : ""}
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

    document.getElementById("openLink")?.addEventListener("click", () => {
      vscode.postMessage({ type: "click" });
    });

    document.getElementById("closeCard")?.addEventListener("click", () => {
      vscode.postMessage({ type: "close" });
    });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
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
