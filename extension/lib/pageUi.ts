import { AUTOSTART_PARAM, hasConsent, type FrameMessage, type FrameStatus, type StartMessage } from "./pageMessages";
import { SELECTORS, WORLD_SELECTORS } from "./taobaoSelectors";
import type { ContentScriptContext } from "wxt/utils/content-script-context";

const ROOT_ID = "larpai-root";
const INLINE_ID = "larpai-inline";

const FONT = `system-ui, -apple-system, "Segoe UI", "PingFang SC", sans-serif`;

// Report drawer. Lives in a closed shadow root so the site's CSS can't restyle it.
const DRAWER_CSS = `
:host { all: initial; }
[hidden] { display: none !important; }
.drawer {
  position: fixed; top: 0; right: 0; z-index: 2147483647;
  width: min(420px, 100vw); height: 100vh;
  background: #fff; box-shadow: -8px 0 32px rgba(0, 0, 0, 0.18);
}
.drawer iframe { display: block; width: 100%; height: 100%; border: 0; }
@media (prefers-color-scheme: dark) {
  .drawer { background: #0a0a0a; }
}
`;

// Summary strip placed under the listing title. The sites render light pages, so this is light only.
const INLINE_CSS = `
:host { all: initial; display: block; }
.strip {
  position: relative; overflow: hidden; container-type: inline-size;
  display: flex; align-items: center; gap: 10px; box-sizing: border-box; width: 100%;
  margin: 10px 0; padding: 10px 12px; border-radius: 12px;
  border: 1px solid #e5e5e5; border-left: 4px solid #d4d4d4; background: #fff; color: #171717;
  font: 13px/1.4 ${FONT};
}
.strip[data-tone="legit"] { border-left-color: #10b981; }
.strip[data-tone="concerns"], .strip[data-tone="running"] { border-left-color: #f59e0b; }
.strip[data-tone="misleading"] { border-left-color: #ef4444; }
.logo {
  flex-shrink: 0;
  width: 26px; height: 26px; border-radius: 8px;
  object-fit: contain; background: #fff;
}
.body { flex: 1; min-width: 0; }
/* One line: the score/label never wraps; the step info gives way (with …) when space is short. */
.headline { display: flex; align-items: baseline; gap: 6px; font-weight: 600; white-space: nowrap; min-width: 0; }
.headline .dot { align-self: center; }
.title { flex-shrink: 0; }
.sub { margin-top: 2px; color: #525252; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dot { display: none; flex-shrink: 0; width: 8px; height: 8px; border-radius: 999px; }
.strip[data-tone] .dot { display: block; }
.strip[data-tone="legit"] .dot { background: #10b981; }
.strip[data-tone="concerns"] .dot { background: #f59e0b; }
.strip[data-tone="misleading"] .dot { background: #ef4444; }
.strip[data-tone="nodata"] .dot { background: #a3a3a3; }
.strip[data-tone="running"] .dot { background: #f59e0b; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.3; } }
.action {
  flex-shrink: 0; padding: 5px 12px; border-radius: 999px;
  border: 1px solid #d4d4d4; background: #fff; color: #171717;
  font: 500 12px/1.2 ${FONT}; cursor: pointer;
}
.action:hover { background: #f5f5f5; }
.action:focus-visible { outline: 2px solid #171717; outline-offset: 2px; }
/* Narrow columns (e.g. Amazon's center column on smaller windows): tighten spacing. */
@container (max-width: 440px) {
  .body { font-size: 12.5px; }
  .action { padding: 4px 10px; }
}
.steps {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  font-weight: 400; font-size: 12px; color: #737373; font-variant-numeric: tabular-nums;
}
/* Progress along the bottom edge while a check runs. The sheen keeps it moving during long steps. */
.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: #f5f5f5; }
.fill {
  height: 100%; width: 0; background: #f59e0b; transition: width 0.6s ease;
  background-image: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
  background-size: 60px 100%; background-repeat: no-repeat;
  animation: sheen 1.4s linear infinite;
}
@keyframes sheen { from { background-position: -60px 0; } to { background-position: calc(100% + 60px) 0; } }
@media (prefers-reduced-motion: reduce) {
  .fill, .strip[data-tone="running"] .dot { animation: none; }
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

// Amazon's title block (the whole section, not the inline #productTitle span inside it).
const AMAZON_TITLE = ["#titleSection", "#title_feature_div", "#title"];

// The listing title, where the inline summary goes. Sites without one here (Temu) use the floating button.
function findTitle(): Element | null {
  const host = location.hostname;
  const selectors: readonly string[] =
    host === "world.taobao.com"
      ? WORLD_SELECTORS.title
      : /(^|\.)(taobao|tmall)\.com$/.test(host)
        ? SELECTORS.title
        : /(^|\.)amazon\.[a-z.]+$/.test(host)
          ? AMAZON_TITLE
          : [];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el;
  }
  return null;
}

export type PageUi = { toggle(): void; setListingPage(isListing: boolean): void };

// Copies of this script from before the extension reloaded keep running on the page (Chrome only cuts them
// off from the extension), so their strips and drawers can linger. Only the newest copy's UI stays visible;
// every copy applies the same rule, so they agree. Hiding rather than removing matters: an old copy
// re-inserts a removed strip, and then the copies fight over the spot.
const MOUNTED_ATTR = "data-larpai-mounted";
function hideStaleCopies() {
  const els = Array.from(document.querySelectorAll<HTMLElement>(`[id="${ROOT_ID}"], [id="${INLINE_ID}"]`));
  const mountedAt = (el: HTMLElement) => Number(el.getAttribute(MOUNTED_ATTR) ?? 0);
  const newest = Math.max(0, ...els.map(mountedAt));
  for (const el of els) {
    if (mountedAt(el) < newest) el.style.setProperty("display", "none", "important");
  }
}

export function mountPageUi(ctx: ContentScriptContext): PageUi {
  // Later copies get a larger value (the fraction just breaks same-millisecond ties).
  const mountedAt = String(Date.now() + Math.random());

  // Drawer with the full report.
  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.setAttribute(MOUNTED_ATTR, mountedAt);
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>${DRAWER_CSS}</style>
    <div class="drawer" role="dialog" aria-label="LarpAI report" hidden></div>`;
  document.documentElement.appendChild(host);
  const drawer = shadow.querySelector<HTMLDivElement>(".drawer")!;

  // Inline summary (inserted into the page next to the title when we can find it).
  const inlineHost = document.createElement("div");
  inlineHost.id = INLINE_ID;
  inlineHost.setAttribute(MOUNTED_ATTR, mountedAt);
  const inline = inlineHost.attachShadow({ mode: "closed" });
  inline.innerHTML = `
    <style>${INLINE_CSS}</style>
    <div class="strip" role="region" aria-label="LarpAI listing check">
      <img class="logo" alt="" src="${browser.runtime.getURL("/icon/48.png")}" />
      <div class="body">
        <div class="headline"><span class="dot"></span><span class="title"></span><span class="steps"></span></div>
        <div class="sub" aria-live="polite"></div>
      </div>
      <button class="action" type="button"></button>
      <div class="bar" role="progressbar" aria-label="Check progress" aria-valuemin="0" hidden><div class="fill"></div></div>
    </div>`;
  const strip = inline.querySelector<HTMLDivElement>(".strip")!;
  const stripTitle = inline.querySelector<HTMLSpanElement>(".title")!;
  const stripSteps = inline.querySelector<HTMLSpanElement>(".steps")!;
  const stripSub = inline.querySelector<HTMLDivElement>(".sub")!;
  const stripAction = inline.querySelector<HTMLButtonElement>(".action")!;
  const bar = inline.querySelector<HTMLDivElement>(".bar")!;
  const fill = inline.querySelector<HTMLDivElement>(".fill")!;

  let frame: HTMLIFrameElement | undefined;
  let isListing = false;
  let status: FrameStatus = { state: "idle" };
  // Elapsed-time counter while a check runs, so long steps (web search) still visibly tick.
  let runStarted: number | undefined;
  let ticker: number | undefined;

  const isOpen = () => !drawer.hidden;

  const render = () => {
    // An early verdict (label while still running) takes the verdict's color.
    const tone = status.label ? TONES[status.label] : status.state === "running" ? "running" : undefined;
    if (tone) strip.dataset.tone = tone;
    else delete strip.dataset.tone;

    const running = status.state === "running";
    if (running && runStarted === undefined) {
      runStarted = Date.now();
      ticker = window.setInterval(render, 1000);
    } else if (!running && runStarted !== undefined) {
      runStarted = undefined;
      window.clearInterval(ticker);
    }

    let headline: string;
    stripSteps.textContent = "";
    bar.hidden = !running;
    if (status.state === "done" && status.label) {
      headline = status.label === "not enough data" ? LABELS[status.label] : `${status.score} · ${LABELS[status.label]}`;
      stripSub.textContent = status.reason ?? "";
      stripAction.textContent = "See full report";
    } else if (running) {
      const p = status.progress;
      const secs = Math.round((Date.now() - (runStarted ?? Date.now())) / 1000);
      const stepsText = p ? `${p.done}/${p.total} · ${secs}s` : `${secs}s`;
      if (status.label) {
        // Early verdict from photos and reviews; the final one replaces it.
        headline = status.label === "not enough data" ? LABELS[status.label] : `${status.score} · ${LABELS[status.label]}`;
        stripSteps.textContent = `early · ${stepsText}`;
        stripSub.textContent = `${status.reason ? `${status.reason} ` : ""}Still checking: ${p?.current ?? "official product and price"}…`;
      } else {
        headline = "Checking";
        stripSteps.textContent = stepsText;
        stripSub.textContent = p ? `${p.current}…` : "Starting…";
      }
      // Count a step in progress as half done so the bar moves as soon as work starts.
      const pct = p ? Math.max(4, Math.min(100, ((p.done + (p.current !== "Starting" ? 0.5 : 0)) / p.total) * 100)) : 4;
      fill.style.width = `${pct}%`;
      bar.setAttribute("aria-valuenow", String(Math.round(pct)));
      stripAction.textContent = "Open report";
    } else {
      headline = "Check listing";
      stripSub.textContent = "LarpAI checks whether the photos, reviews and price match reality.";
      stripAction.textContent = "Check listing";
    }
    stripTitle.textContent = status.state === "idle" ? "Does this listing match?" : headline;
  };

  // Keeps the summary under the title. Taobao re-renders parts of the page (e.g. picking a variant),
  // which can remove it, and the title may load after this script runs.
  const placeInline = () => {
    if (ctx.isInvalid) return;
    const title = isListing ? findTitle() : null;
    if (!title) {
      if (inlineHost.isConnected) inlineHost.remove();
    } else if (!inlineHost.isConnected || inlineHost.parentElement !== title.parentElement) {
      // Only (re)insert when the strip is gone or the title was re-rendered elsewhere. Don't insist on being
      // the title's very next sibling: other page scripts may insert there too, and insisting causes a loop.
      title.insertAdjacentElement("afterend", inlineHost);
    }
    hideStaleCopies();
    render();
  };
  let placeTimer: number | undefined;
  const schedulePlace = () => {
    if (placeTimer !== undefined) return;
    placeTimer = ctx.setTimeout(() => {
      placeTimer = undefined;
      placeInline();
    }, 300);
  };
  const observer = new MutationObserver(schedulePlace);
  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });

  // When the extension reloads or updates, this copy stops for good and takes its UI with it.
  ctx.onInvalidated(() => {
    observer.disconnect();
    window.clearInterval(ticker);
    host.remove();
    inlineHost.remove();
  });

  // The report frame holds the backend connection, so it's created only when the shopper clicks.
  // `start` begins a check (not just loading the report view).
  const ensureFrame = (start: boolean) => {
    if (!frame) {
      const url = new URL(browser.runtime.getURL("/panel.html"));
      if (start) url.searchParams.set(AUTOSTART_PARAM, "1");
      frame = document.createElement("iframe");
      frame.src = url.href;
      frame.title = "LarpAI report";
      drawer.appendChild(frame);
    } else if (start) {
      frame.contentWindow?.postMessage({ type: "larpai:start" } satisfies StartMessage, "*");
    }
    return frame;
  };

  const open = (start: boolean) => {
    const f = ensureFrame(start);
    drawer.hidden = false;
    render();
    f.focus();
  };
  const close = () => {
    drawer.hidden = true;
    render();
  };

  // "Check listing" runs the check right here, with results filling in the strip. The drawer opens only
  // the first time (for the data notice). "Open report" / "See full report" open the drawer.
  stripAction.addEventListener("click", async () => {
    if (status.state !== "idle") return open(false);
    if (await hasConsent()) {
      ensureFrame(true);
      status = { state: "running" };
      render();
    } else {
      open(true);
    }
  });

  ctx.addEventListener(window, "message", (event: MessageEvent) => {
    // Only trust messages from our own frame; the shopping site can post messages too.
    if (!frame || event.source !== frame.contentWindow) return;
    const msg = event.data as FrameMessage;
    if (msg?.type === "larpai:close") close();
    if (msg?.type === "larpai:status") {
      const { type: _type, ...next } = msg;
      status = next;
      render();
    }
  });

  return {
    // Toolbar icon: also the way in on sites without an inline strip (Temu).
    toggle: () => (isOpen() ? close() : open(false)),
    setListingPage(value) {
      isListing = value;
      placeInline();
    },
  };
}
