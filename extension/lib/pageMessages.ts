import type { Verdict } from "../../shared/types";

// Taobao/Tmall item pages, Temu product pages ("...-g-<id>.html" or "goods.html?goods_id="),
// and Amazon product pages ("/dp/<ASIN>" or "/gp/product/<ASIN>").
const SUPPORTED = new RegExp(
  [
    String.raw`^https?://(item\.taobao\.com|detail\.tmall\.com)/`,
    String.raw`^https?://world\.taobao\.com/item/`,
    String.raw`^https?://([a-z]+\.)?temu\.com/(.*-g-\d+\.html|goods\.html\?.*goods_id=)`,
    String.raw`^https?://(www\.|smile\.)?amazon\.(com|co\.uk|ca)/(.*/)?(dp|gp/product)/[A-Z0-9]{10}`,
  ].join("|"),
);

export const isSupportedListing = (url: string) => SUPPORTED.test(url);

// Set once the shopper agrees to the data notice. Before that nothing leaves the browser;
// after it, product pages are checked automatically when opened.
export const CONSENT_KEY = "larpai:consent:v1";

export async function hasConsent(): Promise<boolean> {
  try {
    const stored = await browser.storage.local.get(CONSENT_KEY);
    return stored[CONSENT_KEY] === true;
  } catch {
    return false;
  }
}

// Background → content script.
export type ToggleMessage = { type: "larpai:toggle" };

// Report frame → the content script that hosts it (via window.postMessage).
export type FrameStatus = {
  state: "idle" | "running" | "done";
  score?: number;
  label?: Verdict["label"];
  reason?: string; // the verdict's first reason, for the inline summary
  // While running: how many steps have finished and what's happening now.
  progress?: { done: number; total: number; current: string };
};
export type FrameMessage = { type: "larpai:close" } | ({ type: "larpai:status" } & FrameStatus);

// Content script → report frame: the shopper pressed "Check listing" on the page.
export type StartMessage = { type: "larpai:start" };
// Set on the frame URL when it's created by a "Check listing" press.
export const AUTOSTART_PARAM = "start";

export function postToPage(message: FrameMessage) {
  if (window.parent !== window) window.parent.postMessage(message, "*");
}
