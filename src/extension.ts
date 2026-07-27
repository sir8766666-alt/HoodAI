import * as vscode from "vscode";
import * as https from "https";
import * as http from "http";
import * as crypto from "crypto";
import { initializePlayaYield } from "@playanext/playa-yield-sdk";

interface Ad {
  ad_id: string;
  title?: string;
  text: string;
  image?: string;
  link?: string;
}

let statusBarItem: vscode.StatusBarItem;
let currentAd: Ad | null = null;
let deviceId: string;
let refreshTimer: NodeJS.Timeout | undefined;

export async function activate(context: vscode.ExtensionContext) {

  // Initialize PlayaYield
  initializePlayaYield({
    apiKey: vscode.workspace
      .getConfiguration("hoodai")
      .get<string>("playaYieldApiKey") || ""
  });

  deviceId = getOrCreateDeviceId(context);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );

  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "hoodai.showAd",
      () => showAdPanel(context)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "hoodai.showEarnings",
      showEarnings
    )
  );

  await fetchAndShowAd();

  const interval =
    vscode.workspace
      .getConfiguration("hoodai")
      .get<number>("refreshIntervalSeconds") || 60;

  refreshTimer = setInterval(fetchAndShowAd, interval * 1000);

  context.subscriptions.push({
    dispose: () => {
      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
    },
  });
}

export function deactivate() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
}
