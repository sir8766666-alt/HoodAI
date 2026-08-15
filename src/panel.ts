import * as vscode from "vscode";

const HOODAI_WEBPAGE_URL =
    "https://comforting-eclair-002ce3.netlify.app/";

export class HoodPanel {
    private panel: vscode.WebviewPanel | undefined;

    constructor(
        private readonly websiteUrl: string = HOODAI_WEBPAGE_URL
    ) {}

    public show(): void {
        if (this.panel) {
            this.panel.reveal(
                vscode.ViewColumn.Beside,
                true
            );
            return;
        }

        this.panel =
            vscode.window.createWebviewPanel(
                "hoodaiWebsite",
                "HoodAI Sponsored",
                {
                    viewColumn: vscode.ViewColumn.Beside,
                    preserveFocus: true
                },
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

        this.panel.webview.html =
            this.getHtml();

        this.panel.webview.onDidReceiveMessage(
            async (
                message: {
                    type?: string;
                    url?: string;
                }
            ) => {
                if (
                    message.type ===
                    "openExternal"
                ) {
                    const url =
                        message.url ||
                        this.websiteUrl;

                    try {
                        await vscode.env.openExternal(
                            vscode.Uri.parse(url)
                        );
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `HoodAI could not open the website: ${
                                error instanceof Error
                                    ? error.message
                                    : "Unknown error"
                            }`
                        );
                    }

                    return;
                }

                if (
                    message.type ===
                    "close"
                ) {
                    this.dispose();
                }
            }
        );

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
        const safeUrl =
            escapeHtml(
                this.websiteUrl
            );

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

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  />

  <title>HoodAI Sponsored</title>

  <style>
    :root {
      color-scheme: dark;

      --bg: #0b0b0d;
      --border: rgba(255, 255, 255, 0.10);
      --text: #f5f5f7;
      --muted: rgba(245, 245, 247, 0.72);
      --accent: #ff7a18;
      --yellow: #f4c542;
    }

    * {
      box-sizing: border-box;
    }

    html,
    body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: var(--bg);
      color: var(--text);
      font-family:
        Inter,
        ui-sans-serif,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
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

      border-bottom:
        1px solid var(--border);

      background:
        rgba(255, 255, 255, 0.03);

      flex-shrink: 0;
    }

    .brand {
      min-width: 0;

      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .brand strong {
      color: var(--text);
      font-size: 13px;
      line-height: 1.2;
      font-weight: 800;
    }

    .brand span {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.35;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    button {
      border: 0;
      border-radius: 10px;

      padding: 9px 12px;

      font-size: 12px;
      font-weight: 700;

      cursor: pointer;

      color: var(--text);
      background:
        rgba(255, 255, 255, 0.08);
    }

    button:hover {
      background:
        rgba(255, 255, 255, 0.14);
    }

    button.primary {
      background: var(--accent);
      color: #ffffff;
    }

    iframe {
      flex: 1;

      width: 100%;
      height: 100%;

      border: 0;
      background: #ffffff;
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
        <strong>HoodAI Sponsored</strong>

        <span>
          Don't close this panel — scroll to the bottom to explore more.
        </span>
      </div>

      <div class="actions">

        <button
          id="refreshBtn"
          type="button"
        >
          Refresh
        </button>

        <button
          id="openBtn"
          class="primary"
          type="button"
        >
          Open in Browser
        </button>

      </div>

    </div>

    <iframe
      id="hoodFrame"
      src="${safeUrl}"
      title="HoodAI sponsored website"
    ></iframe>

    <div
      class="fallback"
      id="fallback"
    >
      <div>
        This site could not be embedded inside
        the HoodAI panel.<br /><br />

        Open it in your browser instead:
        <br /><br />

        <code>
          ${safeUrl}
        </code>
      </div>
    </div>

  </div>

  <script>
    const vscode =
      acquireVsCodeApi();

    const url =
      ${JSON.stringify(
          this.websiteUrl
      )};

    const frame =
      document.getElementById(
        "hoodFrame"
      );

    const fallback =
      document.getElementById(
        "fallback"
      );

    const refreshBtn =
      document.getElementById(
        "refreshBtn"
      );

    const openBtn =
      document.getElementById(
        "openBtn"
      );

    refreshBtn?.addEventListener(
      "click",
      () => {
        if (frame) {
          frame.src = url;
        }
      }
    );

    openBtn?.addEventListener(
      "click",
      () => {
        vscode.postMessage({
          type: "openExternal",
          url
        });
      }
    );

    frame?.addEventListener(
      "error",
      () => {
        if (fallback) {
          fallback.style.display =
            "flex";
        }
      }
    );
  </script>

</body>
</html>`;
    }
}

function escapeHtml(
    input: string
): string {
    return input
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#39;"
        );
}
