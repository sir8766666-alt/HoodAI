import * as vscode from "vscode";

export class HoodPanel {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly websiteUrl: string) {}

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
        enableScripts: false,
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
    const url = escapeHtml(this.websiteUrl);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="
      default-src 'none';
      frame-src https:;
      style-src 'unsafe-inline';
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
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      background: rgba(255,255,255,.03);
      font-size: 12px;
      color: var(--muted);
    }

    .topbar strong {
      color: var(--text);
      font-size: 13px;
    }

    iframe {
      flex: 1;
      width: 100%;
      border: 0;
      background: #fff;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <strong>HoodAI</strong> · showing your website while Claude Code is active
    </div>
    <iframe src="${url}" title="HoodAI Website"></iframe>
  </div>
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
