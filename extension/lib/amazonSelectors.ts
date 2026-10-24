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
} as const;

// Reviewer avatars live in the same review cards; never collect them (README: no identifying data).
export const AMAZON_AVATAR = /amazon-avatars|\/avatar/i;
