"use node";

import { ApifyClient } from "apify-client";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { ListingInput } from "../../shared/types";
import type { StepOutput } from "../pipeline";
import { requireEnv } from "./util";

export type Comparable = {
  url: string;
  title: string;
  isOfficial: boolean;
  images: string[];
  price?: { amount: number; currency: string };
};

export type ComparisonDetails = {
  query: string;
  queriesTried: string[];
  brand?: string;
  comparables: Comparable[];
  officialImages: string[];
};

// Marketplaces that host the same kind of listing we're checking; skip them as "reference".
const MARKETPLACE_HOSTS = /taobao|tmall|1688\.com|aliexpress|temu|alibaba|dhgate|pinduoduo|jd\.com/i;
const MAX_PAGES = 5;

const SearchPlan = z.object({
  englishQuery: z.string(),
  brand: z.string().nullable(),
  productName: z.string(),
});

// Taobao titles are Chinese and keyword-stuffed; turn one into a clean web search.
async function planSearch(listing: ListingInput): Promise<z.infer<typeof SearchPlan>> {
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const res = await client.messages.parse({
    model: "claude-haiku-5-5",
    max_tokens: 1024,
    output_config: { effort: "low", format: zodOutputFormat(SearchPlan) },
    messages: [
      {
        role: "user",
        content:
          "This is a product title from a Chinese shopping listing. Give a short English web search query " +
          "that would find the official product page or reputable retailers for the same item, the brand " +
          "if one is identifiable (null if generic/unbranded), and a short product name.\n\n" +
          `Title: ${listing.title}\nBrand hint: ${listing.brandGuess ?? "none"}`,
      },
    ],
  });
  if (!res.parsed_output) throw new Error("Could not interpret the listing title");
  return res.parsed_output;
}

type OrganicResult = { title?: string; url?: string };

async function googleSearch(apify: ApifyClient, query: string): Promise<OrganicResult[]> {
  const run = await apify.actor("apify/google-search-scraper").call(
    { queries: query, maxPagesPerQuery: 1, resultsPerPage: 10, countryCode: "us", languageCode: "en" },
    { waitSecs: 90 },
  );
  if (run.status !== "SUCCEEDED") throw new Error(`Google search run ${run.status?.toLowerCase()}`);
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  return items.flatMap((item) => (item.organicResults as OrganicResult[] | undefined) ?? []);
}

// Runs inside Apify's Cheerio Scraper, so it must be self-contained JS.
const PAGE_FUNCTION = `async function pageFunction({ $, request }) {
  const meta = (p) => $('meta[property="' + p + '"], meta[name="' + p + '"]').attr('content');
  const images = new Set();
  const og = meta('og:image'); if (og) images.add(og);
  let price, currency;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const nodes = [].concat(data['@graph'] || data);
      for (const n of nodes) {
        if (!n || !String(n['@type'] || '').includes('Product')) continue;
        [].concat(n.image || []).forEach((img) => images.add(typeof img === 'string' ? img : img.url));
        const offer = [].concat(n.offers || [])[0];
        if (offer && price === undefined) {
          price = Number(offer.price ?? offer.lowPrice);
          currency = offer.priceCurrency;
        }
      }
    } catch (e) {}
  });
  if (price === undefined) {
    const p = meta('product:price:amount') || meta('og:price:amount');
    if (p) { price = Number(p); currency = meta('product:price:currency') || meta('og:price:currency'); }
  }
  return {
    url: request.url,
    title: meta('og:title') || $('title').text().trim(),
    images: [...images].filter(Boolean).slice(0, 6),
    price: Number.isFinite(price) ? price : undefined,
    currency,
  };
}`;

type PageItem = { url: string; title: string; images: string[]; price?: number; currency?: string };

async function scrapePages(apify: ApifyClient, urls: string[]): Promise<PageItem[]> {
  const run = await apify.actor("apify/cheerio-scraper").call(
    {
      startUrls: urls.map((url) => ({ url })),
      pageFunction: PAGE_FUNCTION,
      maxRequestsPerCrawl: urls.length,
      maxRequestRetries: 1,
      proxyConfiguration: { useApifyProxy: true },
    },
    { waitSecs: 90 },
  );
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  return items as unknown as PageItem[];
}

export async function runComparison(listing: ListingInput): Promise<StepOutput> {
  const apify = new ApifyClient({ token: requireEnv("APIFY_TOKEN") });

  let plan: z.infer<typeof SearchPlan>;
  try {
    plan = await planSearch(listing);
  } catch {
    plan = { englishQuery: listing.title, brand: listing.brandGuess ?? null, productName: listing.title };
  }
  const brand = plan.brand ?? undefined;

  // Fallback chain: full query → brand + product → brand only.
  const candidates = [
    plan.englishQuery,
    brand ? `${brand} ${plan.productName}` : undefined,
    brand ? `${brand} official site` : undefined,
  ].filter((q, i, all): q is string => !!q && all.indexOf(q) === i);

  const queriesTried: string[] = [];
  let results: OrganicResult[] = [];
  let query = candidates[0];
  for (const q of candidates) {
    queriesTried.push(q);
    query = q;
    results = (await googleSearch(apify, q)).filter((r) => r.url && !MARKETPLACE_HOSTS.test(r.url));
    if (results.length > 0) break;
  }
  if (results.length === 0) {
    throw new Error(`No comparable listings found (tried: ${queriesTried.join(" | ")})`);
  }

  const brandSlug = brand?.toLowerCase().replace(/[^a-z0-9]/g, "");
  const isOfficial = (url: string) =>
    !!brandSlug && brandSlug.length > 2 && new URL(url).hostname.replace(/[^a-z0-9]/g, "").includes(brandSlug);

  const urls = results.slice(0, MAX_PAGES).map((r) => r.url!);
  const pages = await scrapePages(apify, urls);
  const comparables: Comparable[] = pages.map((p) => ({
    url: p.url,
    title: p.title,
    isOfficial: isOfficial(p.url),
    images: p.images ?? [],
    price: p.price !== undefined ? { amount: p.price, currency: p.currency ?? "USD" } : undefined,
  }));

  const officialImages = comparables.filter((c) => c.isOfficial).flatMap((c) => c.images);
  const referenceImages = officialImages.length > 0 ? officialImages : comparables.flatMap((c) => c.images);
  const official = comparables.find((c) => c.isOfficial);

  const details: ComparisonDetails = {
    query,
    queriesTried,
    brand,
    comparables,
    officialImages: referenceImages.slice(0, 6),
  };

  return {
    // Not a trust score on its own; it measures how much reference data we found.
    score: Math.min(100, comparables.length * 15 + (official ? 25 : 0)),
    summary: official
      ? `Found the official ${brand} page and ${comparables.length - 1} other public listings`
      : `Found ${comparables.length} public listings for "${query}" (no official brand page)`,
    details,
    evidence: comparables.map((c) => ({
      label: c.isOfficial ? `Official: ${c.title}` : c.title,
      sourceUrl: c.url,
      imageUrl: c.images[0],
    })),
  };
}
