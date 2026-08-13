import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const HOOK_MARKER = "hoodai-global-hook";
const HOOK_FILE_NAME = "hoodai-claude-hook.sh";

function getHomeDirectory(): string {
    return process.env.HOME ||
        process.env.USERPROFILE ||
        vscode.env.appRoot;
}

function getClaudeDirectory(): string {
    const configured = process.env.CLAUDE_CONFIG_DIR;

    if (configured && configured.trim()) {
        return configured;
    }

    return path.join(getHomeDirectory(), ".claude");
}

function getHookFilePath(
    context: vscode.ExtensionContext
): string {
    return path.join(
        context.globalStorageUri.fsPath,
        HOOK_FILE_NAME
    );
}

function hookScript(): string {
    return `#!/usr/bin/env bash

set -u

STATE_DIR="\${HOME}/.hoodai"
STATE_FILE="\${STATE_DIR}/claude-state.json"

STATE="\${1:-idle}"

if [ "$STATE" != "thinking" ] && [ "$STATE" != "idle" ]; then
    exit 0
fi

mkdir -p "$STATE_DIR" 2>/dev/null || exit 0

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

cat > "$STATE_FILE" <<EOF
{
  "state": "$STATE",
  "assistant": "Claude Code",
  "updatedAt": "$TIMESTAMP"
}
EOF

exit 0
`;
}

function quoteForShell(value: string): string {
    return `'${value.replace(/'/g, "'\\\\''")}'`;
}

function createHookEntry(
    hookPath: string,
    state: "thinking" | "idle"
): Record<string, unknown> {
    return {
        matcher: "",
        hooks: [
            {
                type: "command",
                command: `bash ${quoteForShell(hookPath)} ${state}`,
            },
        ],
    };
}

function isHoodAIEntry(
    entry: unknown
): boolean {
    if (!entry || typeof entry !== "object") {
        return false;
    }

    const value = JSON.stringify(entry);

    return value.includes(HOOK_MARKER);
}

function markEntry(
    entry: Record<string, unknown>
): Record<string, unknown> {
    return {
        ...entry,
        [HOOK_MARKER]: true,
    };
}

function ensureHookEvent(
    settings: Record<string, any>,
    event: string,
    desiredEntry: Record<string, unknown>
): void {
    if (!settings.hooks) {
        settings.hooks = {};
    }

    const existing = Array.isArray(settings.hooks[event])
        ? settings.hooks[event]
        : [];

    const filtered = existing.filter(
        (entry: unknown) => !isHoodAIEntry(entry)
    );

    filtered.push(markEntry(desiredEntry));

    settings.hooks[event] = filtered;
}

export async function installClaudeHooks(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): Promise<void> {
    try {
        const claudeDirectory = getClaudeDirectory();
        const hookPath = getHookFilePath(context);

        await fs.promises.mkdir(
            claudeDirectory,
            {
                recursive: true,
            }
        );

        await fs.promises.mkdir(
            path.dirname(hookPath),
            {
                recursive: true,
            }
        );

        await fs.promises.writeFile(
            hookPath,
            hookScript(),
            {
                encoding: "utf8",
                mode: 0o700,
            }
        );

        const settingsPath = path.join(
            claudeDirectory,
            "settings.json"
        );

        let settings: Record<string, any> = {};

        try {
            const raw = await fs.promises.readFile(
                settingsPath,
                "utf8"
            );

            settings = JSON.parse(raw);
        } catch {
            settings = {};
        }

        ensureHookEvent(
            settings,
            "UserPromptSubmit",
            createHookEntry(hookPath, "thinking")
        );

        ensureHookEvent(
            settings,
            "Stop",
            createHookEntry(hookPath, "idle")
        );

        ensureHookEvent(
            settings,
            "SessionEnd",
            createHookEntry(hookPath, "idle")
        );

        await fs.promises.writeFile(
            settingsPath,
            JSON.stringify(settings, null, 2) + "\n",
            "utf8"
        );

        output.appendLine(
            `[Claude Hooks] Global hooks installed: ${settingsPath}`
        );

        output.appendLine(
            `[Claude Hooks] Hook script: ${hookPath}`
        );
    } catch (error) {
        output.appendLine(
            `[Claude Hooks] Installation failed: ${
                error instanceof Error
                    ? error.message
                    : String(error)
            }`
        );
    }
}
