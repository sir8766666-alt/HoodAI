type PopupStatusResult =
  | { ok: true; user: { email?: string; user_id?: string } }
  | { ok: false; error: string };

function loadSettings() {
  chrome.storage.local.get(["apiToken", "enabled"], (data: { apiToken?: string; enabled?: boolean }) => {
    ($("apiToken") as HTMLInputElement).value = data.apiToken ?? "";
    ($("enabled") as HTMLInputElement).checked = data.enabled !== false;
  });
}

function checkConnection() {
  chrome.runtime.sendMessage({ type: "hoodai:status" }, (res: PopupStatusResult) => {
    const err = chrome.runtime.lastError;
    if (err) {
      setStatus(err.message, "bad");
      return;
    }

    if (res?.ok) {
      setStatus(`Connected as ${res.user.email ?? res.user.user_id ?? "user"}.`, "ok");
    } else {
      setStatus(res?.error || "Not connected.", "bad");
    }
  });
}
