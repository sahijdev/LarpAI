// What the content script extracts from the page
export type ListingInput = {
  url: string;
  site: "taobao" | "aliexpress" | "temu" | "other";
  itemId?: string;
  title: string;
  price?: { amount: number; currency: string };
  sellerImages: string[];      // image URLs
  buyerImages: string[];       // review photo URLs visible on the page (may be empty)
  reviews: { text: string; rating?: number; date?: string }[]; // NO usernames
  brandGuess?: string;
  // Who sells it, as shown on the page. A business/store name, never a person.
  seller?: {
    name: string;              // e.g. "Amazon.com", "JBL Store", a Taobao shop name
    kind?: "marketplace" | "brand" | "third-party"; // sold by the platform itself / the brand's own store / anyone else
    shipsFrom?: string;
  };
  // The site's summary of ALL ratings (most reviews aren't on the product page).
  ratingSummary?: {
    average?: number;          // out of 5
    count?: number;            // total ratings
    distribution?: number[];   // % of ratings at [5, 4, 3, 2, 1] stars
    highlights?: string;       // the site's own review summary (e.g. Amazon "Customers say")
  };
};

export type CheckName = "comparison" | "images" | "reviews" | "price" | "verdict";

export type CheckResult = {
  name: CheckName;
  status: "pending" | "running" | "done" | "error" | "skipped";
  score?: number;              // 0–100, higher = more trustworthy / better match
  summary?: string;            // one plain-English line for the UI
  details?: Record<string, unknown>;
  evidence?: { label: string; imageUrl?: string; sourceUrl?: string }[];
  error?: string;              // human-readable, shown in UI
  durationMs?: number;
};

export type Verdict = {
  score: number;               // 0–100 overall match score
  label: "looks legit" | "some concerns" | "likely misleading" | "not enough data";
  confidence: "low" | "medium" | "high";
  reasons: string[];           // 1–2 short reasons, each tied to evidence
  caveats: string[];           // at most 2 short lines: what we couldn't check / where we might be wrong
};

export type Report = {
  listingKey: string;          // normalized cache key
  listing: ListingInput;
  status: "running" | "done" | "error";
  checks: Record<CheckName, CheckResult>;
  verdict?: Verdict;
  createdAt: number;
};
