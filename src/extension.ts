import * as vscode from "vscode";
import { detectorRegistry } from "./detector";
import { HoodPanel } from "./panel";

let panel: HoodPanel | undefined;
let activeDetectorName = "Unknown";

function getActiveTerminalName(): string {
    return vscode.window.activeTerminal?.name ?? "";
}

function syncState(context: vscode.ExtensionContext): void {
    const terminalName = getActiveTerminalName();
    const detector = detectorRegistry.detect(terminalName);
    const generating = Boolean(detector);

    activeDetectorName = detector?.name ?? "Unknown";

    if (generating) {
        if (!panel) {
            panel = new HoodPanel(context);
        }

        panel.setGenerating(true);
        panel.show();
        return;
    }

    if (panel) {
        panel.setGenerating(false);
        panel.dispose();
        panel = undefined;
    }
}

export function activate(context: vscode.ExtensionContext): void {
    console.log("HoodAI activated");

    const openCommand = vscode.commands.registerCommand(
        "hoodai.open",
        () => {
            if (!panel) {
                panel = new HoodPanel(context);
            }

            panel.show();
            panel.setGenerating(Boolean(detectorRegistry.detect(getActiveTerminalName())));
        }
    );

    const refresh = () => syncState(context);

    context.subscriptions.push(openCommand);

    context.subscriptions.push(
        vscode.window.onDidChangeActiveTerminal(refresh)
    );

    context.subscriptions.push(
        vscode.window.onDidOpenTerminal(refresh)
    );

    context.subscriptions.push(
        vscode.window.onDidCloseTerminal(refresh)
    );

    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event: vscode.ConfigurationChangeEvent) => {
            if (
                event.affectsConfiguration("hoodai.enabled") ||
                event.affectsConfiguration("hoodai.apiToken") ||
                event.affectsConfiguration("hoodai.refreshIntervalSeconds")
            ) {
                refresh();
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("hoodai.showAd", () => {
            if (!panel) {
                panel = new HoodPanel(context);
            }

            panel.show();
            panel.setGenerating(Boolean(detectorRegistry.detect(getActiveTerminalName())));
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("hoodai.showEarnings", () => {
            vscode.window.showInformationMessage(
                `HoodAI active detector: ${activeDetectorName}`
            );
        })
    );

    refresh();
}

export function deactivate(): void {
    if (panel) {
        panel.dispose();
        panel = undefined;
    }
}
