"use node";

import type { ListingInput } from "../../shared/types";
import type { StepOutput } from "../pipeline";
import type { ComparisonDetails } from "./comparison";
import { clamp, fetchWithTimeout, median } from "./util";

const TOO_GOOD_RATIO = 0.4;

// Live ECB rates; listing prices are CNY and comparables are mostly USD/EUR.
async function toCurrency(amount: number, from: string, to: string): Promise<number> {
  if (from === to) return amount;
  const res = await fetchWithTimeout(
    `https://api.frankfurter.app/latest?amount=${amount}&from=${from}&to=${to}`,
    8_000,
  );
  const data = (await res.json()) as { rates?: Record<string, number> };
  const converted = data.rates?.[to];
  if (converted === undefined) throw new Error(`No exchange rate for ${from}→${to}`);
  return converted;
}

export async function runPrice(listing: ListingInput, found?: ComparisonDetails): Promise<StepOutput> {
  if (!listing.price) return { status: "skipped", summary: "Listing price wasn't visible on the page" };
  const priced = found?.comparables.filter((c) => c.price && c.price.amount > 0) ?? [];
  if (priced.length === 0) {
    return { status: "skipped", summary: "No comparable prices found to compare against" };
  }

  const target = listing.price.currency;
  const converted = (
    await Promise.allSettled(
      priced.map(async (c) => ({
        url: c.url,
        title: c.title,
        isOfficial: c.isOfficial,
        amount: await toCurrency(c.price!.amount, c.price!.currency.toUpperCase(), target),
      })),
    )
  ).flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (converted.length === 0) throw new Error("Couldn't convert comparable prices to the listing's currency");

  const officialPrice = converted.find((c) => c.isOfficial)?.amount;
  const reference = officialPrice ?? median(converted.map((c) => c.amount))!;
  const ratio = listing.price.amount / reference;
  const pct = Math.round(ratio * 100);
  const fmt = (n: number) => `${n.toFixed(2)} ${target}`;

  let score: number;
  let summary: string;
  if (ratio < TOO_GOOD_RATIO) {
    score = clamp(ratio * 100);
    summary = `Price is only ${pct}% of the ${officialPrice ? "official" : "typical"} price (${fmt(reference)}): too good to be true`;
  } else if (ratio < 0.7) {
    score = 60;
    summary = `Price is ${pct}% of the ${officialPrice ? "official" : "typical"} price (${fmt(reference)}): cheaper than usual`;
  } else {
    score = 90;
    summary = `Price is in line with comparables (${pct}% of ${fmt(reference)})`;
  }

  return {
    score,
    summary,
    details: { listingPrice: listing.price, reference, referenceKind: officialPrice ? "official" : "median", ratio, comparables: converted },
    evidence: converted.slice(0, 3).map((c) => ({ label: `${c.title}: ${fmt(c.amount)}`, sourceUrl: c.url })),
  };
}
