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

        console.log("[HoodAI Detector] Starting detector");
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

        console.log("[HoodAI Detector] check() invoked");

        // Check all terminals for Claude Code indicators (not just active terminal)
        const terminals = vscode.window.terminals;
        let terminalLooksLikeClaude = false;
        let matchingTerminalName = "";

        for (const terminal of terminals) {
            const name = terminal?.name?.toLowerCase() ?? "";
            if (name.includes("claude") || name.includes("anthropic")) {
                terminalLooksLikeClaude = true;
                matchingTerminalName = name;
                break; // Found one, no need to check further
            }
        }

        // Fallback to active terminal if no terminals found (shouldn't happen but safe)
        if (terminals.length === 0) {
            const activeTerminal = vscode.window.activeTerminal;
            const activeName = activeTerminal?.name?.toLowerCase() ?? "";
            terminalLooksLikeClaude =
                activeName.includes("claude") ||
                activeName.includes("anthropic");
            matchingTerminalName = activeName;
        }

        const processLooksLikeClaude =
            await this.detectClaudeProcess();

        const claudeActive =
            terminalLooksLikeClaude || processLooksLikeClaude;

        // Diagnostic logging
        console.log(`[HoodAI Detector] Terminals checked: ${terminals.length}`,
                    `Matching terminal: "${matchingTerminalName}"`,
                    `Terminal match: ${terminalLooksLikeClaude}`,
                    `Process match: ${processLooksLikeClaude}`,
                    `Claude active: ${claudeActive}`);

        const nextStatus: DetectorStatus = claudeActive
            ? {
                  state: "thinking",
                  assistant: "Claude Code",
              }
            : {
                  state: "idle",
                  assistant: undefined,
              };

        console.log(`[HoodAI Detector] Previous status: ${JSON.stringify(this.status)}`);
        console.log(`[HoodAI Detector] Next status: ${JSON.stringify(nextStatus)}`);

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
                        console.log("[HoodAI Detector] Process detection failed:",
                            error || "no stdout");
                        resolve(false);
                        return;
                    }

                    const output = stdout.toLowerCase();

                    const markers = [
                        "claude-code",
                        "@anthropic-ai/claude-code",
                        "claude code",
                        "claude",
                        "anthropic",
                    ];

                    const isClaudeProcess = markers.some((marker) =>
                        output.includes(marker)
                    );

                    console.log(`[HoodAI Detector] Process check: ${isClaudeProcess}`);
                    if (isClaudeProcess) {
                        // Log a snippet of the output for debugging (first 200 chars)
                        const snippet = output.substring(0, Math.min(200, output.length));
                        console.log(`[HoodAI Detector] Process output snippet: "${snippet}..."`);
                    }

                    resolve(isClaudeProcess);
                }
            );
        });
    }

    private updateStatus(next: DetectorStatus): void {
        const changed =
            next.state !== this.status.state ||
            next.assistant !== this.status.assistant;

        if (!changed) {
            console.log("[HoodAI Detector] Status unchanged, skipping update");
            return;
        }

        console.log(`[HoodAI Detector] Status changing from ${JSON.stringify(this.status)} to ${JSON.stringify(next)}`);
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
