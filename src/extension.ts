import * as vscode from "vscode";
import { HoodPanel } from "./panel";

let panel: HoodPanel | undefined;

export function activate(context: vscode.ExtensionContext) {

    console.log("HoodAI activated");

    const disposable = vscode.commands.registerCommand(
        "hoodai.open",
        () => {

            if (!panel) {
                panel = new HoodPanel(context);
            }

            panel.show();

        }
    );

    context.subscriptions.push(disposable);

    vscode.window.onDidChangeActiveTerminal(() => {

        if (!panel) {
            return;
        }

        const terminal = vscode.window.activeTerminal;

        if (!terminal) {
            panel.setGenerating(false);
            return;
        }

        const name = terminal.name.toLowerCase();

        const generating =
            name.includes("claude") ||
            name.includes("anthropic");

        panel.setGenerating(generating);

    });

}

export function deactivate() {}
