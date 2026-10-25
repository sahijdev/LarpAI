"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { CheckName, CheckResult, ListingInput } from "../shared/types";
import { runComparison, type ComparisonDetails } from "./steps/comparison";
import { runImages } from "./steps/images";
import { runReviews } from "./steps/reviews";
import { runPrice } from "./steps/price";
import { runVerdict } from "./steps/verdict";

// What a step returns; the wrapper fills in name, status and timing.
export type StepOutput = Omit<CheckResult, "name" | "status" | "durationMs"> & {
  status?: "done" | "skipped";
};

export const run = internalAction({
  args: { reportId: v.id("reports") },
  handler: async (ctx, { reportId }) => {
    const report = await ctx.runQuery(internal.reports.getInternal, { reportId });
    if (!report) return;
    const listing = report.listing as ListingInput;
    const step = makeStepRunner(ctx, reportId);
    const save = (name: CheckName, result: CheckResult) =>
      ctx.runMutation(internal.reports.saveCheck, { reportId, name, result });

    // Phase 1: everything that doesn't need the web search starts now. The photo check compares
    // seller vs. buyer photos straight away instead of waiting 30-90s for the official photos.
    const comparisonP = step("comparison", () => runComparison(listing));
    const reviewsP = step("reviews", () => runReviews(listing));
    const imagesP = step("images", () => runImages(listing, undefined));

    // Early verdict from photos + reviews, so the shopper sees a result in seconds. The final
    // verdict replaces it. Best effort: if it fails, the shopper just waits for the final one.
    const earlyP = Promise.all([imagesP, reviewsP]).then(async ([images, reviews]) => {
      if (images.status !== "done") return;
      try {
        const verdict = await runVerdict(
          listing,
          {
            comparison: { name: "comparison", status: "running" },
            images,
            reviews,
            price: { name: "price", status: "pending" },
          },
          { early: true },
        );
        await ctx.runMutation(internal.reports.saveVerdict, { reportId, verdict });
      } catch (err) {
        console.warn("Early verdict failed", err);
      }
    });

    const comparison = await comparisonP;
    const found = comparison.status === "done" ? (comparison.details as ComparisonDetails) : undefined;

    // Phase 2: price needs the web search results. The photo check runs again with the official
    // photos added (catches seller photos copied from the brand), replacing the first result.
    const [images, price] = await Promise.all([
      found?.officialImages.length ? refine("images", imagesP, () => runImages(listing, found)) : imagesP,
      step("price", () => runPrice(listing, found)),
    ]);
    const reviews = await reviewsP;
    await earlyP; // so the early verdict can never overwrite the final one

    // Phase 3: Claude verdict over everything, including errors.
    const verdictCheck = await step("verdict", async () => {
      const verdict = await runVerdict(listing, { comparison, images, reviews, price });
      await ctx.runMutation(internal.reports.saveVerdict, { reportId, verdict });
      return { score: verdict.score, summary: `${verdict.label} (${verdict.confidence} confidence)` };
    });

    await ctx.runMutation(internal.reports.finish, {
      reportId,
      status: verdictCheck.status === "error" ? "error" : "done",
    });

    // Re-runs a finished step with more data. The first result stays visible meanwhile, and is
    // kept if the re-run fails.
    async function refine(name: CheckName, first: Promise<CheckResult>, fn: () => Promise<StepOutput>) {
      const prev = await first;
      const started = Date.now();
      try {
        const out = await fn();
        const result: CheckResult = {
          ...out,
          name,
          status: out.status ?? "done",
          durationMs: (prev.durationMs ?? 0) + (Date.now() - started),
        };
        await save(name, result);
        return result;
      } catch (err) {
        console.warn(`Refining ${name} failed; keeping the first result`, err);
        return prev;
      }
    }
  },
});

function makeStepRunner(ctx: ActionCtx, reportId: Id<"reports">) {
  return async (name: CheckName, fn: () => Promise<StepOutput>): Promise<CheckResult> => {
    const save = (result: CheckResult) =>
      ctx.runMutation(internal.reports.saveCheck, { reportId, name, result });

    await save({ name, status: "running" });
    const started = Date.now();
    let result: CheckResult;
    try {
      const out = await fn();
      result = { ...out, name, status: out.status ?? "done", durationMs: Date.now() - started };
    } catch (err) {
      result = { name, status: "error", error: humanError(err), durationMs: Date.now() - started };
    }
    await save(result);
    return result;
  };
}

function humanError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}
