# LarpAI

> **Is this listing larping?** A browser extension that checks whether an online shopping listing matches what you'll actually get.

This README is the shared source of truth for the team **and for everyone's AI coding agent**. If you're an AI agent reading this: follow the architecture, shared types, and constraints below. Don't invent new services, languages, or data shapes without the team agreeing.

---

## 1. What we're building

A Chrome extension. When a user opens a product listing (starting with **Taobao**), LarpAI:

1. Reads the listing the user is already viewing (title, price, seller photos, visible reviews and buyer photos).
2. Finds the **real product** and comparable listings on the public web (via Apify).
3. Compares images: seller photos vs. buyer photos vs. official product photos.
4. Checks reviews for suspicious patterns and the price for "too good to be true."
5. Shows a **match score + plain-English verdict** in the Chrome side panel, with results streaming in live as each check finishes.

**Pitch framing (important):** "Does this listing match reality?" (misleading photos, stolen images, fake reviews, bait pricing). We do **not** pitch it as a replica/counterfeit quality checker.

**Target user (fill in once decided):** e.g. "Berkeley international students buying from Taobao who've been burned by listings that didn't match." Keep it specific; the Anthropic judges want a named community.

---

## 2. Prize tracks we're targeting

| Track | Prize | What judges want | How we hit it |
|---|---|---|---|
| **Visa: Reimagining Shopping** | $5,000 | Innovation 25%, UX 25%, technical execution 20%, commerce impact 15%, trust & responsibility 15% | Trust layer for online shopping; seamless, instant UX; transparent explanations |
| **Apify** | $2k / $1k / $800 / $400 / $400 (+$400 best Actor) | Meaningful use of Apify, overall quality | Apify is how we get all comparison data; stretch goal: publish our own Actor |
| **Convex** | $5,000 | Convex as the real backend | DB, server functions, cached reports, live-streaming results to the side panel |
| **Anthropic** | TBD | Named community, real lived problem, one thing done well, thoughtful Claude use incl. failure modes | Claude writes the final verdict; we show where it could be wrong and how we handle that |
| **MLH Gemini / Gen AI** | Swag | Use of Gemini / any gen-AI API | Gemini does the vision comparison |
| **Cal Hacks general** | Overall, People-First, Most Creative | Strong live demo, clear user | Automatic; polish the demo |

**Dropped:** Bright Data (login-rule risk on Taobao), Coinbase x402 (no natural fit), Hyphenate (finance-only).

---

## 3. Hard rules / constraints

- **No scraping behind a login or paywall.** The extension reads the page the *user* is already viewing in their own browser. Apify is used **only for public data** (search results, official brand pages, public retailer pages).
- **No personal data stored.** Don't save or display reviewer usernames, avatars, or anything identifying. Keep review text and photos only as needed for analysis.
- **No mocked or hardcoded data in the demo.** Everything shown must come from live runs. Fallbacks must be real alternate sources, not canned results.
- **Handle failure visibly.** Empty search results, slow scrapes, blocked pages, AI errors → the UI says what happened and the verdict reflects lower confidence. Never fake a result.
- **One language: TypeScript** everywhere. No separate Python server unless the team agrees.
- **No secrets in the repo.** Use `.env.local` / Convex environment variables.

---

## 4. Tech stack

| Layer | Tech | Notes |
|---|---|---|
| Extension | **WXT + React + Tailwind** (Manifest V3) | Content script reads the page; report renders in Chrome **side panel** |
| Backend | **Convex** | Queries, mutations, actions; live subscriptions push results to the extension |
| Web data | **Apify** (JS client, `apify-client`) | Called from Convex actions; existing Store Actors for Google Search + product pages |
| Image: duplicates | **Perceptual hash** (`sharp` + an image-hash package) | In a Convex Node action. Catches stolen/reused photos |
| Image: similarity | **CLIP via Hugging Face inference** | **Optional**, cut first if short on time |
| Image: explanation | **Gemini (Google AI Studio free tier)** | Multi-image prompt: seller vs. buyer vs. official photos |
| Final verdict | **Claude API** | Takes all evidence → score, verdict, reasons, confidence |

---

## 5. Architecture & data flow

```
[Taobao page in user's browser]
        │  content script extracts ListingInput
        ▼
[Extension] ──call──► convex action: reports.startCheck(listing)
                              │
                              ├─ creates Report doc (status: "running")
                              ├─ step: comparison  → Apify  → save CheckResult
                              ├─ step: images      → pHash + Gemini (+CLIP) → save CheckResult
                              ├─ step: reviews     → heuristics (+LLM)      → save CheckResult
                              ├─ step: price       → compare vs. found prices → save CheckResult
                              └─ step: verdict     → Claude over all results → save final verdict
                              
[Side panel] ◄── live query: reports.get(reportId)  (updates as each step saves)
```

- **Cache:** reports are keyed by a normalized listing URL / item ID. If a fresh report exists (e.g. < 24h), return it instantly.
- **Each step is independent:** if one fails, save it with `status: "error"` and continue. The verdict step must account for missing checks.

---

## 6. Shared data contracts (DO NOT change without telling the team)

```ts
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
  reasons: string[];           // 2–5 bullet reasons, each tied to evidence
  caveats: string[];           // what we couldn't check / where we might be wrong
};

export type Report = {
  listingKey: string;          // normalized cache key
  listing: ListingInput;
  status: "running" | "done" | "error";
  checks: Record<CheckName, CheckResult>;
  verdict?: Verdict;
  createdAt: number;
};
```

**Rule:** if checks are missing or errored, the verdict must lower confidence and list it in `caveats`. Use `"not enough data"` rather than guessing.

---

## 7. Repo layout

```
/extension          WXT app
  /entrypoints
    content.ts      page extraction → ListingInput
    sidepanel/      React report UI (subscribes to Convex)
    background.ts   opens side panel, relays messages
/convex
  schema.ts         reports table (+ indexes on listingKey)
  reports.ts        startCheck (action), get (query), internal save mutations
  steps/
    comparison.ts   Apify calls
    images.ts       pHash, Gemini, optional CLIP
    reviews.ts
    price.ts
    verdict.ts      Claude
/shared
  types.ts          the contracts above (single source of truth)
README.md
```

---

## 8. Roles

| Person | Owns |
|---|---|
| **1. Extension** | WXT setup, Taobao content-script extraction, side panel UI, live subscription, loading/error states |
| **2. Backend** | Convex schema, `startCheck` orchestration, caching, step status updates, error handling |
| **3. Data** | Apify: find official product + comparable listings + official images; fallbacks when results are empty/slow |
| **4. AI + story** | Gemini image comparison, Claude verdict prompt, demo script, video, pitch per track |

Agree on `shared/types.ts` **first**; everyone builds against it.

---

## 9. Timeline (~12 working hours)

| Hours | Goal |
|---|---|
| 0–1 | All together: lock target user + site, confirm what Taobao shows to the extension, get API keys (Convex, Apify, Gemini, Claude), commit `shared/types.ts` |
| 1–5 | Parallel builds; each piece works standalone on a **real** listing |
| 5–7 | Integrate end to end (extension → Convex → steps → live side panel) |
| 7–9 | Build "the moment": a real misleading listing caught (e.g. buyer photos don't match seller photos, or seller photos stolen from the brand site). Make failures graceful |
| 9–11 | Polish UI, record demo video, write submission + per-track blurbs |
| 11–12 | Buffer. **No new features.** |

**Cut order if behind:** CLIP → review heuristics depth → price check → Apify comparison breadth. Never cut: extraction, Gemini image check, Claude verdict, live side panel.

---

## 10. Demo plan

- **Open with the moment:** a real listing where LarpAI shows the buyer photos next to the seller photos and flags the mismatch, with the reasons.
- Then a legit listing scoring well (shows we're not just negative).
- Show a failure being handled live (e.g. no comparison results → lower confidence + caveat).
- Be ready for judges to pick their own listing.
- Prepare 2–3 tested real listings in advance, but everything runs live.
- One line on who it's for, plus a clear "what's real vs. what's not" slide.

---

## 11. Open questions / to-dos

- [ ] Confirm what Taobao exposes in the page DOM (reviews/buyer photos may need user interaction).
- [ ] Confirm with Apify booth: our extension-reads-page / Apify-public-only split is fine.
- [ ] Confirm how many sponsor prizes we can opt into.
- [ ] Pick final target user statement.
- [ ] Grab sponsor credits (Apify, Anthropic, Convex).
- [ ] Final name check (no existing app/extension conflicts).

---

## 12. Setup (fill in as we go)

```bash
# backend
npx convex dev

# extension
cd extension && npm install && npm run dev
```

Env vars (never commit values):

```
CONVEX_DEPLOYMENT=
APIFY_TOKEN=
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
HF_TOKEN=            # optional, CLIP
```
Set server-side keys in Convex: `npx convex env set APIFY_TOKEN ...`
