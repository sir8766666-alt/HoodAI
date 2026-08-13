import * as fs from "fs";
import * as vscode from "vscode";

import { DetectorStatus } from "../detector";

interface ClaudeState {
    state?: "thinking" | "idle";
    assistant?: string;
    updatedAt?: string;
}

export class ClaudeDetector implements vscode.Disposable {
    private readonly stateFile: string;

    private pollTimer: NodeJS.Timeout | undefined;

    private disposed = false;

    private status: DetectorStatus = {
        state: "idle",
        assistant: undefined,
    };

    private listeners: Array<
        (status: DetectorStatus) => void
    > = [];

    constructor(
        private readonly pollIntervalMs = 500,
        private readonly output?: vscode.OutputChannel
    ) {
        const home =
            process.env.HOME ||
            process.env.USERPROFILE ||
            "";

        const configDir =
            process.env.CLAUDE_CONFIG_DIR &&
            process.env.CLAUDE_CONFIG_DIR.trim()
                ? process.env.CLAUDE_CONFIG_DIR
                : home;

        this.stateFile =
            `${configDir}/.hoodai/claude-state.json`;
    }

    start(): void {
        if (this.disposed || this.pollTimer) {
            return;
        }

        this.log(
            `[HoodAI Detector] Starting detector`
        );

        this.readState();

        this.pollTimer = setInterval(
            () => {
                this.readState();
            },
            this.pollIntervalMs
        );
    }

    stop(): void {
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
            const index =
                this.listeners.indexOf(listener);

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
            if (!fs.existsSync(this.stateFile)) {
                this.updateStatus({
                    state: "idle",
                    assistant: undefined,
                });

                return;
            }

            const raw =
                fs.readFileSync(
                    this.stateFile,
                    "utf8"
                );

            const state =
                JSON.parse(raw) as ClaudeState;

            if (state.state !== "thinking") {
                this.updateStatus({
                    state: "idle",
                    assistant: undefined,
                });

                return;
            }

            /*
             * Prevent a stale state file from keeping the popup
             * open forever if Claude crashes or the machine sleeps.
             */
            if (
                state.updatedAt &&
                Date.now() -
                    Date.parse(state.updatedAt) >
                    10 * 60 * 1000
            ) {
                this.log(
                    "[HoodAI Detector] Ignoring stale thinking state."
                );

                this.updateStatus({
                    state: "idle",
                    assistant: undefined,
                });

                return;
            }

            this.updateStatus({
                state: "thinking",
                assistant:
                    state.assistant ||
                    "Claude Code",
            });
        } catch (error) {
            this.log(
                `[HoodAI Detector] State read error: ${
                    error instanceof Error
                        ? error.message
                        : String(error)
                }`
            );

            this.updateStatus({
                state: "idle",
                assistant: undefined,
            });
        }
    }

    private updateStatus(
        next: DetectorStatus
    ): void {
        const changed =
            next.state !== this.status.state ||
            next.assistant !==
                this.status.assistant;

        if (!changed) {
            return;
        }

        this.status = next;

        this.log(
            `[HoodAI Detector] Claude state: ${next.state}`
        );

        for (
            const listener of [...this.listeners]
        ) {
            try {
                listener(
                    this.getStatus()
                );
            } catch (error) {
                this.log(
                    `[HoodAI Detector] Listener error: ${
                        error instanceof Error
                            ? error.message
                            : String(error)
                    }`
                );
            }
        }
    }

    private log(message: string): void {
        this.output?.appendLine(message);
        console.log(message);
    }
}
