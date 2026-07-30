import * as https from "https";
import * as http from "http";
import * as vscode from "vscode";

export interface Ad {
  ad_id: string;
  title?: string;
  text: string;
  image?: string;
  link?: string;
}

function request(method: string, url: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const u = new URL(url);

    const req = lib.request(
      u,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export function getBackendUrl(): string {
  const cfg = vscode.workspace.getConfiguration("hoodai");
  return cfg.get<string>("backendUrl") || "http://localhost:8000";
}

export async function fetchNextAd(deviceId: string): Promise<Ad | null> {
  const backendUrl = getBackendUrl();
  return request("GET", `${backendUrl}/ad/next?device_id=${encodeURIComponent(deviceId)}`);
}

export async function logImpression(deviceId: string, adId: string): Promise<void> {
  const backendUrl = getBackendUrl();
  await request("POST", `${backendUrl}/ad/impression`, {
    device_id: deviceId,
    ad_id: adId,
  });
}

export async function logClick(deviceId: string, adId: string): Promise<void> {
  const backendUrl = getBackendUrl();
  await request("POST", `${backendUrl}/ad/click`, {
    device_id: deviceId,
    ad_id: adId,
  });
}

export async function fetchStats(deviceId: string): Promise<any> {
  const backendUrl = getBackendUrl();
  return request("GET", `${backendUrl}/stats/${encodeURIComponent(deviceId)}`);
}
