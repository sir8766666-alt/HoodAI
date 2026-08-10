import * as vscode from "vscode";
import { exec } from "child_process";
import { DetectorState, DetectorStatus } from "../detector";

const CLAUDE_MARKERS: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\bclaude\b/i, name: "Claude Code" },
    { pattern: /\bclaude-code\b/i, name: "Claude Code" },
    { pattern: /\banthropic\b/i, name: "Claude Code" }
];

export class ClaudeDetector implements vscode.Disposable {
    private timer: NodeJS.Timeout | undefined;
    private disposed = false;

    private status: DetectorStatus = {
        state: "idle",
        assistant: undefined
    };

    private listeners: Array<(status: DetectorStatus) => void> = [];

    constructor(
        private readonly intervalMs: number = 2500
    ) {}

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

        try {
            const assistant = await this.detectClaudeProcess();

            const nextStatus: DetectorStatus = assistant
                ? {
                    state: "thinking" as DetectorState,
                    assistant
                }
                : {
                    state: "idle" as DetectorState,
                    assistant: undefined
                };

            this.updateStatus(nextStatus);
        } catch {
            this.updateStatus({
                state: "idle",
                assistant: undefined
            });
        }
    }

    private detectClaudeProcess(): Promise<string | undefined> {
        return new Promise((resolve) => {
            const command =
                process.platform === "win32"
                    ? "tasklist"
                    : "ps -A -o command=";

            exec(
                command,
                {
                    timeout: 2000,
                    maxBuffer: 1024 * 1024
                },
                (error, stdout) => {
                    if (error || !stdout) {
                        resolve(undefined);
                        return;
                    }

                    const output = stdout.toLowerCase();

                    for (const marker of CLAUDE_MARKERS) {
                        if (marker.pattern.test(output)) {
                            resolve(marker.name);
                            return;
                        }
                    }

                    resolve(undefined);
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
            } catch {
                // Keep detector stable even if one listener fails.
            }
        }
    }
}
