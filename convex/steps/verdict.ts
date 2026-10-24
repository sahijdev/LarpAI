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
- Every reason must point to a specific check result (for example "Buyer photos show a darker color than the seller photos (image check)"). Give 2-5 reasons.
- caveats must name every check that errored or was skipped, plus any real limits on what the evidence shows (for example: reused official photos are normal for authorised resellers).
- If the image check is missing, or fewer than two checks produced results, use label "not enough data" and confidence "low" rather than guessing.
- Lower confidence when checks are missing or disagree.
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
    reasons: v.reasons.slice(0, 5),
  };

  for (const c of missing) {
    if (!verdict.caveats.some((cv) => cv.toLowerCase().includes(c.name))) {
      verdict.caveats.push(
        c.status === "error"
          ? `The ${c.name} check failed (${c.error ?? "unknown error"}), so it isn't reflected here.`
          : `The ${c.name} check was skipped: ${c.summary ?? "not enough data"}.`,
      );
    }
  }

  if (missing.length >= 2) verdict.confidence = "low";
  else if (missing.length === 1 && verdict.confidence === "high") verdict.confidence = "medium";
  if (checks.images?.status !== "done" || missing.length >= 3) {
    verdict.label = "not enough data";
    verdict.confidence = "low";
  }
  return verdict;
}
