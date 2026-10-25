import type { ToggleMessage } from "../lib/pageMessages";

export default defineBackground(() => {
  // Clicking the toolbar icon opens or closes the LarpAI drawer on the listing page.
  browser.action.onClicked.addListener(async (tab) => {
    const tabId = tab.id;
    if (tabId === undefined) return;
    const toggle = () => browser.tabs.sendMessage(tabId, { type: "larpai:toggle" } satisfies ToggleMessage);
    try {
      await toggle();
    } catch {
      // Tabs opened before the extension was installed or reloaded have no content script yet.
      try {
        await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/content.js"] });
        await toggle();
      } catch {
        // Not a site LarpAI supports; nothing to open.
      }
    }
  });
});
