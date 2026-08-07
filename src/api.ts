import * as vscode from "vscode";

export interface Ad {
  ad_id: string;
  title: string;
  text: string;
  image?: string;
  link?: string;
  provider?: string;
  impression_id?: string;
}

export interface HoodConfig {
  backendUrl: string;
  apiToken: string;
  enabled: boolean;
  websiteUrl: string;
}

export interface AuthCheckResult {
  ok: boolean;
  user?: {
    user_id?: string;
    email?: string;
    name?: string;
  };
  error?: string;
}

const DEFAULT_BACKEND_URL = "https://hoodai-zscw.onrender.com";

export function getConfig(): HoodConfig {
  const cfg = vscode.workspace.getConfiguration("hoodai");

  return {
    backendUrl: cfg.get<string>("backendUrl", DEFAULT_BACKEND_URL).trim(),
    apiToken: cfg.get<string>("apiToken", "").trim(),
    enabled: cfg.get<boolean>("enabled", true),
    websiteUrl: cfg.get<string>("websiteUrl", "https://hoodai.dev").trim(),
  };
}

function getAuthHeaders() {
  const { apiToken } = getConfig();

  if (!apiToken) {
    return {
      "Content-Type": "application/json",
    };
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiToken}`,
  };
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
  const { apiToken } = getConfig();

  if (!apiToken) {
    return {
      ok: false,
      error: "Missing API token.",
    };
  }

  try {
    const result = await requestJson<AuthCheckResult>("/auth/me", "GET");
    return result;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Token verification failed.",
    };
  }
}

export async function getNextAd(): Promise<Ad | null> {
  try {
    const ad = await requestJson<Ad>("/ad/next", "GET");
    return ad;
  } catch (err) {
    console.error("[HoodAI] getNextAd failed:", err);
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
  } catch (err) {
    console.error("[HoodAI] sendImpression failed:", err);
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
  } catch (err) {
    console.error("[HoodAI] sendClick failed:", err);
  }
}

export function getWebsiteUrl(): string {
  return getConfig().websiteUrl;
}

export function isEnabled(): boolean {
  return getConfig().enabled;
}

export function hasApiToken(): boolean {
  return getConfig().apiToken.length > 0;
}
