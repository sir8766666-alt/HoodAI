import * as vscode from "vscode";

const DEFAULT_BACKEND_URL = "https://hoodai-zscw.onrender.com";
const HOODAI_WEBPAGE_URL = "https://comforting-eclair-002ce3.netlify.app/";

export interface HoodConfig {
    backendUrl: string;
    apiToken: string;
    enabled: boolean;
}

export interface AuthCheckResult {
    success: boolean;
    user_id?: string;
    email?: string;
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
        user_id?: string;
        email?: string;
        name?: string | null;

        earnings_usd?: number;
        total_paid_usd?: number;

        impressions?: number;
        clicks?: number;

        withdraw_enabled?: boolean;
        threshold?: number;

        payout_account?: Record<string, unknown>;
        payout_status?: Record<string, unknown>;

        api_token_last4?: string | null;
    };

    /*
     * The current backend returns these values directly
     * from /stats/me, so we support both the current
     * backend shape and a future today/month shape.
     */
    earnings_usd?: number;
    total_paid_usd?: number;
    impressions?: number;
    clicks?: number;
    withdraw_enabled?: boolean;
    threshold?: number;

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

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

export function getBackendUrl(): string {
    return DEFAULT_BACKEND_URL;
}

export function getWebsiteUrl(): string {
    return HOODAI_WEBPAGE_URL;
}

export function getConfig(): HoodConfig {
    const config = vscode.workspace.getConfiguration("hoodai");

    return {
        backendUrl: DEFAULT_BACKEND_URL,
        apiToken: config.get<string>("apiToken", "").trim(),
        enabled: config.get<boolean>("enabled", true),
    };
}

export function hasApiToken(): boolean {
    return getConfig().apiToken.length > 0;
}

export function isEnabled(): boolean {
    return getConfig().enabled;
}

/* -------------------------------------------------------------------------- */
/* HTTP                                                                       */
/* -------------------------------------------------------------------------- */

function getAuthHeaders(): Record<string, string> {
    const { apiToken } = getConfig();

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
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
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const raw = await response.text();

    let data: any = null;

    if (raw) {
        try {
            data = JSON.parse(raw);
        } catch {
            data = null;
        }
    }

    if (!response.ok) {
        const detail =
            data?.detail ||
            data?.error ||
            `Request failed with HTTP ${response.status}`;

        throw new Error(String(detail));
    }

    return data as T;
}

/* -------------------------------------------------------------------------- */
/* Authentication                                                             */
/* -------------------------------------------------------------------------- */

export async function verifyToken(): Promise<AuthCheckResult> {
    try {
        return await requestJson<AuthCheckResult>(
            "/auth/verify",
            "POST"
        );
    } catch (error) {
        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Token verification failed.",
        };
    }
}

export async function getAuthMe(): Promise<HoodUserProfile> {
    try {
        return await requestJson<HoodUserProfile>(
            "/auth/me",
            "GET"
        );
    } catch (error) {
        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Failed to load profile.",
        };
    }
}

/* -------------------------------------------------------------------------- */
/* Earnings / Statistics                                                      */
/* -------------------------------------------------------------------------- */

export async function getStats(): Promise<HoodStats> {
    try {
        const response = await requestJson<any>(
            "/stats/me",
            "GET"
        );

        /*
         * Normalize the current backend response so the extension
         * can use one predictable structure.
         */
        const normalized: HoodStats = {
            success: response?.success ?? true,

            user: {
                user_id: response?.user_id,
                email: response?.email,
                earnings_usd: Number(response?.earnings_usd ?? 0),
                total_paid_usd: Number(response?.total_paid_usd ?? 0),
                impressions: Number(response?.impressions ?? 0),
                clicks: Number(response?.clicks ?? 0),
                withdraw_enabled:
                    Boolean(response?.withdraw_enabled),
                threshold: Number(response?.threshold ?? 0),
            },

            earnings_usd: Number(response?.earnings_usd ?? 0),
            total_paid_usd: Number(response?.total_paid_usd ?? 0),
            impressions: Number(response?.impressions ?? 0),
            clicks: Number(response?.clicks ?? 0),
            withdraw_enabled:
                Boolean(response?.withdraw_enabled),
            threshold: Number(response?.threshold ?? 0),
        };

        /*
         * Preserve these if the backend later adds them.
         */
        if (response?.today) {
            normalized.today = response.today;
        }

        if (response?.month) {
            normalized.month = response.month;
        }

        if (response?.graph) {
            normalized.graph = response.graph;
        }

        return normalized;
    } catch (error) {
        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Failed to load earnings.",
        };
    }
}

/* -------------------------------------------------------------------------- */
/* Ads                                                                        */
/* -------------------------------------------------------------------------- */

export async function getNextAd(): Promise<Ad | null> {
    try {
        return await requestJson<Ad>(
            "/ad/next",
            "GET"
        );
    } catch (error) {
        console.error(
            "[HoodAI] Failed to get next ad:",
            error
        );

        return null;
    }
}

export async function sendImpression(
    ad: Ad
): Promise<boolean> {
    try {
        await requestJson(
            "/ad/impression",
            "POST",
            {
                ad_id: ad.ad_id,
                ad_title: ad.title,
                provider: ad.provider,
                impression_id: ad.impression_id,
            }
        );

        return true;
    } catch (error) {
        console.error(
            "[HoodAI] Failed to send impression:",
            error
        );

        return false;
    }
}

export async function sendClick(
    ad: Ad
): Promise<boolean> {
    try {
        await requestJson(
            "/ad/click",
            "POST",
            {
                ad_id: ad.ad_id,
                ad_title: ad.title,
                provider: ad.provider,
                impression_id: ad.impression_id,
            }
        );

        return true;
    } catch (error) {
        console.error(
            "[HoodAI] Failed to send click:",
            error
        );

        return false;
    }
}

/* -------------------------------------------------------------------------- */
/* Payout                                                                     */
/* -------------------------------------------------------------------------- */

export async function savePayoutAccount(
    payload: PayoutAccountPayload
): Promise<{
    success: boolean;
    payout_account?: Record<string, unknown>;
    error?: string;
}> {
    try {
        return await requestJson(
            "/account/payout-account",
            "POST",
            payload
        );
    } catch (error) {
        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Failed to save payout account.",
        };
    }
}

export async function requestPayout(): Promise<PayoutRequestResult> {
    try {
        return await requestJson<PayoutRequestResult>(
            "/payout/request",
            "POST",
            {}
        );
    } catch (error) {
        return {
            success: false,
            error:
                error instanceof Error
                    ? error.message
                    : "Failed to request payout.",
        };
    }
}
