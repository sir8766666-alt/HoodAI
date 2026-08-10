import * as vscode from "vscode";
import { ClaudeDetector } from "./detectors/claude";

export type DetectorState = "idle" | "thinking";

export interface DetectorStatus {
    state: DetectorState;
    assistant?: string;
}

export interface AIDetector extends vscode.Disposable {
    start(): void;
    stop(): void;
    getStatus(): DetectorStatus;
    onStatusChange(
        listener: (status: DetectorStatus) => void
    ): vscode.Disposable;
}

export function createAIDetector(
    intervalMs = 2500
): AIDetector {
    const claude = new ClaudeDetector(intervalMs);

    return {
        start(): void {
            claude.start();
        },

        stop(): void {
            claude.stop();
        },

        getStatus(): DetectorStatus {
            return claude.getStatus();
        },

        onStatusChange(
            listener: (status: DetectorStatus) => void
        ): vscode.Disposable {
            return claude.onStatusChange(listener);
        },

        dispose(): void {
            claude.dispose();
        },
    };
}
