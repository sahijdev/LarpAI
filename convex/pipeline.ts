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

    // Phase 1: independent checks.
    const [comparison, reviews] = await Promise.all([
      step("comparison", () => runComparison(listing)),
      step("reviews", () => runReviews(listing)),
    ]);
    const found = comparison.status === "done" ? (comparison.details as ComparisonDetails) : undefined;

    // Phase 2: checks that use comparison results (they still run if it failed).
    const [images, price] = await Promise.all([
      step("images", () => runImages(listing, found)),
      step("price", () => runPrice(listing, found)),
    ]);

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
