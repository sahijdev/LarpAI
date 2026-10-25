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
  shopName: ['[class*="shopName--"]', '[class*="ShopHeader--title"]', ".tb-shop-name", ".slogo-shopname"],
} as const;

// world.taobao.com (Taobao's international site, /item/<encoded id>.htm). Checked against a live page (Oct 2026).
// Signed out, it shows a truncated title and placeholder gallery images; og:title / og:image fill the gap.
export const WORLD_SELECTORS = {
  title: [".item-intro .item-title"],
  price: [".price-box .price"],
  galleryImages: [".left-intro img.item-thumbnail", ".left-intro img.item-img"],
  reviewItems: [".rate-list li.item"],
  reviewText: [".rate-bottom .content"],
  reviewDate: [".date-info"],
  // Buyer photos are in the review body. The image in .rate-top is the reviewer's avatar: never read it.
  reviewPhotos: [".rate-bottom img:not(.useful-icon)"],
} as const;

// Taobao's 2x2 transparent placeholders (lazy-loading / signed-out view).
export const TAOBAO_PLACEHOLDER = /-tps-2-2\.|T12pdtXaldXXXXXXXX-2-2/;
