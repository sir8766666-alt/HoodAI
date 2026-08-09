import * as vscode from "vscode";

const DEFAULT_BACKEND_URL = "https://hoodai-zscw.onrender.com";

export interface HoodConfig {
    backendUrl: string;
    apiToken: string;
    enabled: boolean;
    websiteUrl: string;
}

export interface AuthCheckResult {
    success: boolean;
    user_id?: string;
    email?: string;
    name?: string | null;
    api_token_last4?: string | null;
    error?: string;
}

export interface HoodUserProfile {
    success: boolean;
    user?: {
        user_id: string;
        email: string;
        name?: string | null;
        earnings_usd?: number;
        impressions_count?: number;
        clicks_count?: number;
        total_paid_usd?: number;
        payout_account?: Record<string, unknown>;
        payout_status?: Record<string, unknown>;
        api_token_last4?: string | null;
        created_at?: string;
    };
    error?: string;
}

export interface HoodStats {
    success?: boolean;
    user?: {
        user_id: string;
        email: string;
        name?: string | null;
        balance_usd?: number;
        total_paid_usd?: number;
        withdraw_enabled?: boolean;
        payout_account?: Record<string, unknown>;
        payout_status?: Record<string, unknown>;
        api_token_last4?: string | null;
    };
    today?: {
        earnings_usd: number;
        impressions: number;
        clicks: number;
    };
    month?: {
        earnings_usd: number;
        impressions: number;
        clicks: number;
    };
    graph?: Array<{
        date: string;
        impressions: number;
        clicks: number;
        earnings_usd: number;
    }>;
    error?: string;
}

export interface Ad {
    ad_id: string;
    provider?: string;
    title?: string;
    text?: string;
    image?: string;
    link?: string;
    impression_id?: string;
}

export interface PayoutAccountPayload {
    method: "upi" | "paypal";
    upi_id?: string;
    paypal_email?: string;
    name_on_account?: string;
}

export interface PayoutRequestResult {
    success: boolean;
    payout_id?: string;
    status?: string;
    amount_usd?: number;
    error?: string;
}

export function getConfig(): HoodConfig {
    const cfg = vscode.workspace.getConfiguration("hoodai");

    return {
        backendUrl: cfg.get<string>("backendUrl", DEFAULT_BACKEND_URL).trim(),
        apiToken: cfg.get<string>("apiToken", "").trim(),
        enabled: cfg.get<boolean>("enabled", true),
        websiteUrl: cfg.get<string>("websiteUrl", "https://hoodai.dev").trim(),
    };
}

export function hasApiToken(): boolean {
    return getConfig().apiToken.length > 0;
}

export function isEnabled(): boolean {
    return getConfig().enabled;
}

export function getWebsiteUrl(): string {
    return getConfig().websiteUrl;
}

function getAuthHeaders(): Record<string, string> {
    const { apiToken } = getConfig();

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    if (apiToken) {
        headers.Authorization = `Bearer ${apiToken}`;
    }

    return headers;
}

async function requestJson<T>(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: unknown
): Promise<T> {
    const { backendUrl, enabled } = getConfig();

    if (!enabled) {
        throw new Error("HoodAI is disabled.");
    }

    const response = await fetch(`${backendUrl}${endpoint}`, {
        method,
        headers: getAuthHeaders(),
        body: body ? JSON.stringify(body) : undefined,
    });

    const raw = await response.text();
    let parsed: any = null;

    if (raw) {
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = raw;
        }
    }

    if (!response.ok) {
        const detail =
            parsed?.detail ||
            parsed?.error ||
            `HTTP ${response.status}`;

        throw new Error(typeof detail === "string" ? detail : String(detail));
    }

    return parsed as T;
}

export async function verifyToken(): Promise<AuthCheckResult> {
    try {
        return await requestJson<AuthCheckResult>("/auth/verify", "POST");
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Token verification failed.",
        };
    }
}

export async function getAuthMe(): Promise<HoodUserProfile> {
    try {
        return await requestJson<HoodUserProfile>("/auth/me", "GET");
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to load profile.",
        };
    }
}

export async function getStats(): Promise<HoodStats> {
    try {
        return await requestJson<HoodStats>("/stats/me", "GET");
    } catch (error) {
        return {
            error: error instanceof Error ? error.message : "Failed to load stats.",
        };
    }
}

export async function bootstrapProfile(name?: string): Promise<{
    success: boolean;
    user_id?: string;
    email?: string;
    name?: string | null;
    api_token?: string;
    warning?: string;
    error?: string;
}> {
    try {
        return await requestJson("/auth/bootstrap", "POST", {
            name: name?.trim() || undefined,
        });
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Bootstrap failed.",
        };
    }
}

export async function getNextAd(): Promise<Ad | null> {
    try {
        return await requestJson<Ad>("/ad/next", "GET");
    } catch (error) {
        console.error("[HoodAI] getNextAd failed:", error);
        return null;
    }
}

export async function sendImpression(ad: Ad): Promise<void> {
    try {
        await requestJson("/ad/impression", "POST", {
            provider: ad.provider,
            ad_id: ad.ad_id,
            ad_title: ad.title,
            impression_id: ad.impression_id,
        });
    } catch (error) {
        console.error("[HoodAI] sendImpression failed:", error);
    }
}

export async function sendClick(ad: Ad): Promise<void> {
    try {
        await requestJson("/ad/click", "POST", {
            provider: ad.provider,
            ad_id: ad.ad_id,
            ad_title: ad.title,
            impression_id: ad.impression_id,
        });
    } catch (error) {
        console.error("[HoodAI] sendClick failed:", error);
    }
}

export async function savePayoutAccount(payload: PayoutAccountPayload): Promise<{
    success: boolean;
    payout_account?: Record<string, unknown>;
    error?: string;
}> {
    try {
        return await requestJson("/account/payout-account", "POST", payload);
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to save payout account.",
        };
    }
}

export async function requestPayout(): Promise<PayoutRequestResult> {
    try {
        return await requestJson<PayoutRequestResult>("/payout/request", "POST", {});
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Failed to request payout.",
        };
    }
}
