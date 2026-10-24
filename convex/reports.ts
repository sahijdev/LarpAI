import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { normalizeListingKey, CHECK_NAMES } from "../shared/listingKey";
import type { CheckName, CheckResult } from "../shared/types";
import { checkNameV, checkResultV, listingInputV, verdictV } from "./validators";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Called by the side panel. Returns a cached report if one is fresh,
// otherwise creates a running report and schedules the pipeline.
// A mutation (not an action) so the cache check + insert is transactional
// and the panel gets a reportId to subscribe to immediately.
export const startCheck = mutation({
  args: { listing: listingInputV, force: v.optional(v.boolean()) },
  handler: async (ctx, { listing, force }) => {
    const listingKey = normalizeListingKey(listing.url, listing.itemId);

    if (!force) {
      const existing = await ctx.db
        .query("reports")
        .withIndex("by_listingKey", (q) => q.eq("listingKey", listingKey))
        .order("desc")
        .first();
      if (
        existing &&
        existing.status !== "error" &&
        Date.now() - existing.createdAt < CACHE_TTL_MS
      ) {
        return { reportId: existing._id, cached: true };
      }
    }

    const checks = Object.fromEntries(
      CHECK_NAMES.map((name) => [name, { name, status: "pending" } satisfies CheckResult]),
    ) as Record<CheckName, CheckResult>;

    const reportId = await ctx.db.insert("reports", {
      listingKey,
      listing,
      status: "running",
      checks,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.pipeline.run, { reportId });
    return { reportId, cached: false };
  },
});

// Live-subscribed by the side panel; updates as each step saves.
export const get = query({
  args: { reportId: v.id("reports") },
  handler: (ctx, { reportId }) => ctx.db.get(reportId),
});

export const getInternal = internalQuery({
  args: { reportId: v.id("reports") },
  handler: (ctx, { reportId }) => ctx.db.get(reportId),
});

export const saveCheck = internalMutation({
  args: { reportId: v.id("reports"), name: checkNameV, result: checkResultV },
  handler: async (ctx, { reportId, name, result }) => {
    const report = await ctx.db.get(reportId);
    if (!report) return;
    await ctx.db.patch(reportId, { checks: { ...report.checks, [name]: result } });
  },
});

export const saveVerdict = internalMutation({
  args: { reportId: v.id("reports"), verdict: verdictV },
  handler: (ctx, { reportId, verdict }) => ctx.db.patch(reportId, { verdict }),
});

export const finish = internalMutation({
  args: { reportId: v.id("reports"), status: v.union(v.literal("done"), v.literal("error")) },
  handler: (ctx, { reportId, status }) => ctx.db.patch(reportId, { status }),
});
