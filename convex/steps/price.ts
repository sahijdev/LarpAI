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

  // Prefer what other retailers actually charge. The brand's own site usually shows the full list price,
  // which marketplaces routinely undercut with ordinary sales, so it's only a fallback.
  const street = converted.filter((c) => !c.isOfficial).map((c) => c.amount);
  const listPrice = converted.find((c) => c.isOfficial)?.amount;
  const reference = street.length > 0 ? median(street)! : listPrice!;
  const referenceKind = street.length > 0 ? "typical retail" : "list";
  const ratio = listing.price.amount / reference;
  const pct = Math.round(ratio * 100);
  const fmt = (n: number) => `${n.toFixed(2)} ${target}`;

  // Sold by the marketplace itself or the brand's own store: a low price is a sale, not bait.
  const authorized = listing.seller?.kind === "marketplace" || listing.seller?.kind === "brand";
  const soldBy = authorized ? ` Sold by ${listing.seller!.name}, so this is most likely a sale.` : "";

  let score: number;
  let summary: string;
  if (ratio < TOO_GOOD_RATIO) {
    score = authorized ? 70 : clamp(ratio * 100);
    summary = authorized
      ? `Price is only ${pct}% of the ${referenceKind} price (${fmt(reference)}): unusually low.${soldBy}`
      : `Price is only ${pct}% of the ${referenceKind} price (${fmt(reference)}): too good to be true`;
  } else if (ratio < 0.7) {
    score = authorized ? 85 : referenceKind === "list" ? 75 : 60;
    summary =
      referenceKind === "list"
        ? `Price is ${pct}% of the brand's list price (${fmt(reference)}). Discounts this size are common.${soldBy}`
        : `Price is ${pct}% of what other retailers charge (${fmt(reference)}): cheaper than usual.${soldBy}`;
  } else {
    score = 90;
    summary = `Price is in line with ${referenceKind === "list" ? "the brand's list price" : "other retailers"} (${pct}% of ${fmt(reference)})`;
  }

  return {
    score,
    summary,
    details: {
      listingPrice: listing.price,
      reference,
      referenceKind,
      streetPriceCount: street.length,
      seller: listing.seller,
      ratio,
      comparables: converted,
    },
    evidence: converted.slice(0, 3).map((c) => ({ label: `${c.title}: ${fmt(c.amount)}`, sourceUrl: c.url })),
  };
}
