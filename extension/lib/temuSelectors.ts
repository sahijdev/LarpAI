// Temu product-page fallbacks, used only when the page's JSON-LD / Open Graph data is missing a field.
// Temu obfuscates class names, so these lean on attributes and roles rather than classes.
// NOTE: unverified against a live page (Temu's bot check blocks automated browsers). Confirm on a real listing.
export const TEMU_SELECTORS = {
  title: ["h1", '[data-type="goodsName"]'],
  price: ['[data-type="price"]', '[aria-label*="price" i]'],
  galleryImages: ['[role="img"] img', 'img[src*="kwcdn.com"][alt]'],
  reviewItems: ['[id*="reviewContent"] [role="listitem"]', '[class*="review" i] [role="listitem"]'],
  // Within a review item. Deliberately no username/avatar selectors.
  reviewText: ['[aria-label*="review" i]', "span"],
  reviewPhotos: ['img[src*="kwcdn.com"]'],
} as const;
