import * as vscode from "vscode";
import { fetchNextAd, fetchStats, logImpression, Ad } from "./api";
import { getOrCreateDeviceId, truncate } from "./utils";
import { showAdPanel } from "./panel";

let statusBarItem: vscode.StatusBarItem;
let currentAd: Ad | null = null;
let deviceId: string;
let refreshTimer: NodeJS.Timeout | undefined;

async function fetchAndShowAd() {
  const cfg = vscode.workspace.getConfiguration("hoodai");
  const enabled = cfg.get<boolean>("enabled", true);

  if (!enabled) {
    return;
  }

  try {
    const ad = await fetchNextAd(deviceId);

    if (!ad || !ad.text) {
      return;
    }

    currentAd = ad;

    statusBarItem.text = `$(megaphone) ${truncate(ad.text, 40)}`;
    statusBarItem.tooltip = "Sponsored — click to view (hoodAI)";
    statusBarItem.command = "hoodai.showAd";
    statusBarItem.show();

    await logImpression(deviceId, ad.ad_id);
  } catch (error) {
    console.error("hoodAI: failed to fetch ad", error);
  }
}

async function showEarnings() {
  try {
    const stats = await fetchStats(deviceId);

    if (!stats) {
      vscode.window.showWarningMessage("hoodAI: couldn't reach backend.");
      return;
    }

    vscode.window.showInformationMessage(
      `hoodAI — Impressions: ${stats.impressions_total}, Clicks: ${stats.clicks_total}, Earnings: $${Number(stats.earnings_total).toFixed(2)} (payout at $${stats.payout_threshold})`
    );
  } catch (error) {
    vscode.window.showErrorMessage("hoodAI: failed to load earnings.");
  }
}

export async function activate(context: vscode.ExtensionContext) {
  deviceId = getOrCreateDeviceId(context);

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showAd", () => {
      showAdPanel(context, deviceId, currentAd);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("hoodai.showEarnings", showEarnings)
  );

  await fetchAndShowAd();

  const intervalSec = vscode.workspace
    .getConfiguration("hoodai")
    .get<number>("refreshIntervalSeconds", 60);

  refreshTimer = setInterval(fetchAndShowAd, intervalSec * 1000);

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
