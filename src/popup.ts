type StatusResult =
  | { ok: true; user: { email?: string; user_id?: string } }
  | { ok: false; error: string };

function $(id: string) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

function setStatus(text: string, kind: "ok" | "bad" | "" = "") {
  const status = $("status");
  status.textContent = text;
  status.className = `status ${kind}`.trim();
}

function loadSettings() {
  chrome.storage.local.get(["apiToken", "enabled"], (data) => {
    ($("apiToken") as HTMLInputElement).value = data.apiToken || "";
    ($("enabled") as HTMLInputElement).checked = data.enabled !== false;
  });
}

function saveSettings() {
  const apiToken = ($("apiToken") as HTMLInputElement).value.trim();
  const enabled = ($("enabled") as HTMLInputElement).checked;

  chrome.storage.local.set({ apiToken, enabled }, () => {
    setStatus("Saved.", "ok");
  });
}

function checkConnection() {
  chrome.runtime.sendMessage({ type: "hoodai:status" }, (res: StatusResult) => {
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

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  ($("saveBtn") as HTMLButtonElement).addEventListener("click", saveSettings);
  ($("checkBtn") as HTMLButtonElement).addEventListener("click", checkConnection);
});
