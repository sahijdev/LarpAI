"use node";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod/v4";
import phash from "sharp-phash";
import distance from "sharp-phash/distance";
import sharp from "sharp";
import type { ListingInput } from "../../shared/types";
import type { StepOutput } from "../pipeline";
import type { ComparisonDetails } from "./comparison";
import { clamp, fetchImage, normalizeImageUrl, requireEnv } from "./util";

const MAX_PER_GROUP = 4;
const DUPLICATE_MAX_DISTANCE = 10; // of 64 bits

type Img = { url: string; buffer: Buffer; mimeType: string };
type Group = "seller" | "buyer" | "official";

async function loadGroup(urls: string[]): Promise<Img[]> {
  const settled = await Promise.allSettled(
    urls.slice(0, MAX_PER_GROUP).map(async (url) => {
      const { buffer } = await fetchImage(url);
      // Re-encode to JPEG: Claude and pHash both handle it, and it strips webp/avif surprises.
      const jpeg = await sharp(buffer).resize(768, 768, { fit: "inside" }).jpeg().toBuffer();
      return { url: normalizeImageUrl(url), buffer: jpeg, mimeType: "image/jpeg" };
    }),
  );
  return settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
}

// Seller photos that are pixel-near-identical to the brand's own photos.
async function findReusedPhotos(seller: Img[], official: Img[]) {
  const hashes = async (imgs: Img[]) => Promise.all(imgs.map((i) => phash(i.buffer)));
  const [sellerHashes, officialHashes] = await Promise.all([hashes(seller), hashes(official)]);
  const matches: { sellerUrl: string; officialUrl: string; distance: number }[] = [];
  sellerHashes.forEach((sh, si) => {
    officialHashes.forEach((oh, oi) => {
      const d = distance(sh, oh);
      if (d <= DUPLICATE_MAX_DISTANCE) {
        matches.push({ sellerUrl: seller[si].url, officialUrl: official[oi].url, distance: d });
      }
    });
  });
  return matches;
}

const ImageComparison = z.object({
  matchScore: z.number().describe("0-100, how well seller photos represent what buyers received"),
  mismatches: z.array(z.string()),
  explanation: z.string(),
});

async function compareWithClaude(groups: Record<Group, Img[]>, title: string) {
  const client = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
  const content: Anthropic.ContentBlockParam[] = [];
  for (const group of ["seller", "buyer", "official"] as const) {
    if (groups[group].length === 0) continue;
    content.push({ type: "text", text: `${group.toUpperCase()} photos:` });
    for (const img of groups[group]) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: img.buffer.toString("base64") },
      });
    }
  }
  content.push({
    type: "text",
    text:
      `Product listing: "${title}".\n` +
      "Compare the photo groups above. SELLER photos are the listing's marketing images. " +
      "BUYER photos are what customers posted in reviews. OFFICIAL photos come from the brand or reputable retailers. " +
      "Judge whether the seller photos honestly represent the product buyers actually received: color, material, " +
      "shape, size, logo, finish, details. Ignore lighting and photo quality. If a group is missing, say so and judge " +
      "only what you can. List concrete mismatches.",
  });

  const res = await client.messages.parse({
    model: "claude-haiku-5-5",
    max_tokens: 4096,
    output_config: { effort: "medium", format: zodOutputFormat(ImageComparison) },
    messages: [{ role: "user", content }],
  });
  if (res.stop_reason === "refusal") throw new Error("Claude declined to compare these photos");
  if (!res.parsed_output) throw new Error("Claude returned an image analysis we couldn't read");
  return res.parsed_output;
}

export async function runImages(listing: ListingInput, found?: ComparisonDetails): Promise<StepOutput> {
  const [seller, buyer, official] = await Promise.all([
    loadGroup(listing.sellerImages),
    loadGroup(listing.buyerImages),
    loadGroup(found?.officialImages ?? []),
  ]);
  if (seller.length === 0) throw new Error("Couldn't download any seller photos");
  if (buyer.length === 0 && official.length === 0) {
    return {
      status: "skipped",
      summary: "No buyer photos or reference photos to compare against",
      details: { sellerCount: seller.length },
    };
  }

  const [reused, vision] = await Promise.all([
    official.length > 0 ? findReusedPhotos(seller, official) : Promise.resolve([]),
    compareWithClaude({ seller, buyer, official }, listing.title),
  ]);

  const gaps = [buyer.length === 0 && "no buyer photos", official.length === 0 && "no official photos"].filter(Boolean);

  return {
    score: clamp(vision.matchScore),
    summary: vision.mismatches.length
      ? `Photos differ: ${vision.mismatches.slice(0, 2).join("; ")}`
      : "Seller photos look consistent with what buyers received",
    details: {
      explanation: vision.explanation,
      mismatches: vision.mismatches,
      reusedOfficialPhotos: reused,
      compared: { seller: seller.length, buyer: buyer.length, official: official.length },
      gaps,
    },
    evidence: [
      ...seller.slice(0, 2).map((i) => ({ label: "Seller photo", imageUrl: i.url })),
      ...buyer.slice(0, 2).map((i) => ({ label: "Buyer photo", imageUrl: i.url })),
      ...reused.slice(0, 2).map((r) => ({
        label: "Seller photo reused from official site",
        imageUrl: r.sellerUrl,
        sourceUrl: r.officialUrl,
      })),
    ],
  };
}
