import * as vscode from "vscode";
import { detectorRegistry } from "./detector";
import { HoodPanel, Ad } from "./panel";

let panel: HoodPanel | undefined;

const demoAd: Ad = {
  ad_id: "hoodai-demo-001",
  title: "Sponsored",
  text: "Ship faster with HoodAI developer tools.",
  image: "",
  link: "https://hoodai.dev",
  provider: "hoodai",
};

function getActiveTerminalName(): string {
  return vscode.window.activeTerminal?.name ?? "";
}

function isClaudeActive(): boolean {
  const detector = detectorRegistry.detect(getActiveTerminalName());
  return Boolean(detector);
}

function syncPanel(context: vscode.ExtensionContext): void {
  const generating = isClaudeActive();

  if (generating) {
    if (!panel) {
      panel = new HoodPanel(async (ad: Ad) => {
        if (ad.link) {
          await vscode.env.openExternal(vscode.Uri.parse(ad.link));
        }
      });

      context.subscriptions.push({
        dispose: () => {
          panel?.dispose();
          panel = undefined;
        },
      });
    }

    panel.show(demoAd);
    return;
  }

  if (panel) {
    panel.dispose();
    panel = undefined;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  console.log("HoodAI activated");

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.open", () => {
      if (!panel) {
        panel = new HoodPanel(async (ad: Ad) => {
          if (ad.link) {
            await vscode.env.openExternal(vscode.Uri.parse(ad.link));
          }
        });

        context.subscriptions.push({
          dispose: () => {
            panel?.dispose();
            panel = undefined;
          },
        });
      }

      panel.show(demoAd);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showAd", () => {
      if (!panel) {
        panel = new HoodPanel(async (ad: Ad) => {
          if (ad.link) {
            await vscode.env.openExternal(vscode.Uri.parse(ad.link));
          }
        });
      }

      panel.show(demoAd);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showEarnings", () => {
      vscode.window.showInformationMessage("HoodAI is installed and active.");
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal(() => syncPanel(context))
  );

  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => syncPanel(context))
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(() => syncPanel(context))
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
      if (
        event.affectsConfiguration("hoodai.enabled") ||
        event.affectsConfiguration("hoodai.apiToken") ||
        event.affectsConfiguration("hoodai.refreshIntervalSeconds")
      ) {
        syncPanel(context);
      }
    })
  );

  syncPanel(context);
}

export function deactivate(): void {
  if (panel) {
    panel.dispose();
    panel = undefined;
  }
}
