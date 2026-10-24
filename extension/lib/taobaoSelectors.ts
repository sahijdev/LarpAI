// Taobao/Tmall item-page selectors, isolated here so they can be fixed live.
// Taobao uses hashed CSS-module class names (e.g. "mainTitle--O1XCl8e2"), so we match on the stable prefix.
// Each entry is tried in order; the first selector that matches wins.
// NOTE: unverified against today's DOM. Confirm on a real listing (README §11) and adjust.
export const SELECTORS = {
  title: ['[class*="mainTitle--"]', '[class*="ItemTitle--"]', "h1"],
  price: ['[class*="highlightPrice--"] [class*="text--"]', '[class*="priceText--"]', '[class*="Price--priceText"]'],
  galleryImages: [
    '[class*="thumbnailPic--"] img',
    '[class*="thumbnails--"] img',
    '[class*="mainPicWrap--"] img',
    "#J_UlThumb img",
  ],
  reviewItems: ['[class*="Comment--"]', '[class*="comment-item"]', ".rate-grid tr"],
  // Within a review item. Deliberately no username/avatar selectors.
  reviewText: ['[class*="content--"]', '[class*="Comment--content"]', ".tm-rate-fulltxt"],
  reviewPhotos: ['[class*="photo--"] img', '[class*="album--"] img', ".tm-m-photos img"],
  reviewDate: ['[class*="meta--"]', '[class*="Comment--meta"]', ".tm-rate-date"],
  reviewStars: ['[class*="starWrapper--"] [class*="active"]'],
  brand: ['[class*="BasicAttributes--"] [class*="brand"]', '[class*="brandName"]'],
} as const;
