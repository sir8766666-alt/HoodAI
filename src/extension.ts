import * as vscode from "vscode";
import { detectorRegistry } from "./detector";
import { HoodPanel } from "./panel";

let panel: HoodPanel | undefined;

const WEBSITE_URL = "https://comforting-eclair-002ce3.netlify.app/"; // change this

function getActiveTerminalName(): string {
  return vscode.window.activeTerminal?.name ?? "";
}

function shouldShowPanel(): boolean {
  const terminalName = getActiveTerminalName();
  return Boolean(detectorRegistry.detect(terminalName));
}

function syncPanel(): void {
  const active = shouldShowPanel();

  if (active) {
    if (!panel) {
      panel = new HoodPanel(WEBSITE_URL);
    }
    panel.show();
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
        panel = new HoodPanel(WEBSITE_URL);
      }
      panel.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showAd", () => {
      if (!panel) {
        panel = new HoodPanel(WEBSITE_URL);
      }
      panel.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showEarnings", () => {
      vscode.window.showInformationMessage("HoodAI is active.");
    })
  );

  context.subscriptions.push(vscode.window.onDidChangeActiveTerminal(syncPanel));
  context.subscriptions.push(vscode.window.onDidOpenTerminal(syncPanel));
  context.subscriptions.push(vscode.window.onDidCloseTerminal(syncPanel));

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
      if (
        event.affectsConfiguration("hoodai.enabled") ||
        event.affectsConfiguration("hoodai.apiToken") ||
        event.affectsConfiguration("hoodai.refreshIntervalSeconds")
      ) {
        syncPanel();
      }
    })
  );

  setInterval(syncPanel, 1000);
  syncPanel();
}

export function deactivate(): void {
  if (panel) {
    panel.dispose();
    panel = undefined;
  }
}
