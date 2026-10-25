"use node";

import type { ListingInput } from "../../shared/types";
import type { StepOutput } from "../pipeline";
import { clamp } from "./util";

const GENERIC_PHRASES = [
  "好评", "很好", "不错", "满意", "物美价廉", "五星", "推荐购买", "质量很好", "默认好评",
  "good", "great", "nice", "perfect", "recommend", "excellent",
];

// Marketplace-generated placeholders (e.g. Taobao's "系统默认好评" when a buyer never reviews).
// Not written by buyers, so they're neither evidence nor "duplicates". Covers simplified/traditional
// Chinese and the English text Taobao's translated pages show.
const SYSTEM_REVIEW = [
  /系[统統]默[认認]好[评評]/,
  /默[认認]好[评評]/,
  /此用[户戶]没有填写[评評]价/,
  /未及[时時].{0,6}[评評]价/,
  /did not (leave|write|make) a (timely|review)/i,
  /system default(ed)?/i,
  /default (positive|good) (review|rating|feedback)/i,
];

const isSystemReview = (text: string) => SYSTEM_REVIEW.some((re) => re.test(text));

type Flag = { kind: string; detail: string; weight: number };

function normalize(text: string) {
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

// Character-bigram Jaccard similarity; works for Chinese without a tokenizer.
function similarity(a: string, b: string): number {
  const grams = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return a === b ? 1 : 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

// Flags from the site's summary of all ratings (most reviews aren't on the product page).
function summaryFlags(s: NonNullable<ListingInput["ratingSummary"]>): Flag[] {
  const flags: Flag[] = [];
  if (s.average !== undefined && s.average < 3.5 && (s.count ?? 0) >= 20) {
    flags.push({ kind: "low-average", detail: `average rating is only ${s.average} out of 5`, weight: 25 });
  }
  const [five, , , , one] = s.distribution ?? [];
  // Lots of 5s and lots of 1s with little in between is a common sign of padded ratings.
  if (five !== undefined && one !== undefined && five >= 55 && one >= 15) {
    flags.push({ kind: "polarized", detail: `ratings are split between 5 stars (${five}%) and 1 star (${one}%)`, weight: 15 });
  }
  return flags;
}

function describeSummary(s: ListingInput["ratingSummary"]): string {
  if (!s || (s.average === undefined && s.count === undefined)) return "";
  const avg = s.average !== undefined ? `${s.average}★` : "Rated";
  const count = s.count !== undefined ? ` from ${s.count.toLocaleString("en-US")} ratings` : "";
  return `${avg}${count}. `;
}

export async function runReviews(listing: ListingInput): Promise<StepOutput> {
  const nonEmpty = listing.reviews.filter((r) => r.text.trim().length > 0);
  const reviews = nonEmpty.filter((r) => !isSystemReview(r.text));
  const systemDefaults = nonEmpty.length - reviews.length;
  const defaultsNote = systemDefaults
    ? ` (${systemDefaults} automatic "default" reviews from the marketplace ignored)`
    : "";
  const ratingSummary = listing.ratingSummary;
  const overall = describeSummary(ratingSummary);
  const hasSummary = overall.length > 0 || !!ratingSummary?.distribution;

  if (reviews.length < 3) {
    if (!hasSummary) {
      return {
        status: "skipped",
        summary: `Only ${reviews.length} buyer-written review${reviews.length === 1 ? "" : "s"} visible, too few to judge${defaultsNote}`,
        details: { analyzed: reviews.length, systemDefaults },
      };
    }
    // Too few review texts, but the site's overall rating summary is still evidence.
    const flags = summaryFlags(ratingSummary!);
    return {
      score: clamp(100 - flags.reduce((sum, f) => sum + f.weight, 0)),
      summary:
        overall +
        (flags.length ? `Concerns: ${flags.map((f) => f.detail).join("; ")}` : "No warning signs in the overall ratings") +
        `. Only ${reviews.length} review text${reviews.length === 1 ? "" : "s"} visible to check${defaultsNote}.`,
      details: { analyzed: reviews.length, systemDefaults, ratingSummary, flags },
    };
  }

  const texts = reviews.map((r) => normalize(r.text));
  const flags: Flag[] = ratingSummary ? summaryFlags(ratingSummary) : [];

  // Near-duplicate texts (copy-paste or templated reviews).
  let dupPairs = 0;
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (texts[i].length >= 6 && similarity(texts[i], texts[j]) > 0.8) dupPairs++;
    }
  }
  if (dupPairs > 0) {
    flags.push({ kind: "duplicates", detail: `${dupPairs} pair(s) of near-identical reviews`, weight: Math.min(30, dupPairs * 10) });
  }

  // Bursts: many reviews on the same date.
  const byDate = new Map<string, number>();
  for (const r of reviews) if (r.date) byDate.set(r.date.slice(0, 10), (byDate.get(r.date.slice(0, 10)) ?? 0) + 1);
  const [burstDate, burstCount] = [...byDate.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (burstCount && burstCount >= 4 && burstCount / reviews.length >= 0.4) {
    flags.push({ kind: "burst", detail: `${burstCount} of ${reviews.length} reviews posted on ${burstDate}`, weight: 20 });
  }

  // Short, generic, top-rated reviews.
  const generic = reviews.filter((r) => {
    const t = normalize(r.text);
    return t.length <= 12 && GENERIC_PHRASES.some((p) => t.includes(normalize(p))) && (r.rating ?? 5) >= 5;
  }).length;
  if (generic / reviews.length >= 0.5) {
    flags.push({ kind: "generic", detail: `${generic} of ${reviews.length} reviews are short generic praise`, weight: 20 });
  }

  // Unanimous 5 stars with a decent sample is unusual.
  const rated = reviews.filter((r) => r.rating !== undefined);
  if (rated.length >= 8 && rated.every((r) => r.rating === 5)) {
    flags.push({ kind: "all-five-star", detail: `All ${rated.length} rated reviews are 5 stars`, weight: 10 });
  }

  const score = clamp(100 - flags.reduce((sum, f) => sum + f.weight, 0));
  return {
    score,
    summary:
      overall +
      (flags.length
        ? `Suspicious review patterns: ${flags.map((f) => f.detail).join("; ")}`
        : `No suspicious patterns in the ${reviews.length} reviews shown on the page`) +
      defaultsNote,
    details: { analyzed: reviews.length, systemDefaults, ratingSummary, flags },
  };
}
