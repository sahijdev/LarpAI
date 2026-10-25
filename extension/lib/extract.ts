import type { ListingInput } from "../../shared/types";
import { SELECTORS, TAOBAO_PLACEHOLDER, WORLD_SELECTORS } from "./taobaoSelectors";
import { TEMU_SELECTORS } from "./temuSelectors";
import { AMAZON_AVATAR, AMAZON_SELECTORS } from "./amazonSelectors";

const MAX_REVIEWS = 40;

type Review = ListingInput["reviews"][number];

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

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR", "¥": "CNY", "￥": "CNY" };

function parsePrice(text: string | undefined, fallbackCurrency = "CNY"): ListingInput["price"] {
  const match = text?.replace(/,/g, "").match(/\d+(\.\d+)?/);
  if (!match) return undefined;
  const symbol = text!.match(/[$£€¥￥]/)?.[0];
  return { amount: Number(match[0]), currency: symbol ? CURRENCY_SYMBOLS[symbol] : fallbackCurrency };
}

function normalizeDate(text: string | undefined): string | undefined {
  return text?.match(/\d{4}[-./年]\d{1,2}[-./月]\d{1,2}/)?.[0]?.replace(/[年月./]/g, "-");
}

// schema.org Product data that store pages publish for search engines. Far more stable than class names.
type JsonLdProduct = {
  name?: string;
  image?: unknown;
  brand?: { name?: string } | string;
  offers?: unknown;
  review?: unknown;
};

function jsonLdProduct(doc: Document): JsonLdProduct | undefined {
  for (const el of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(el.textContent ?? "");
      const nodes: unknown[] = [].concat(data?.["@graph"] ?? data);
      const product = nodes.find(
        (n): n is JsonLdProduct & { "@type": unknown } =>
          !!n && typeof n === "object" && String((n as { "@type"?: unknown })["@type"]).includes("Product"),
      );
      if (product) return product;
    } catch {
      // ignore malformed blocks
    }
  }
  return undefined;
}

function toArray<T>(value: unknown): T[] {
  return value === undefined || value === null ? [] : ([] as T[]).concat(value as T);
}

function meta(doc: Document, property: string): string | undefined {
  return doc.querySelector(`meta[property="${property}"], meta[name="${property}"]`)?.getAttribute("content") ?? undefined;
}

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, " ").trim() || undefined;

// "5,123 ratings" / "1.2K global ratings" → 5123 / 1200
function parseCount(value: string | undefined): number | undefined {
  const m = value?.replace(/,/g, "").match(/([\d.]+)\s*([KkMm万])?/);
  if (!m) return undefined;
  const mult = { k: 1e3, m: 1e6, 万: 1e4 }[m[2]?.toLowerCase() ?? ""] ?? 1;
  const n = Math.round(Number(m[1]) * mult);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// schema.org aggregateRating, published by many store pages.
function jsonLdRating(product: JsonLdProduct | undefined): ListingInput["ratingSummary"] {
  const r = (product as { aggregateRating?: { ratingValue?: unknown; reviewCount?: unknown; ratingCount?: unknown } })
    ?.aggregateRating;
  const average = Number(r?.ratingValue);
  const count = Number(r?.ratingCount ?? r?.reviewCount);
  if (!Number.isFinite(average) && !Number.isFinite(count)) return undefined;
  return {
    average: Number.isFinite(average) ? average : undefined,
    count: Number.isFinite(count) ? count : undefined,
  };
}

function extractTaobao(doc: Document): ListingInput {
  const url = doc.location.href;
  const reviews: Review[] = [];
  const buyerImages: string[] = [];
  for (const item of all(doc, SELECTORS.reviewItems).slice(0, MAX_REVIEWS)) {
    const text = first(item, SELECTORS.reviewText)?.textContent?.trim();
    if (!text) continue;
    const date = normalizeDate(first(item, SELECTORS.reviewDate)?.textContent ?? undefined);
    const stars = item.querySelectorAll(SELECTORS.reviewStars[0]).length;
    reviews.push({ text, date, rating: stars || undefined });
    buyerImages.push(...imageUrls(all(item, SELECTORS.reviewPhotos)));
  }

  return {
    url,
    site: "taobao",
    itemId: new URL(url).searchParams.get("id") ?? undefined,
    title: first(doc, SELECTORS.title)?.textContent?.trim() || doc.title,
    price: parsePrice(first(doc, SELECTORS.price)?.textContent ?? undefined),
    sellerImages: imageUrls(all(doc, SELECTORS.galleryImages)),
    buyerImages: [...new Set(buyerImages)],
    reviews,
    brandGuess: first(doc, SELECTORS.brand)?.textContent?.trim() || undefined,
    seller: taobaoSeller(doc),
    ratingSummary: jsonLdRating(jsonLdProduct(doc)),
  };
}

// Tmall flagship stores (旗舰店) are run by the brand; other shops are independent sellers.
function taobaoSeller(doc: Document): ListingInput["seller"] {
  const name = text(first(doc, SELECTORS.shopName));
  if (!name) return undefined;
  const flagship = doc.location.hostname === "detail.tmall.com" && /旗舰店|flagship/i.test(name);
  return { name, kind: flagship ? "brand" : "third-party" };
}

function extractWorldTaobao(doc: Document): ListingInput {
  const url = doc.location.href;
  const S = WORLD_SELECTORS;
  const itemId = new URL(url).pathname.match(/\/item\/([^/]+?)\.htm/)?.[1];

  const reviews: Review[] = [];
  const buyerImages: string[] = [];
  for (const item of all(doc, S.reviewItems).slice(0, MAX_REVIEWS)) {
    const text = first(item, S.reviewText)?.textContent?.replace(/\s+/g, " ").trim();
    if (!text) continue;
    reviews.push({ text, date: normalizeDate(first(item, S.reviewDate)?.textContent ?? undefined) });
    buyerImages.push(...imageUrls(all(item, S.reviewPhotos)).filter((u) => !TAOBAO_PLACEHOLDER.test(u)));
  }

  const ogImage = meta(doc, "og:image");
  const gallery = imageUrls(all(doc, S.galleryImages)).filter((u) => !TAOBAO_PLACEHOLDER.test(u));
  const sellerImages = [...new Set([...gallery, ...(ogImage ? [ogImage] : [])])];

  // The page title gets truncated ("始祖鳥Arctery...") when signed out; prefer whichever is longer.
  const onPage = first(doc, S.title)?.textContent?.trim() ?? "";
  const og = (meta(doc, "og:title") ?? "").replace(/-淘[寶宝]Taobao.*$/, "").trim();
  const title = (og.length > onPage.length ? og : onPage) || doc.title;

  return {
    url,
    site: "taobao",
    itemId,
    title,
    price: parsePrice(first(doc, S.price)?.textContent ?? undefined),
    sellerImages,
    buyerImages: [...new Set(buyerImages)],
    reviews,
  };
}

function extractTemu(doc: Document): ListingInput {
  const url = doc.location.href;
  const product = jsonLdProduct(doc);
  const S = TEMU_SELECTORS;

  // Temu product URLs end in "-g-<goods id>.html"; some use ?goods_id=.
  const itemId = url.match(/-g-(\d+)\.html/)?.[1] ?? new URL(url).searchParams.get("goods_id") ?? undefined;

  const offer = toArray<{ price?: string | number; lowPrice?: string | number; priceCurrency?: string }>(product?.offers)[0];
  const offerPrice = Number(offer?.price ?? offer?.lowPrice);
  const price = Number.isFinite(offerPrice)
    ? { amount: offerPrice, currency: offer?.priceCurrency ?? "USD" }
    : parsePrice(first(doc, S.price)?.textContent ?? meta(doc, "product:price:amount"), "USD");

  const ldImages = toArray<string | { url?: string }>(product?.image)
    .map((img) => (typeof img === "string" ? img : img?.url ?? ""))
    .filter(Boolean);
  const ogImage = meta(doc, "og:image");
  const sellerImages = ldImages.length
    ? ldImages
    : [...new Set([...(ogImage ? [ogImage] : []), ...imageUrls(all(doc, S.galleryImages)).slice(0, 8)])];

  // Reviews: prefer JSON-LD (text, rating, date; we never read the author), fall back to the DOM.
  const reviews: Review[] = [];
  const buyerImages: string[] = [];
  for (const r of toArray<{
    reviewBody?: string;
    datePublished?: string;
    reviewRating?: { ratingValue?: string | number };
    image?: unknown;
  }>(product?.review).slice(0, MAX_REVIEWS)) {
    if (!r?.reviewBody) continue;
    const rating = Number(r.reviewRating?.ratingValue);
    reviews.push({
      text: r.reviewBody.trim(),
      date: normalizeDate(r.datePublished),
      rating: Number.isFinite(rating) ? rating : undefined,
    });
    buyerImages.push(...toArray<string | { url?: string }>(r.image).map((i) => (typeof i === "string" ? i : i?.url ?? "")));
  }
  if (reviews.length === 0) {
    for (const item of all(doc, S.reviewItems).slice(0, MAX_REVIEWS)) {
      const text = first(item, S.reviewText)?.textContent?.trim();
      if (!text) continue;
      reviews.push({ text, date: normalizeDate(item.textContent ?? undefined) });
      buyerImages.push(...imageUrls(all(item, S.reviewPhotos)));
    }
  }

  const brand = typeof product?.brand === "string" ? product.brand : product?.brand?.name;
  return {
    url,
    site: "temu",
    itemId,
    title: product?.name?.trim() || meta(doc, "og:title") || first(doc, S.title)?.textContent?.trim() || doc.title,
    price,
    sellerImages,
    buyerImages: [...new Set(buyerImages.filter(Boolean))],
    reviews,
    brandGuess: brand?.trim() || undefined,
    ratingSummary: jsonLdRating(product),
  };
}

// Amazon image URLs carry size codes like "._AC_SR38,50_.jpg"; dropping them returns the full-size image.
function amazonFullSize(url: string): string {
  return url.replace(/\._[^/]*_\.(jpg|jpeg|png|webp)$/i, ".$1");
}

// "Reviewed in the United States on September 12, 2026" → "2026-09-12"
function amazonReviewDate(text: string | undefined): string | undefined {
  const when = text?.split(" on ").pop();
  const ms = when ? Date.parse(when) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : normalizeDate(text);
}

function extractAmazon(doc: Document): ListingInput {
  const url = doc.location.href;
  const S = AMAZON_SELECTORS;
  const asin =
    url.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})/)?.[1] ??
    (doc.querySelector("input#ASIN") as HTMLInputElement | null)?.value ??
    undefined;

  const landing = doc.querySelector(S.landingImage);
  const hires = landing?.getAttribute("data-old-hires") || undefined;
  const thumbs = imageUrls(all(doc, S.galleryImages)).map(amazonFullSize);
  const sellerImages = [...new Set([...(hires ? [hires] : []), ...thumbs])].filter((u) => !AMAZON_AVATAR.test(u));

  const reviews: Review[] = [];
  const buyerImages: string[] = [];
  for (const item of all(doc, S.reviewItems).slice(0, MAX_REVIEWS)) {
    const text = first(item, S.reviewText)?.textContent?.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const stars = Number(first(item, S.reviewStars)?.textContent?.match(/[\d.]+/)?.[0]);
    reviews.push({
      text,
      date: amazonReviewDate(first(item, S.reviewDate)?.textContent ?? undefined),
      rating: Number.isFinite(stars) ? stars : undefined,
    });
    buyerImages.push(
      ...imageUrls(all(item, S.reviewPhotos))
        .filter((u) => !AMAZON_AVATAR.test(u))
        .map(amazonFullSize),
    );
  }

  const brand = first(doc, S.brand)
    ?.textContent?.replace(/\s+/g, " ")
    .trim()
    .replace(/^(Visit the|Brand:)\s*/i, "")
    .replace(/\s*Store$/i, "");

  return {
    url,
    // shared/types.ts has no "amazon" site yet; changing the contract needs the team (README section 6).
    site: "other",
    itemId: asin,
    title: first(doc, S.title)?.textContent?.replace(/\s+/g, " ").trim() || doc.title,
    price: parsePrice(first(doc, S.price)?.textContent ?? undefined, "USD"),
    sellerImages,
    buyerImages: [...new Set(buyerImages)],
    reviews,
    brandGuess: brand || undefined,
    seller: amazonSeller(doc, brand),
    ratingSummary: amazonRatings(doc),
  };
}

// "Sold by" in the buy box: Amazon itself, the brand's own storefront, or a third-party seller.
function amazonSeller(doc: Document, brand: string | undefined): ListingInput["seller"] {
  const S = AMAZON_SELECTORS;
  const name = text(first(doc, S.soldBy))?.replace(/^Sold by:?\s*/i, "");
  if (!name) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const kind = /^amazon(\.com|\.co\.uk|\.ca)?\b/i.test(name)
    ? "marketplace"
    : brand && norm(brand).length > 2 && norm(name).includes(norm(brand))
      ? "brand"
      : "third-party";
  return { name, kind, shipsFrom: text(first(doc, S.shipsFrom))?.replace(/^Ships from:?\s*/i, "") };
}

function amazonRatings(doc: Document): ListingInput["ratingSummary"] {
  const S = AMAZON_SELECTORS;
  const avgEl = first(doc, S.ratingAverage);
  const average = Number((text(avgEl) ?? avgEl?.getAttribute("title") ?? "").match(/(\d(\.\d)?) out of 5/)?.[1]);
  const count = parseCount(text(first(doc, S.ratingCount)));

  // Each histogram row is labelled like "67 percent of reviews have 5 stars".
  const distribution = [0, 0, 0, 0, 0];
  let found = 0;
  for (const el of all(doc, S.histogramRows)) {
    const m = el.getAttribute("aria-label")?.match(/(\d+)\s*percent of reviews have (\d) star/i);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 5) {
      distribution[5 - Number(m[2])] = Number(m[1]);
      found++;
    }
  }

  const highlights = text(first(doc, S.highlights));
  if (!Number.isFinite(average) && !count && !found && !highlights) return undefined;
  return {
    average: Number.isFinite(average) ? average : undefined,
    count,
    distribution: found ? distribution : undefined,
    highlights: highlights?.slice(0, 600),
  };
}

export function extractListing(doc: Document = document): ListingInput {
  const host = doc.location.hostname;
  if (/(^|\.)temu\.com$/.test(host)) return extractTemu(doc);
  if (/(^|\.)amazon\.[a-z.]+$/.test(host)) return extractAmazon(doc);
  if (host === "world.taobao.com") return extractWorldTaobao(doc);
  return extractTaobao(doc);
}
