// Convex validators mirroring shared/types.ts. Keep the two in sync.
import { v } from "convex/values";

export const listingInputV = v.object({
  url: v.string(),
  site: v.union(v.literal("taobao"), v.literal("aliexpress"), v.literal("temu"), v.literal("other")),
  itemId: v.optional(v.string()),
  title: v.string(),
  price: v.optional(v.object({ amount: v.number(), currency: v.string() })),
  sellerImages: v.array(v.string()),
  buyerImages: v.array(v.string()),
  reviews: v.array(
    v.object({ text: v.string(), rating: v.optional(v.number()), date: v.optional(v.string()) }),
  ),
  brandGuess: v.optional(v.string()),
});

export const checkNameV = v.union(
  v.literal("comparison"),
  v.literal("images"),
  v.literal("reviews"),
  v.literal("price"),
  v.literal("verdict"),
);

export const checkResultV = v.object({
  name: checkNameV,
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("done"),
    v.literal("error"),
    v.literal("skipped"),
  ),
  score: v.optional(v.number()),
  summary: v.optional(v.string()),
  details: v.optional(v.any()),
  evidence: v.optional(
    v.array(
      v.object({
        label: v.string(),
        imageUrl: v.optional(v.string()),
        sourceUrl: v.optional(v.string()),
      }),
    ),
  ),
  error: v.optional(v.string()),
  durationMs: v.optional(v.number()),
});

export const verdictV = v.object({
  score: v.number(),
  label: v.union(
    v.literal("looks legit"),
    v.literal("some concerns"),
    v.literal("likely misleading"),
    v.literal("not enough data"),
  ),
  confidence: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
  reasons: v.array(v.string()),
  caveats: v.array(v.string()),
});

export const checksV = v.object({
  comparison: checkResultV,
  images: checkResultV,
  reviews: checkResultV,
  price: checkResultV,
  verdict: checkResultV,
});
