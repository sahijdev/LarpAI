export default defineBackground(() => {
  // Clicking the toolbar icon opens the report in Chrome's side panel.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
