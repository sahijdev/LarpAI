import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { checksV, listingInputV, verdictV } from "./validators";

export default defineSchema({
  reports: defineTable({
    listingKey: v.string(),
    listing: listingInputV,
    status: v.union(v.literal("running"), v.literal("done"), v.literal("error")),
    checks: checksV,
    verdict: v.optional(verdictV),
    createdAt: v.number(),
  }).index("by_listingKey", ["listingKey"]),
});
