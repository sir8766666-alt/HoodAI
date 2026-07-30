type Ad = {
  ad_id: string;
  title?: string;
  text: string;
  image?: string;
  link?: string;
  provider?: string;
  impression_id?: string;
};

const API_BASE = "https://hoodai-zscw.onrender.com";

const FALLBACK_AD: Ad = {
  ad_id: "demo-ad-001",
  provider: "playayield",
  title: "Sponsored",
  text: "Ship faster with HoodAI developer tools.",
  image: "https://via.placeholder.com/640x360.png?text=HoodAI+Sponsored",
  link: "https://example.com",
  impression_id: `demo_${Date.now()}`
};

function storageGet(keys: string[]): Promise<Record<string, any>> {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function fetchJson(path: string, options: RequestInit = {}): Promise<any> {
  return new Promise(async (resolve, reject) => {
    try {
      const { apiToken } = await storageGet(["apiToken"]);
      if (!apiToken) {
        reject(new Error("Missing API token"));
        return;
      }

      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
          ...(options.headers || {})
        }
      });

      const text = await res.text();
      let data: any = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }

      if (!res.ok) {
        reject(new Error(data?.detail || data?.error || `HTTP ${res.status}`));
        return;
      }

      resolve(data);
    } catch (err) {
      reject(err);
    }
  });
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["enabled"], (res) => {
    if (typeof res.enabled !== "boolean") {
      chrome.storage.local.set({ enabled: true });
    }
  });
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;

  if (type === "hoodai:getAd") {
    (async () => {
      try {
        const ad = await fetchJson("/ad/next", { method: "GET" });
        sendResponse({ ok: true, ad: ad || FALLBACK_AD });
      } catch {
        sendResponse({ ok: true, ad: FALLBACK_AD });
      }
    })();

    return true;
  }

  if (type === "hoodai:trackImpression") {
    (async () => {
      try {
        await fetchJson("/ad/impression", {
          method: "POST",
          body: JSON.stringify(message.ad)
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();

    return true;
  }

  if (type === "hoodai:trackClick") {
    (async () => {
      try {
        await fetchJson("/ad/click", {
          method: "POST",
          body: JSON.stringify(message.ad)
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();

    return true;
  }

  return false;
});
export {};
