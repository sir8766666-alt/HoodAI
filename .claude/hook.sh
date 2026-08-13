import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const HOOK_FILE_NAME = "hoodai-claude-hook.sh";

function getHomeDirectory(): string {
    return (
        process.env.HOME ||
        process.env.USERPROFILE ||
        process.cwd()
    );
}

function getClaudeDirectory(): string {
    const configured =
        process.env.CLAUDE_CONFIG_DIR?.trim();

    if (configured) {
        return configured;
    }

    return path.join(
        getHomeDirectory(),
        ".claude"
    );
}

function getHookPath(
    context: vscode.ExtensionContext
): string {
    return path.join(
        context.globalStorageUri.fsPath,
        HOOK_FILE_NAME
    );
}

function createHookScript(): string {
    return `#!/usr/bin/env bash

set -u

STATE_DIR="\${HOME}/.hoodai"
STATE_FILE="\${STATE_DIR}/claude-state.json"

STATE="\${1:-idle}"

case "$STATE" in
    thinking)
        ;;
    idle)
        ;;
    *)
        exit 0
        ;;
esac

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

function shellQuote(value: string): string {
    return "'" +
        value.replace(
            /'/g,
            "'\\\\''"
        ) +
        "'";
}

function createCommand(
    hookPath: string,
    state: "thinking" | "idle"
): string {
    return (
        `bash ${shellQuote(hookPath)} ${state}` +
        ` # hoodai-global-hook`
    );
}

function isHoodAIHook(
    entry: unknown
): boolean {
    if (
        !entry ||
        typeof entry !== "object"
    ) {
        return false;
    }

    return JSON.stringify(entry)
        .includes("hoodai-global-hook");
}

function addHook(
    settings: Record<string, any>,
    event: string,
    command: string
): void {
    if (!settings.hooks) {
        settings.hooks = {};
    }

    const existing =
        Array.isArray(settings.hooks[event])
            ? settings.hooks[event]
            : [];

    const filtered =
        existing.filter(
            (entry: unknown) =>
                !isHoodAIHook(entry)
        );

    filtered.push({
        matcher: "",
        hooks: [
            {
                type: "command",
                command,
            },
        ],
    });

    settings.hooks[event] = filtered;
}

export async function installClaudeHooks(
    context: vscode.ExtensionContext,
    output: vscode.OutputChannel
): Promise<void> {
    try {
        const claudeDirectory =
            getClaudeDirectory();

        const hookPath =
            getHookPath(context);

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

        /*
         * We deliberately invoke this through bash.
         * chmod is NOT required for Claude Code.
         */
        await fs.promises.writeFile(
            hookPath,
            createHookScript(),
            {
                encoding: "utf8",
                mode: 0o600,
            }
        );

        const settingsPath =
            path.join(
                claudeDirectory,
                "settings.json"
            );

        let settings:
            Record<string, any> = {};

        try {
            const existing =
                await fs.promises.readFile(
                    settingsPath,
                    "utf8"
                );

            settings =
                JSON.parse(existing);
        } catch {
            settings = {};
        }

        addHook(
            settings,
            "UserPromptSubmit",
            createCommand(
                hookPath,
                "thinking"
            )
        );

        addHook(
            settings,
            "Stop",
            createCommand(
                hookPath,
                "idle"
            )
        );

        addHook(
            settings,
            "StopFailure",
            createCommand(
                hookPath,
                "idle"
            )
        );

        addHook(
            settings,
            "SessionEnd",
            createCommand(
                hookPath,
                "idle"
            )
        );

        await fs.promises.writeFile(
            settingsPath,
            JSON.stringify(
                settings,
                null,
                2
            ) + "\n",
            "utf8"
        );

        output.appendLine(
            "[HoodAI] Claude global integration installed."
        );

        output.appendLine(
            `[HoodAI] Claude settings: ${settingsPath}`
        );

        output.appendLine(
            `[HoodAI] Hook: ${hookPath}`
        );

        output.appendLine(
            "[HoodAI] No project .claude hook required."
        );
    } catch (error) {
        output.appendLine(
            `[HoodAI] Claude integration error: ${
                error instanceof Error
                    ? error.message
                    : String(error)
            }`
        );
    }
}
