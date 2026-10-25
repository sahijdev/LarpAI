import type { FrameMessage } from "./pageMessages";

const ROOT_ID = "larpai-root";

// Lives in a closed shadow root so the shopping site's CSS can't restyle it (and ours can't leak out).
const CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
.launcher {
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
  display: flex; align-items: center; gap: 8px;
  padding: 6px 14px 6px 6px; border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.1); background: #fff; color: #171717;
  font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.16); cursor: pointer;
  transition: background 0.15s, transform 0.15s;
}
.launcher:hover { background: #f5f5f5; transform: translateY(-1px); }
.launcher:focus-visible { outline: 2px solid #171717; outline-offset: 2px; }
.logo {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border-radius: 999px;
  background: #171717; color: #fff; font-weight: 600; font-size: 12px;
}
.dot { display: none; width: 8px; height: 8px; border-radius: 999px; }
.launcher[data-tone] .dot { display: block; }
.launcher[data-tone="legit"] .dot { background: #10b981; }
.launcher[data-tone="concerns"] .dot { background: #f59e0b; }
.launcher[data-tone="misleading"] .dot { background: #ef4444; }
.launcher[data-tone="nodata"] .dot { background: #a3a3a3; }
.launcher[data-tone="running"] .dot { background: #f59e0b; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.drawer {
  position: fixed; top: 0; right: 0; z-index: 2147483647;
  width: min(420px, 100vw); height: 100vh;
  background: #fff; box-shadow: -8px 0 32px rgba(0, 0, 0, 0.18);
}
.drawer iframe { display: block; width: 100%; height: 100%; border: 0; }
@media (prefers-color-scheme: dark) {
  .launcher { background: #171717; color: #f5f5f5; border-color: rgba(255, 255, 255, 0.12); }
  .launcher:hover { background: #262626; }
  .logo { background: #fff; color: #0a0a0a; }
  .drawer { background: #0a0a0a; }
}
`;

const TONES: Record<string, string> = {
  "looks legit": "legit",
  "some concerns": "concerns",
  "likely misleading": "misleading",
  "not enough data": "nodata",
};

const LABELS: Record<string, string> = {
  "looks legit": "Looks legit",
  "some concerns": "Some concerns",
  "likely misleading": "Likely misleading",
  "not enough data": "Not enough data",
};

export type PageUi = { toggle(): void; setListingPage(isListing: boolean): void };

// The floating "LarpAI" button plus the drawer that holds the report (an extension page in an iframe).
export function mountPageUi(): PageUi {
  // A previous copy of this script (from before the extension reloaded) can't talk to the extension anymore.
  document.getElementById(ROOT_ID)?.remove();

  const host = document.createElement("div");
  host.id = ROOT_ID;
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>${CSS}</style>
    <button class="launcher" type="button" aria-label="Open LarpAI listing check" hidden>
      <span class="logo">L</span><span class="dot"></span><span class="text">Check listing</span>
    </button>
    <div class="drawer" role="dialog" aria-label="LarpAI report" hidden></div>`;
  document.documentElement.appendChild(host);

  const launcher = shadow.querySelector<HTMLButtonElement>(".launcher")!;
  const text = shadow.querySelector<HTMLSpanElement>(".text")!;
  const drawer = shadow.querySelector<HTMLDivElement>(".drawer")!;
  let frame: HTMLIFrameElement | undefined;
  let isListing = false;

  const isOpen = () => !drawer.hidden;
  const syncLauncher = () => {
    launcher.hidden = !isListing || isOpen();
  };

  const open = () => {
    // Created on first open, so nothing loads (or connects to the backend) until the shopper asks.
    if (!frame) {
      frame = document.createElement("iframe");
      frame.src = browser.runtime.getURL("/panel.html");
      frame.title = "LarpAI report";
      drawer.appendChild(frame);
    }
    drawer.hidden = false;
    syncLauncher();
    frame.focus();
  };
  const close = () => {
    drawer.hidden = true;
    syncLauncher();
  };

  launcher.addEventListener("click", open);

  window.addEventListener("message", (event) => {
    // Only trust messages from our own frame; the shopping site can post messages too.
    if (!frame || event.source !== frame.contentWindow) return;
    const msg = event.data as FrameMessage;
    if (msg?.type === "larpai:close") close();
    if (msg?.type === "larpai:status") {
      if (msg.state === "done" && msg.label) {
        launcher.dataset.tone = TONES[msg.label];
        text.textContent = msg.label === "not enough data" ? LABELS[msg.label] : `${msg.score} · ${LABELS[msg.label]}`;
      } else if (msg.state === "running") {
        launcher.dataset.tone = "running";
        text.textContent = "Checking…";
      } else {
        delete launcher.dataset.tone;
        text.textContent = "Check listing";
      }
    }
  });

  return {
    toggle: () => (isOpen() ? close() : open()),
    setListingPage(value) {
      isListing = value;
      syncLauncher();
    },
  };
}
