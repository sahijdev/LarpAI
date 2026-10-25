// Amazon product-page selectors, checked against a live amazon.com listing (Oct 2026).
// Amazon's data-hook / id attributes are much more stable than Taobao's or Temu's class names.
export const AMAZON_SELECTORS = {
  title: ["#productTitle", "#title"],
  price: [
    "#corePrice_feature_div .a-offscreen",
    "#corePriceDisplay_desktop_feature_div .a-offscreen",
    ".priceToPay .a-offscreen",
    ".a-price .a-offscreen",
  ],
  // Thumbnail strip (images only; li.videoThumbnail is skipped). URLs get their size suffix stripped.
  galleryImages: ["#altImages li.imageThumbnail img", "#imageBlock img"],
  landingImage: "#landingImage",
  brand: [".po-brand .po-break-word", "#bylineInfo"],
  reviewItems: ['[data-hook="review"]'],
  // Within a review. reviewRichContentContainer holds only the text; reviewText also has screen-reader prefixes.
  reviewText: ['[data-hook="reviewRichContentContainer"]', '[data-hook="review-body"] span', '[data-hook="reviewText"]'],
  reviewDate: ['[data-hook="review-date"]'],
  reviewStars: ['[data-hook="review-star-rating"] .a-icon-alt', '[data-hook="cmps-review-star-rating"] .a-icon-alt'],
  reviewPhotos: ['img[data-hook="review-image-tile"]', ".review-image-tile", '[data-hook="reviewRichContentContainer"] img'],
  // Buy box. NOTE: not yet checked against a live page; fallbacks cover the older and newer layouts.
  soldBy: [
    "#merchantInfoFeature_feature_div .offer-display-feature-text-message",
    "#sellerProfileTriggerId",
    "#merchant-info a",
    "#merchant-info",
  ],
  shipsFrom: ["#fulfillerInfoFeature_feature_div .offer-display-feature-text-message"],
  // Overall rating across all reviews (the page shows only a handful of the reviews themselves).
  ratingAverage: ['[data-hook="rating-out-of-text"]', "#acrPopover .a-icon-alt", "#acrPopover"],
  ratingCount: ['[data-hook="total-review-count"]', "#acrCustomerReviewText"],
  histogramRows: ['#histogramTable [aria-label*="percent"]', '[aria-label*="percent of reviews"]'],
  highlights: ['[data-hook="cr-insights-widget-summary"]', "#product-summary p", "#cr-product-insights-cards p"],
} as const;

// Reviewer avatars live in the same review cards; never collect them (README: no identifying data).
export const AMAZON_AVATAR = /amazon-avatars|\/avatar/i;
