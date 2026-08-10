export function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

export function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }

    if (maxLength <= 1) {
        return "…";
    }

    return text.slice(0, maxLength - 1) + "…";
}

export function formatUSD(value: number): string {
    const safeValue = Number.isFinite(value) ? value : 0;
    return `$${safeValue.toFixed(2)}`;
}

export function formatCount(value: number): string {
    const safeValue = Number.isFinite(value) ? Math.floor(value) : 0;
    return safeValue.toLocaleString("en-US");
}

export function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

export function safeJsonParse<T = unknown>(text: string, fallback: T): T {
    try {
        return JSON.parse(text) as T;
    } catch {
        return fallback;
    }
}

export function escapeHtml(input: string): string {
    return input
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

export function getStatusLabel(
    isThinking: boolean,
    assistantName: string,
    balanceText: string
): string {
    if (isThinking) {
        return `$(sync~spin) ${balanceText} · ${assistantName}`;
    }

    return `$(credit-card) ${balanceText}`;
}
