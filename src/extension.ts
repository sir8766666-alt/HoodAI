 import * as vscode from "vscode";
import { detectorRegistry } from "./detector";
import { HoodPanel } from "./panel";
import { getWebsiteUrl, hasApiToken, isEnabled, verifyToken } from "./api";

let panel: HoodPanel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let syncTimer: NodeJS.Timeout | undefined;
let activeDetectorName = "Unknown";

function getActiveTerminalName(): string {
  return vscode.window.activeTerminal?.name ?? "";
}

function disposePanel(): void {
  if (panel) {
    panel.dispose();
    panel = undefined;
  }
}

function updateStatusBar(generating: boolean): void {
  if (!statusBarItem) {
    return;
  }

  if (!isEnabled()) {
    statusBarItem.text = "$(circle-slash) HoodAI";
    statusBarItem.tooltip = "HoodAI is disabled";
    statusBarItem.command = "hoodai.open";
    statusBarItem.show();
    return;
  }

  if (!hasApiToken()) {
    statusBarItem.text = "$(key) HoodAI";
    statusBarItem.tooltip = "Paste your API token in HoodAI settings";
    statusBarItem.command = "hoodai.openSettings";
    statusBarItem.show();
    return;
  }

  statusBarItem.text = generating
    ? `$(sync~spin) HoodAI · ${activeDetectorName}`
    : "$(megaphone) HoodAI";

  statusBarItem.tooltip = generating
    ? `Showing your website while ${activeDetectorName} is active`
    : "HoodAI is ready";

  statusBarItem.command = "hoodai.showAd";
  statusBarItem.show();
}

function syncState(): void {
  const terminalName = getActiveTerminalName();
  const detector = detectorRegistry.detect(terminalName);
  const generating = Boolean(detector) && isEnabled() && hasApiToken();

  activeDetectorName = detector?.name ?? "Unknown";

  updateStatusBar(generating);

  if (generating) {
    if (!panel) {
      panel = new HoodPanel(getWebsiteUrl());
    }

    panel.show();
    return;
  }

  disposePanel();
}

async function checkToken(): Promise<void> {
  if (!hasApiToken()) {
    vscode.window.showWarningMessage("HoodAI API token is missing.");
    return;
  }

  const result = await verifyToken();

  if (result.ok) {
    vscode.window.showInformationMessage(
      `HoodAI token verified${result.user?.email ? ` for ${result.user.email}` : ""}.`
    );
    return;
  }

  vscode.window.showErrorMessage(
    result.error ?? "HoodAI token verification failed."
  );
}

export function activate(context: vscode.ExtensionContext): void {
  console.log("HoodAI activated");

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
    vscode.commands.registerCommand("hoodai.open", () => {
      if (!panel) {
        panel = new HoodPanel(getWebsiteUrl());
      }

      panel.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showAd", () => {
      if (!panel) {
        panel = new HoodPanel(getWebsiteUrl());
      }

      panel.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showEarnings", async () => {
      await checkToken();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "hoodai");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.checkToken", async () => {
      await checkToken();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal(() => syncState())
  );

  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => syncState())
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(() => syncState())
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
      if (
        event.affectsConfiguration("hoodai.enabled") ||
        event.affectsConfiguration("hoodai.apiToken") ||
        event.affectsConfiguration("hoodai.websiteUrl")
      ) {
        syncState();
      }
    })
  );

  syncTimer = setInterval(() => {
    syncState();
  }, 1000);

  context.subscriptions.push({
    dispose: () => {
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = undefined;
      }
    },
  });

  syncState();
}

export function deactivate(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = undefined;
  }

  disposePanel();

  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = undefined;
  }
}
