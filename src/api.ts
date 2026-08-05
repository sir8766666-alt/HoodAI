import * as vscode from "vscode";

export interface ThinkingSession {
    id: string;
    tool: string;
    startedAt: number;
    active: boolean;
}

export interface HoodConfig {
    serverUrl: string;
    apiKey: string;
    enabled: boolean;
}

export class HoodAPI {

    private config: HoodConfig;

    constructor() {
        this.config = this.loadConfig();
    }

    private loadConfig(): HoodConfig {
        const cfg = vscode.workspace.getConfiguration("hoodai");

        return {
            serverUrl: cfg.get<string>("serverUrl", "https://your-domain.com"),
            apiKey: cfg.get<string>("apiKey", ""),
            enabled: cfg.get<boolean>("enabled", true)
        };
    }

    public reload() {
        this.config = this.loadConfig();
    }

    public isEnabled(): boolean {
        return this.config.enabled;
    }

    public createSession(tool: string): ThinkingSession {
        return {
            id: crypto.randomUUID(),
            tool,
            startedAt: Date.now(),
            active: true
        };
    }

    public async notifyThinkingStart(session: ThinkingSession): Promise<void> {

        if (!this.isEnabled()) return;

        try {

            await fetch(`${this.config.serverUrl}/api/thinking/start`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": this.config.apiKey
                },
                body: JSON.stringify(session)
            });

        } catch (err) {
            console.error("HoodAI start error", err);
        }
    }

    public async notifyThinkingStop(session: ThinkingSession): Promise<void> {

        if (!this.isEnabled()) return;

        try {

            await fetch(`${this.config.serverUrl}/api/thinking/stop`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": this.config.apiKey
                },
                body: JSON.stringify({
                    id: session.id,
                    tool: session.tool,
                    duration: Date.now() - session.startedAt
                })
            });

        } catch (err) {
            console.error("HoodAI stop error", err);
        }
    }

    public async heartbeat(session: ThinkingSession): Promise<void> {

        if (!this.isEnabled()) return;

        try {

            await fetch(`${this.config.serverUrl}/api/thinking/heartbeat`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": this.config.apiKey
                },
                body: JSON.stringify({
                    id: session.id,
                    tool: session.tool,
                    elapsed: Date.now() - session.startedAt
                })
            });

        } catch (err) {
            console.error(err);
        }
    }

    public async reportView(tool: string): Promise<void> {

        if (!this.isEnabled()) return;

        try {

            await fetch(`${this.config.serverUrl}/api/view`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": this.config.apiKey
                },
                body: JSON.stringify({
                    tool,
                    timestamp: Date.now()
                })
            });

        } catch (err) {
            console.error(err);
        }
    }

}
