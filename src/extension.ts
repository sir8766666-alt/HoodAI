import * as vscode from "vscode";

import {
    createAIDetector,
    DetectorStatus,
} from "./detector";

import { HoodPanel } from "./panel";

import {
    getWebsiteUrl,
    hasApiToken,
    isEnabled,
    verifyToken,
    getStats,
} from "./api";

import { installClaudeHooks } from "./claude-hooks";

let panel: HoodPanel | undefined;
let statusBarItem:
    vscode.StatusBarItem | undefined;

let earningsTimer:
    NodeJS.Timeout | undefined;

let output:
    vscode.OutputChannel | undefined;

const detector =
    createAIDetector(
        500,
        undefined
    );

let activeDetectorName = "Claude Code";

let currentBalanceText = "$0.00";

let currentThinking = false;

function log(message: string): void {
    output?.appendLine(message);
    console.log(message);
}

function disposePanel(): void {
    if (panel) {
        panel.dispose();
        panel = undefined;
    }
}

function ensurePanel(): void {
    if (!panel) {
        panel = new HoodPanel(
            getWebsiteUrl()
        );
    }
}

function updateStatusBar(): void {
    if (!statusBarItem) {
        return;
    }

    if (!isEnabled()) {
        statusBarItem.text =
            "$(circle-slash) HoodAI";

        statusBarItem.tooltip =
            "HoodAI is disabled";

        statusBarItem.command =
            "hoodai.openSettings";

        statusBarItem.show();

        return;
    }

    if (!hasApiToken()) {
        statusBarItem.text =
            "$(key) HoodAI";

        statusBarItem.tooltip =
            "Paste your HoodAI access token";

        statusBarItem.command =
            "hoodai.openSettings";

        statusBarItem.show();

        return;
    }

    /*
     * IMPORTANT:
     * The visible phrase is always "thinking..."
     * when the detector says Claude is active.
     */
    if (currentThinking) {
        statusBarItem.text =
            `$(sync~spin) thinking...`;
    } else {
        statusBarItem.text =
            `$(credit-card) ${currentBalanceText}`;
    }

    statusBarItem.tooltip =
        currentThinking
            ? `HoodAI: ${activeDetectorName} is active`
            : `HoodAI balance: ${currentBalanceText}`;

    statusBarItem.command =
        "hoodai.showEarnings";

    statusBarItem.show();
}

async function refreshEarnings(): Promise<void> {
    if (
        !hasApiToken() ||
        !isEnabled()
    ) {
        currentBalanceText =
            "$0.00";

        updateStatusBar();

        return;
    }

    const stats =
        await getStats();

    if (stats.error) {
        updateStatusBar();
        return;
    }

    const balance =
        stats.user?.earnings_usd ??
        stats.earnings_usd ??
        0;

    currentBalanceText =
        `$${balance.toFixed(2)}`;

    updateStatusBar();
}

function applyDetectorStatus(
    status: DetectorStatus
): void {
    currentThinking =
        status.state === "thinking" &&
        isEnabled() &&
        hasApiToken();

    activeDetectorName =
        status.assistant ||
        "Claude Code";

    log(
        `[HoodAI Detector] ${activeDetectorName}: ${status.state}`
    );

    updateStatusBar();

    if (currentThinking) {
        ensurePanel();
        panel?.show();

        log(
            "[HoodAI] Popup opened."
        );
    } else {
        disposePanel();

        log(
            "[HoodAI] Popup closed."
        );
    }
}

async function checkToken(): Promise<void> {
    if (!hasApiToken()) {
        vscode.window.showWarningMessage(
            "HoodAI access token is missing."
        );

        return;
    }

    const result =
        await verifyToken();

    if (result.success) {
        vscode.window.showInformationMessage(
            `HoodAI token verified${
                result.email
                    ? ` for ${result.email}`
                    : ""
            }.`
        );

        return;
    }

    vscode.window.showErrorMessage(
        result.error ??
            "HoodAI token verification failed."
    );
}

async function showEarnings(): Promise<void> {
    if (!hasApiToken()) {
        vscode.window.showWarningMessage(
            "HoodAI access token is missing."
        );

        return;
    }

    const stats =
        await getStats();

    if (stats.error) {
        vscode.window.showErrorMessage(
            stats.error
        );

        return;
    }

    const balance =
        stats.user?.earnings_usd ??
        stats.earnings_usd ??
        0;

    const today =
        stats.today?.earnings_usd ?? 0;

    const month =
        stats.month?.earnings_usd ?? 0;

    const impressions =
        stats.today?.impressions ??
        stats.user?.impressions ??
        stats.impressions ??
        0;

    const clicks =
        stats.today?.clicks ??
        stats.user?.clicks ??
        stats.clicks ??
        0;

    vscode.window.showInformationMessage(
        `Balance: $${balance.toFixed(2)} | ` +
        `Today: $${today.toFixed(2)} | ` +
        `Month: $${month.toFixed(2)} | ` +
        `Impressions: ${impressions} | ` +
        `Clicks: ${clicks}`
    );
}

export function activate(
    context: vscode.ExtensionContext
): void {
    output =
        vscode.window.createOutputChannel(
            "HoodAI"
        );

    log(
        "[HoodAI] Extension activated."
    );

    /*
     * Automatically install the Claude integration globally.
     * Users do not need to create .claude files in repositories.
     */
    void installClaudeHooks(
        context,
        output
    );

    /*
     * Re-create detector with output logging.
     */
    const loggingDetector =
        createAIDetector(
            500,
            output
        );

    statusBarItem =
        vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );

    statusBarItem.text =
        "$(credit-card) $0.00";

    statusBarItem.tooltip =
        "HoodAI balance";

    statusBarItem.command =
        "hoodai.showEarnings";

    statusBarItem.show();

    context.subscriptions.push(
        statusBarItem
    );

    context.subscriptions.push(
        output
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "hoodai.open",
            () => {
                ensurePanel();
                panel?.show();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "hoodai.showAd",
            () => {
                ensurePanel();
                panel?.show();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "hoodai.showEarnings",
            async () => {
                await showEarnings();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "hoodai.openSettings",
            () => {
                void vscode.commands.executeCommand(
                    "workbench.action.openSettings",
                    "hoodai"
                );
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "hoodai.checkToken",
            async () => {
                await checkToken();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "hoodai.showOutput",
            () => {
                output?.show(true);
            }
        )
    );

    context.subscriptions.push(
        loggingDetector.onStatusChange(
            (status) => {
                applyDetectorStatus(
                    status
                );
            }
        )
    );

    context.subscriptions.push(
        loggingDetector
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(
            (
                event:
                    vscode.ConfigurationChangeEvent
            ) => {
                if (
                    event.affectsConfiguration(
                        "hoodai.enabled"
                    ) ||
                    event.affectsConfiguration(
                        "hoodai.apiToken"
                    )
                ) {
                    applyDetectorStatus(
                        loggingDetector.getStatus()
                    );

                    void refreshEarnings();
                }
            }
        )
    );

    loggingDetector.start();

    void refreshEarnings();

    earningsTimer =
        setInterval(
            () => {
                void refreshEarnings();
            },
            60000
        );

    context.subscriptions.push(
        new vscode.Disposable(
            () => {
                if (earningsTimer) {
                    clearInterval(
                        earningsTimer
                    );

                    earningsTimer =
                        undefined;
                }
            }
        )
    );

    updateStatusBar();
}

export function deactivate(): void {
    detector.stop();

    if (earningsTimer) {
        clearInterval(
            earningsTimer
        );

        earningsTimer = undefined;
    }

    disposePanel();

    if (statusBarItem) {
        statusBarItem.dispose();
        statusBarItem =
            undefined;
    }

    output?.dispose();
    output = undefined;
}
