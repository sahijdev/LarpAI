import type { ListingInput } from "../../shared/types";
import { SELECTORS } from "./taobaoSelectors";

const MAX_REVIEWS = 40;

function first(root: ParentNode, selectors: readonly string[]): Element | null {
  for (const s of selectors) {
    const el = root.querySelector(s);
    if (el) return el;
  }
  return null;
}

function all(root: ParentNode, selectors: readonly string[]): Element[] {
  for (const s of selectors) {
    const els = root.querySelectorAll(s);
    if (els.length) return Array.from(els);
  }
  return [];
}

function imageUrls(imgs: Element[]): string[] {
  const urls = imgs
    .map((img) => img.getAttribute("src") || img.getAttribute("data-src") || "")
    .filter((u) => u && !u.startsWith("data:"))
    .map((u) => (u.startsWith("//") ? `https:${u}` : u))
    // Strip thumbnail suffixes like _60x60q90.jpg so we get the full image.
    .map((u) => u.replace(/_(\d+x\d+)(q\d+)?\.jpg(_\.webp)?$/i, ""));
  return [...new Set(urls)];
}

function parsePrice(text: string | undefined): ListingInput["price"] {
  const match = text?.replace(/,/g, "").match(/\d+(\.\d+)?/);
  return match ? { amount: Number(match[0]), currency: "CNY" } : undefined;
}

export function extractListing(doc: Document = document): ListingInput {
  const url = doc.location.href;
  const host = doc.location.hostname;
  const itemId = new URL(url).searchParams.get("id") ?? undefined;

  const reviews: ListingInput["reviews"] = [];
  const buyerImages: string[] = [];
  for (const item of all(doc, SELECTORS.reviewItems).slice(0, MAX_REVIEWS)) {
    const text = first(item, SELECTORS.reviewText)?.textContent?.trim();
    if (!text) continue;
    const dateText = first(item, SELECTORS.reviewDate)?.textContent ?? "";
    const date = dateText.match(/\d{4}[-./年]\d{1,2}[-./月]\d{1,2}/)?.[0]?.replace(/[年月./]/g, "-");
    const stars = item.querySelectorAll(SELECTORS.reviewStars[0]).length;
    reviews.push({ text, date, rating: stars || undefined });
    buyerImages.push(...imageUrls(all(item, SELECTORS.reviewPhotos)));
  }

  return {
    url,
    site: /taobao|tmall/.test(host) ? "taobao" : "other",
    itemId,
    title: first(doc, SELECTORS.title)?.textContent?.trim() || doc.title,
    price: parsePrice(first(doc, SELECTORS.price)?.textContent ?? undefined),
    sellerImages: imageUrls(all(doc, SELECTORS.galleryImages)),
    buyerImages: [...new Set(buyerImages)],
    reviews,
    brandGuess: first(doc, SELECTORS.brand)?.textContent?.trim() || undefined,
  };
}
