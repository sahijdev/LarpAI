"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import type { CheckName, CheckResult, ListingInput, Verdict } from "../../shared/types";
import { clamp, requireEnv } from "./util";

const VerdictSchema = z.object({
  score: z.number(),
  label: z.enum(["looks legit", "some concerns", "likely misleading", "not enough data"]),
  confidence: z.enum(["low", "medium", "high"]),
  reasons: z.array(z.string()),
  caveats: z.array(z.string()),
});

const SYSTEM = `You write the final verdict for LarpAI, a browser extension that tells online shoppers whether a product listing matches what they'll actually get: misleading photos, photos reused from the brand, fake-looking reviews, bait pricing.

You receive the listing and the results of automated checks. Each check has a status. "error" or "skipped" means that check gave you no information. Treat it as missing, not as good or bad news.

Rules:
- score is 0-100, where higher means the listing matches reality better.
- Every reason must point to a specific check result (for example "Buyer photos show a darker color than the seller photos (image check)"). Give 1-2 reasons, one short sentence each (under 20 words), most important first.
- caveats: at most 2 short sentences in total. Merge every errored or skipped check into one line (for example "The review and price checks didn't run."). Add a second line only for a real limit on the evidence that changes how to read the result. No generic disclaimers.
- If the image check is missing, or fewer than two checks produced results, use label "not enough data" and confidence "low" rather than guessing.
- Lower confidence when checks are missing or disagree.
- Seller: if the listing is sold by the marketplace itself (e.g. "Amazon.com") or the brand's own store, a price below the brand's list price is most likely a sale, not bait, and photos matching the brand's own are expected. An unknown third-party seller deserves more caution.
- Rating summary: it covers every buyer, not just the few reviews shown on the page. A high average from thousands of ratings is strong evidence that buyers generally get what's shown. A low average or ratings split between 5 and 1 stars is a concern.
- Photo evidence can be uncertain: buyer photos may show another color or version sold on the same page, may be few, or may be unclear. When the photo check lists uncertainties, lower confidence rather than the score, and don't call a listing misleading on uncertain photo evidence alone, especially when the seller and ratings look solid.
- We judge whether the listing is honest about the product. We do not judge whether it is counterfeit, so don't call anything fake or a replica.
- Write plainly for a shopper, with no jargon.`;

export async function runVerdict(
  listing: ListingInput,
  checks: Record<Exclude<CheckName, "verdict">, CheckResult>,
): Promise<Verdict> {
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });

  // Send the model only what it needs; image bytes stay out (the image check already summarised them).
  const payload = {
    listing: {
      title: listing.title,
      site: listing.site,
      price: listing.price,
      sellerPhotoCount: listing.sellerImages.length,
      buyerPhotoCount: listing.buyerImages.length,
      visibleReviewCount: listing.reviews.length,
      seller: listing.seller ?? "not shown on the page",
      ratingSummary: listing.ratingSummary ?? "not shown on the page",
    },
    checks: Object.values(checks).map(({ name, status, score, summary, details, error }) => ({
      name,
      status,
      score,
      summary,
      error,
      details,
    })),
  };

  const res = await client.messages.parse({
    model: "claude-sonnet-5-5",
    max_tokens: 4096,
    system: SYSTEM,
    output_config: { effort: "medium", format: zodOutputFormat(VerdictSchema) },
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined to write a verdict for this listing");
  if (!res.parsed_output) throw new Error("Claude returned a verdict we couldn't read");

  return enforceRules(res.parsed_output, checks);
}

// The model is instructed on these rules; enforce them in code too so a bad output can't overclaim.
function enforceRules(v: Verdict, checks: Record<string, CheckResult>): Verdict {
  const missing = Object.values(checks).filter((c) => c.status === "error" || c.status === "skipped");
  const verdict: Verdict = {
    ...v,
    score: clamp(v.score),
    reasons: v.reasons.slice(0, 2),
  };

  const unmentioned = missing.filter((c) => !verdict.caveats.some((cv) => cv.toLowerCase().includes(c.name)));
  if (unmentioned.length > 0) {
    verdict.caveats.unshift(`The ${unmentioned.map((c) => c.name).join(" and ")} check didn't run, so it isn't reflected here.`);
  }
  verdict.caveats = verdict.caveats.slice(0, 2);

  if (missing.length >= 2) verdict.confidence = "low";
  else if (missing.length === 1 && verdict.confidence === "high") verdict.confidence = "medium";
  if (checks.images?.status !== "done" || missing.length >= 3) {
    verdict.label = "not enough data";
    verdict.confidence = "low";
  }
  return verdict;
}
