import { extractListing } from "../lib/extract";

export type ExtractMessage = { type: "larpai:extract" };

export default defineContentScript({
  matches: ["*://item.taobao.com/*", "*://detail.tmall.com/*"],
  main() {
    browser.runtime.onMessage.addListener((message: ExtractMessage, _sender, sendResponse) => {
      if (message?.type !== "larpai:extract") return;
      try {
        sendResponse({ ok: true, listing: extractListing() });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  },
});
