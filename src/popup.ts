type PopupStatusResult =
  | { ok: true; user: { email?: string; user_id?: string } }
  | { ok: false; error: string };

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el;
}

function setStatus(text: string, kind: "ok" | "bad" | "" = ""): void {
  const status = $("status");
  status.textContent = text;
  status.className = `status ${kind}`.trim();
}

function loadSettings(): void {
  chrome.storage.local.get(
    ["apiToken", "enabled"],
    (data: { apiToken?: string; enabled?: boolean }) => {
      const apiTokenInput = $("apiToken") as HTMLInputElement;
      const enabledInput = $("enabled") as HTMLInputElement;

      apiTokenInput.value = data.apiToken ?? "";
      enabledInput.checked = data.enabled !== false;
    }
  );
}

function saveSettings(): void {
  const apiToken = ($("apiToken") as HTMLInputElement).value.trim();
  const enabled = ($("enabled") as HTMLInputElement).checked;

  chrome.storage.local.set({ apiToken, enabled }, () => {
    setStatus("Saved.", "ok");
  });
}

function checkConnection(): void {
  chrome.runtime.sendMessage(
    { type: "hoodai:status" },
    (res: PopupStatusResult) => {
      const err = chrome.runtime.lastError;
      if (err) {
        setStatus(err.message, "bad");
        return;
      }

      if (res?.ok) {
        setStatus(
          `Connected as ${res.user.email ?? res.user.user_id ?? "user"}.`,
          "ok"
        );
      } else {
        setStatus(res?.error || "Not connected.", "bad");
      }
    }
  );
}

document.addEventListener("DOMContentLoaded", () => {
  loadSettings();

  ($("saveBtn") as HTMLButtonElement).addEventListener("click", saveSettings);
  ($("checkBtn") as HTMLButtonElement).addEventListener("click", checkConnection);
});
