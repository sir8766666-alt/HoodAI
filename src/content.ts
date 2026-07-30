type Ad = {
  ad_id: string;
  title?: string;
  text: string;
  image?: string;
  link?: string;
  provider?: string;
  impression_id?: string;
};

const WAIT_SELECTORS = [
  '[aria-busy="true"]',
  '[role="progressbar"]',
  '[data-loading="true"]',
  '[data-state="loading"]',
  '[class*="spinner"]',
  '[class*="loading"]',
  '[class*="progress"]'
];

const WAIT_KEYWORDS = [
  "thinking",
  "generating",
  "loading",
  "demonstrating",
  "responding",
  "streaming",
  "writing",
  "analyzing",
  "working"
];

let currentAd: Ad | null = null;
let cardHost: HTMLElement | null = null;
let isWaiting = false;
let lastBusyCheckAt = 0;
let debounceTimer: number | undefined;
let mutationObserver: MutationObserver | null = null;
let activeCycle = 0;

function sendMessage<T = any>(message: any): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(err);
        return;
      }
      resolve(response as T);
    });
  });
}

function isVisible(el: Element): el is HTMLElement {
  const node = el as HTMLElement;
  if (!node) return false;
  const style = getComputedStyle(node);
  return style.display !== "none" && style.visibility !== "hidden" && node.offsetParent !== null;
}

function findBusyElement(): HTMLElement | null {
  for (const selector of WAIT_SELECTORS) {
    const node = document.querySelector(selector);
    if (node instanceof HTMLElement && isVisible(node)) return node;
  }
  return null;
}

function hasWaitTextHint(): boolean {
  const candidates = Array.from(
    document.querySelectorAll(
      'main, article, section, [role="status"], [aria-live], [data-message-author-role], [data-testid]'
    )
  ) as HTMLElement[];

  for (const el of candidates) {
    if (!isVisible(el)) continue;
    const text = (el.innerText || "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    if (text.length > 180) continue;

    const hit = WAIT_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`, "i").test(text));
    if (hit) return true;
  }

  return false;
}

function isWaitingState(): boolean {
  const busyEl = findBusyElement();
  if (busyEl) return true;

  return hasWaitTextHint();
}

function findInsertionAnchor(): HTMLElement | null {
  const busyEl = findBusyElement();
  if (busyEl) {
    return (
      busyEl.closest(
        '[data-message-author-role="assistant"], [role="article"], article, main, section, [data-testid]'
      ) as HTMLElement | null) || busyEl.parentElement;
  }

  const assistantCandidates = Array.from(
    document.querySelectorAll(
      '[data-message-author-role="assistant"], [data-testid*="assistant"], .assistant, .message, article, [role="article"]'
    )
  ) as HTMLElement[];

  for (let i = assistantCandidates.length - 1; i >= 0; i--) {
    const el = assistantCandidates[i];
    if (isVisible(el)) return el;
  }

  return null;
}

function removeCard() {
  if (cardHost) {
    cardHost.remove();
    cardHost = null;
  }
}

function renderCard(ad: Ad) {
  removeCard();

  const anchor = findInsertionAnchor();
  const host = document.createElement("div");
  host.id = "hoodai-sponsored-card";
  host.style.display = "block";
  host.style.margin = "12px 0";
  host.style.maxWidth = "720px";

  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      .card {
        background: #111;
        color: #fff;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 16px;
        overflow: hidden;
        box-shadow: 0 8px 30px rgba(0,0,0,0.25);
        font-family: Inter, Segoe UI, Arial, sans-serif;
      }
      .img {
        width: 100%;
        display: block;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        background: #222;
      }
      .content {
        padding: 14px 16px 16px;
      }
      .badge {
        display: inline-block;
        font-size: 11px;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: #ff8a3d;
        margin-bottom: 10px;
        font-weight: 700;
      }
      h3 {
        margin: 0 0 8px;
        font-size: 18px;
        line-height: 1.25;
      }
      p {
        margin: 0;
        color: rgba(255,255,255,0.88);
        font-size: 14px;
        line-height: 1.5;
      }
      .actions {
        display: flex;
        gap: 10px;
        margin-top: 14px;
        flex-wrap: wrap;
      }
      button, a {
        border: 0;
        cursor: pointer;
        border-radius: 10px;
        padding: 10px 14px;
        font-weight: 700;
        font-size: 13px;
        text-decoration: none;
      }
      .primary {
        background: #ff7a18;
        color: #fff;
      }
      .secondary {
        background: rgba(255,255,255,0.08);
        color: #fff;
      }
      .meta {
        display: block;
        margin-top: 12px;
        opacity: .55;
        font-size: 11px;
      }
    </style>

    <div class="card">
      ${ad.image ? `<img class="img" src="${ad.image}" alt="Sponsored" />` : ""}
      <div class="content">
        <div class="badge">Sponsored</div>
        <h3>${escapeHtml(ad.title ?? "Sponsored")}</h3>
        <p>${escapeHtml(ad.text)}</p>
        <div class="actions">
          ${
            ad.link
              ? `<button class="primary" id="hoodai-open">Learn More →</button>`
              : ""
          }
          <button class="secondary" id="hoodai-close">Hide</button>
        </div>
        <span class="meta">Ads powered by HoodAI</span>
      </div>
    </div>
  `;

  if (anchor && anchor.parentElement) {
    anchor.insertAdjacentElement("afterend", host);
  } else {
    document.body.appendChild(host);
  }

  cardHost = host;
  currentAd = ad;

  const openBtn = root.getElementById("hoodai-open");
  const closeBtn = root.getElementById("hoodai-close");

  openBtn?.addEventListener("click", async () => {
    if (!currentAd) return;
    await sendMessage({ type: "hoodai:trackClick", ad: currentAd });
    if (currentAd.link) window.open(currentAd.link, "_blank", "noopener,noreferrer");
  });

  closeBtn?.addEventListener("click", () => {
    removeCard();
  });
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function trackImpression(ad: Ad) {
  await sendMessage({ type: "hoodai:trackImpression", ad });
}

async function getAd(): Promise<Ad | null> {
  const res = await sendMessage<{ ok: boolean; ad?: Ad }>({ type: "hoodai:getAd" });
  return res?.ad ?? null;
}

async function startWaitingCycle() {
  const cycleId = ++activeCycle;

  try {
    const ad = await getAd();
    if (!ad) return;
    if (cycleId !== activeCycle) return;

    renderCard(ad);
    await trackImpression(ad);
  } catch (err) {
    // no-op
    console.error("HoodAI: failed to load ad", err);
  }
}

function checkState() {
  const now = Date.now();
  if (now - lastBusyCheckAt < 150) return;
  lastBusyCheckAt = now;

  const waitingNow = isWaitingState();

  if (waitingNow && !isWaiting) {
    isWaiting = true;
    void startWaitingCycle();
    return;
  }

  if (!waitingNow && isWaiting) {
    isWaiting = false;
    activeCycle++;
    removeCard();
  }
}

function scheduleCheck() {
  if (debounceTimer) {
    window.clearTimeout(debounceTimer);
  }
  debounceTimer = window.setTimeout(checkState, 120);
}

function boot() {
  const target = document.documentElement || document.body;
  if (!target) return;

  mutationObserver = new MutationObserver(() => {
    scheduleCheck();
  });

  mutationObserver.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-busy", "class", "style", "data-loading", "data-state", "role"]
  });

  checkState();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
