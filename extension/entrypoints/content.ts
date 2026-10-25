import { extractListing } from "../lib/extract";
import { isSupportedListing, type ToggleMessage } from "../lib/pageMessages";
import { mountPageUi } from "../lib/pageUi";

export type ExtractMessage = { type: "larpai:extract" };

export default defineContentScript({
  matches: [
    "*://item.taobao.com/*",
    "*://detail.tmall.com/*",
    "*://world.taobao.com/*",
    "*://*.temu.com/*",
    "*://*.amazon.com/*",
    "*://*.amazon.co.uk/*",
    "*://*.amazon.ca/*",
  ],
  main(ctx) {
    const ui = mountPageUi(ctx);

    // Show the button only on product pages; Amazon and Temu navigate without full reloads.
    const sync = () => ui.setListingPage(isSupportedListing(location.href));
    sync();
    ctx.addEventListener(window, "wxt:locationchange", sync);

    browser.runtime.onMessage.addListener((message: ExtractMessage | ToggleMessage, _sender, sendResponse) => {
      if (message?.type === "larpai:toggle") {
        ui.toggle();
        return;
      }
      if (message?.type !== "larpai:extract") return;
      try {
        sendResponse({ ok: true, listing: extractListing() });
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });
  },
});
