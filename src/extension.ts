import * as vscode from "vscode";
import { createAIDetector, DetectorStatus } from "./detector";
import { HoodPanel } from "./panel";
import {
  getWebsiteUrl,
  hasApiToken,
  isEnabled,
  verifyToken,
  getStats,
} from "./api";

let panel: HoodPanel | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let activeDetectorName = "Unknown";
let currentGenerating = false;
let currentWebsiteUrl = "";
let detector = createAIDetector(2500);

function disposePanel(): void {
  if (panel) {
    panel.dispose();
    panel = undefined;
  }
}

function ensurePanel(): void {
  const websiteUrl = getWebsiteUrl();

  if (!panel || currentWebsiteUrl !== websiteUrl) {
    disposePanel();
    currentWebsiteUrl = websiteUrl;
    panel = new HoodPanel(websiteUrl);
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

function applyDetectorStatus(status: DetectorStatus): void {
  const generating =
    status.state === "thinking" && isEnabled() && hasApiToken();

  activeDetectorName = status.assistant ?? "Unknown";
  currentGenerating = generating;

  updateStatusBar(generating);

  if (generating) {
    ensurePanel();
    panel?.show();
  } else {
    disposePanel();
  }
}

async function checkToken(): Promise<void> {
  if (!hasApiToken()) {
    vscode.window.showWarningMessage("HoodAI API token is missing.");
    return;
  }

  const result = await verifyToken();

  if (result.success) {
    vscode.window.showInformationMessage(
      `HoodAI token verified${result.email ? ` for ${result.email}` : ""}.`
    );
    return;
  }

  vscode.window.showErrorMessage(
    result.error ?? "HoodAI token verification failed."
  );
}

async function showStats(): Promise<void> {
  if (!hasApiToken()) {
    vscode.window.showWarningMessage("HoodAI API token is missing.");
    return;
  }

  const stats = await getStats();

  if (stats.error) {
    vscode.window.showErrorMessage(stats.error);
    return;
  }

  const balance = stats.user?.balance_usd ?? 0;
  const today = stats.today?.earnings_usd ?? 0;
  const month = stats.month?.earnings_usd ?? 0;
  const impressions = stats.user?.payout_status ? stats.today?.impressions ?? 0 : 0;
  const clicks = stats.today?.clicks ?? 0;

  vscode.window.showInformationMessage(
    `Balance: $${balance.toFixed(4)} | Today: $${today.toFixed(4)} | Month: $${month.toFixed(4)} | Impressions: ${impressions} | Clicks: ${clicks}`
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
      ensurePanel();
      panel?.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showAd", () => {
      ensurePanel();
      panel?.show();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showEarnings", async () => {
      await showStats();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.openSettings", () => {
      vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "hoodai"
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.checkToken", async () => {
      await checkToken();
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTerminal(() => {
      applyDetectorStatus(detector.getStatus());
    })
  );

  context.subscriptions.push(
    vscode.window.onDidOpenTerminal(() => {
      applyDetectorStatus(detector.getStatus());
    })
  );

  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(() => {
      applyDetectorStatus(detector.getStatus());
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
      if (
        event.affectsConfiguration("hoodai.enabled") ||
        event.affectsConfiguration("hoodai.apiToken") ||
        event.affectsConfiguration("hoodai.websiteUrl")
      ) {
        applyDetectorStatus(detector.getStatus());
      }
    })
  );

  context.subscriptions.push(
    detector.onStatusChange((status) => {
      applyDetectorStatus(status);
    })
  );

  context.subscriptions.push(detector);

  detector.start();
  applyDetectorStatus(detector.getStatus());
}

export function deactivate(): void {
  detector.stop();

  disposePanel();

  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = undefined;
  }
}
