import * as vscode from "vscode";
import { exec } from "child_process";
import { DetectorStatus } from "../detector";

export class ClaudeDetector implements vscode.Disposable {
    private timer: NodeJS.Timeout | undefined;
    private disposed = false;

    private status: DetectorStatus = {
        state: "idle",
        assistant: undefined,
    };

    private listeners: Array<(status: DetectorStatus) => void> = [];

    constructor(private readonly intervalMs: number = 1000) {}

    start(): void {
        if (this.timer || this.disposed) {
            return;
        }

        void this.check();

        this.timer = setInterval(() => {
            void this.check();
        }, this.intervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    getStatus(): DetectorStatus {
        return { ...this.status };
    }

    onStatusChange(
        listener: (status: DetectorStatus) => void
    ): vscode.Disposable {
        this.listeners.push(listener);

        return new vscode.Disposable(() => {
            const index = this.listeners.indexOf(listener);

            if (index !== -1) {
                this.listeners.splice(index, 1);
            }
        });
    }

    dispose(): void {
        this.disposed = true;
        this.stop();
        this.listeners.length = 0;
    }

    private async check(): Promise<void> {
        if (this.disposed) {
            return;
        }

        const terminal = vscode.window.activeTerminal;

        // Claude Code terminal is the strongest signal in Codespaces.
        const terminalName = terminal?.name?.toLowerCase() ?? "";

        const terminalLooksLikeClaude =
            terminalName.includes("claude") ||
            terminalName.includes("anthropic");

        const processLooksLikeClaude =
            await this.detectClaudeProcess();

        const claudeActive =
            terminalLooksLikeClaude || processLooksLikeClaude;

        const nextStatus: DetectorStatus = claudeActive
            ? {
                  state: "thinking",
                  assistant: "Claude Code",
              }
            : {
                  state: "idle",
                  assistant: undefined,
              };

        this.updateStatus(nextStatus);
    }

    private detectClaudeProcess(): Promise<boolean> {
        return new Promise((resolve) => {
            const command =
                process.platform === "win32"
                    ? "tasklist"
                    : "ps -A -o command=";

            exec(
                command,
                {
                    timeout: 2000,
                    maxBuffer: 1024 * 1024,
                },
                (error, stdout) => {
                    if (error || !stdout) {
                        resolve(false);
                        return;
                    }

                    const output = stdout.toLowerCase();

                    const markers = [
                        "claude-code",
                        "@anthropic-ai/claude-code",
                        "claude code",
                        "anthropic",
                    ];

                    resolve(
                        markers.some((marker) =>
                            output.includes(marker)
                        )
                    );
                }
            );
        });
    }

    private updateStatus(next: DetectorStatus): void {
        const changed =
            next.state !== this.status.state ||
            next.assistant !== this.status.assistant;

        if (!changed) {
            return;
        }

        this.status = next;

        for (const listener of [...this.listeners]) {
            try {
                listener(this.getStatus());
            } catch (error) {
                console.error(
                    "[HoodAI] Detector listener failed:",
                    error
                );
            }
        }
    }
}
