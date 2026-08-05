import * as vscode from "vscode";

/* ------------------------------------------------ */
/* Logger                                            */
/* ------------------------------------------------ */

export class Logger {

    static info(...args: any[]) {

        console.log("[HoodAI]", ...args);

    }

    static warn(...args: any[]) {

        console.warn("[HoodAI]", ...args);

    }

    static error(...args: any[]) {

        console.error("[HoodAI]", ...args);

    }

}

/* ------------------------------------------------ */
/* Delay                                             */
/* ------------------------------------------------ */

export function sleep(ms: number): Promise<void> {

    return new Promise(resolve => {

        setTimeout(resolve, ms);

    });

}

/* ------------------------------------------------ */
/* Debounce                                          */
/* ------------------------------------------------ */

export function debounce<T extends (...args: any[]) => void>(
    fn: T,
    wait: number
): T {

    let timeout: NodeJS.Timeout;

    return ((...args: any[]) => {

        clearTimeout(timeout);

        timeout = setTimeout(() => {

            fn(...args);

        }, wait);

    }) as T;

}

/* ------------------------------------------------ */
/* Random Id                                         */
/* ------------------------------------------------ */

export function randomId(length = 16): string {

    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

    let result = "";

    for (let i = 0; i < length; i++) {

        result += chars.charAt(
            Math.floor(Math.random() * chars.length)
        );

    }

    return result;

}

/* ------------------------------------------------ */
/* Nonce                                             */
/* ------------------------------------------------ */

export function createNonce(): string {

    return randomId(32);

}

/* ------------------------------------------------ */
/* HTML Escape                                       */
/* ------------------------------------------------ */

export function escapeHtml(text: string): string {

    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

}

/* ------------------------------------------------ */
/* Open URL                                          */
/* ------------------------------------------------ */

export async function openUrl(url: string) {

    try {

        await vscode.env.openExternal(
            vscode.Uri.parse(url)
        );

    } catch (err) {

        Logger.error(err);

    }

}

/* ------------------------------------------------ */
/* Time                                              */
/* ------------------------------------------------ */

export function now(): number {

    return Date.now();

}

/* ------------------------------------------------ */
/* Elapsed Time                                      */
/* ------------------------------------------------ */

export function elapsed(start: number): number {

    return Date.now() - start;

}

/* ------------------------------------------------ */
/* Safe JSON                                         */
/* ------------------------------------------------ */

export function safeJson(text: string): any {

    try {

        return JSON.parse(text);

    } catch {

        return null;

    }

}

/* ------------------------------------------------ */
/* Is Empty                                          */
/* ------------------------------------------------ */

export function isEmpty(value: any): boolean {

    return (
        value === null ||
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
    );

}

/* ------------------------------------------------ */
/* Clamp                                              */
/* ------------------------------------------------ */

export function clamp(
    value: number,
    min: number,
    max: number
): number {

    return Math.min(
        Math.max(value, min),
        max
    );

}

/* ------------------------------------------------ */
/* Format Duration                                   */
/* ------------------------------------------------ */

export function formatDuration(ms: number): string {

    const seconds = Math.floor(ms / 1000);

    if (seconds < 60) {

        return `${seconds}s`;

    }

    const minutes = Math.floor(seconds / 60);

    if (minutes < 60) {

        return `${minutes}m`;

    }

    const hours = Math.floor(minutes / 60);

    return `${hours}h`;

}

/* ------------------------------------------------ */
/* Is Claude Terminal                               */
/* ------------------------------------------------ */

export function isClaudeTerminal(
    terminal: vscode.Terminal
): boolean {

    return /claude|anthropic|claude code/i.test(
        terminal.name
    );

}

/* ------------------------------------------------ */
/* Active Claude Terminal                           */
/* ------------------------------------------------ */

export function getClaudeTerminal():
    vscode.Terminal | undefined {

    return vscode.window.terminals.find(
        isClaudeTerminal
    );

}

/* ------------------------------------------------ */
/* Version                                           */
/* ------------------------------------------------ */

export const VERSION = "0.2.5";

/* ------------------------------------------------ */
/* Extension Name                                    */
/* ------------------------------------------------ */

export const EXTENSION_NAME = "HoodAI";
