import * as fs from "fs";
import * as vscode from "vscode";
import { DetectorStatus } from "../detector";

const STATE_FILE = "/tmp/hoodai/claude-state.json";

interface ClaudeStateFile {
    state?: "thinking" | "idle";
    assistant?: string;
    sessionId?: string;
    updatedAt?: string;
}

export class ClaudeDetector implements vscode.Disposable {
    private pollTimer: NodeJS.Timeout | undefined;
    private disposed = false;

    private status: DetectorStatus = {
        state: "idle",
        assistant: undefined,
    };

    private listeners: Array<(status: DetectorStatus) => void> = [];

    constructor(
        private readonly pollIntervalMs: number = 500
    ) {}

    start(): void {
        if (this.disposed) {
            return;
        }

        this.readState();

        /*
         * Watch the Claude state file for changes.
         * watchFile works well in Codespaces/Linux.
         */
        try {
            fs.watchFile(
                STATE_FILE,
                {
                    interval: this.pollIntervalMs,
                },
                () => {
                    this.readState();
                }
            );
        } catch (error) {
            console.error(
                "[HoodAI] Failed to watch Claude state file:",
                error
            );
        }

        /*
         * Poll as a reliable fallback.
         */
        this.pollTimer = setInterval(() => {
            this.readState();
        }, this.pollIntervalMs);
    }

    stop(): void {
        fs.unwatchFile(STATE_FILE);

        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
    }

    getStatus(): DetectorStatus {
        return {
            ...this.status,
        };
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

    private readState(): void {
        if (this.disposed) {
            return;
        }

        try {
            if (!fs.existsSync(STATE_FILE)) {
                this.updateStatus({
                    state: "idle",
                    assistant: undefined,
                });

                return;
            }

            const raw = fs.readFileSync(
                STATE_FILE,
                "utf8"
            );

            const data = JSON.parse(raw) as ClaudeStateFile;

            if (data.state === "thinking") {
                this.updateStatus({
                    state: "thinking",
                    assistant: data.assistant || "Claude Code",
                });

                return;
            }

            this.updateStatus({
                state: "idle",
                assistant: undefined,
            });
        } catch (error) {
            console.error(
                "[HoodAI] Failed to read Claude state:",
                error
            );

            this.updateStatus({
                state: "idle",
                assistant: undefined,
            });
        }
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
