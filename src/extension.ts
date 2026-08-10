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
let earningsTimer: NodeJS.Timeout | undefined;
const detector = createAIDetector(2500);

let activeDetectorName = "Unknown";
let currentBalanceText = "$0.00";
let currentThinking = false;

function disposePanel(): void {
    if (panel) {
        panel.dispose();
        panel = undefined;
    }
}

function ensurePanel(): void {
    if (!panel) {
        panel = new HoodPanel(getWebsiteUrl());
    }
}

function updateStatusBar(): void {
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
        statusBarItem.tooltip = "Paste your HoodAI access token in settings";
        statusBarItem.command = "hoodai.openSettings";
        statusBarItem.show();
        return;
    }

    const balance = currentBalanceText || "$0.00";

    statusBarItem.text = currentThinking
        ? `$(sync~spin) ${balance} · ${activeDetectorName}`
        : `$(credit-card) ${balance}`;

    statusBarItem.tooltip = currentThinking
        ? `HoodAI is active while ${activeDetectorName} is thinking`
        : `HoodAI balance: ${balance}`;

    statusBarItem.command = "hoodai.showEarnings";
    statusBarItem.show();
}

async function refreshEarnings(): Promise<void> {
    if (!hasApiToken() || !isEnabled()) {
        currentBalanceText = "$0.00";
        updateStatusBar();
        return;
    }

    const stats = await getStats();

    if (stats.error) {
        currentBalanceText = "$0.00";
        updateStatusBar();
        return;
    }

    const balance = stats.user?.balance_usd ?? 0;
    currentBalanceText = `$${balance.toFixed(2)}`;
    updateStatusBar();
}

function applyDetectorStatus(status: DetectorStatus): void {
    currentThinking =
        status.state === "thinking" && isEnabled() && hasApiToken();

    activeDetectorName = status.assistant ?? "Unknown";

    updateStatusBar();

    if (currentThinking) {
        ensurePanel();
        panel?.show();
    } else {
        disposePanel();
    }
}

async function checkToken(): Promise<void> {
    if (!hasApiToken()) {
        vscode.window.showWarningMessage("HoodAI access token is missing.");
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

async function showEarnings(): Promise<void> {
    if (!hasApiToken()) {
        vscode.window.showWarningMessage("HoodAI access token is missing.");
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
    const impressions = stats.today?.impressions ?? 0;
    const clicks = stats.today?.clicks ?? 0;

    vscode.window.showInformationMessage(
        `Balance: $${balance.toFixed(2)} | Today: $${today.toFixed(2)} | Month: $${month.toFixed(2)} | Impressions: ${impressions} | Clicks: ${clicks}`
    );
}

export function activate(context: vscode.ExtensionContext): void {
    console.log("HoodAI activated");

    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = "$(credit-card) $0.00";
    statusBarItem.tooltip = "HoodAI balance";
    statusBarItem.command = "hoodai.showEarnings";
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
            await showEarnings();
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
        vscode.workspace.onDidChangeConfiguration(
            (event: vscode.ConfigurationChangeEvent) => {
                if (
                    event.affectsConfiguration("hoodai.enabled") ||
                    event.affectsConfiguration("hoodai.apiToken")
                ) {
                    applyDetectorStatus(detector.getStatus());
                    void refreshEarnings();
                }
            }
        )
    );

    context.subscriptions.push(
        detector.onStatusChange((status) => {
            applyDetectorStatus(status);
        })
    );

    context.subscriptions.push(detector);

    detector.start();

    void refreshEarnings();
    earningsTimer = setInterval(() => {
        void refreshEarnings();
    }, 60000);

    context.subscriptions.push({
        dispose: () => {
            if (earningsTimer) {
                clearInterval(earningsTimer);
                earningsTimer = undefined;
            }
        },
    });

    updateStatusBar();
}

export function deactivate(): void {
    detector.stop();

    if (earningsTimer) {
        clearInterval(earningsTimer);
        earningsTimer = undefined;
    }

    disposePanel();

    if (statusBarItem) {
        statusBarItem.dispose();
        statusBarItem = undefined;
    }
}
