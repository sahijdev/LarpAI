import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CheckName, CheckResult, ListingInput, Verdict } from "../../../shared/types";
import { CHECK_NAMES, normalizeListingKey } from "../../../shared/listingKey";
import { AUTOSTART_PARAM, isSupportedListing, postToPage, type StartMessage } from "../../lib/pageMessages";

type ExtractResponse = { ok: true; listing: ListingInput } | { ok: false; error: string } | undefined;

// This page runs in a frame that the listing tab's content script created, so that script is
// always there to answer.
async function requestListing(tabId: number): Promise<ExtractResponse> {
  try {
    return (await browser.tabs.sendMessage(tabId, { type: "larpai:extract" })) as ExtractResponse;
  } catch {
    throw new Error("Couldn't read this page. Reload the tab and try again.");
  }
}

type Phase =
  | { kind: "idle" }
  | { kind: "unsupported" }
  | { kind: "ready" }
  | { kind: "consent" }
  | { kind: "extracting" }
  | { kind: "error"; message: string }
  | { kind: "report"; reportId: Id<"reports">; cached: boolean };

// Set once the shopper agrees to the data notice; nothing leaves the browser before that.
const CONSENT_KEY = "larpai:consent:v1";

async function hasConsent(): Promise<boolean> {
  try {
    const stored = await browser.storage.local.get(CONSENT_KEY);
    return stored[CONSENT_KEY] === true;
  } catch {
    return false;
  }
}

// The tab this drawer is embedded in. getCurrent() resolves it for a frame inside a tab;
// the active-tab query is a fallback (the shopper just clicked the drawer open, so it's the active tab).
async function activeListingTab() {
  const tab =
    (await browser.tabs.getCurrent()) ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id || !tab.url || !isSupportedListing(tab.url)) return undefined;
  return { id: tab.id, url: tab.url, key: normalizeListingKey(tab.url) };
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const startCheck = useMutation(api.reports.startCheck);
  // Listings checked in this tab, so navigating back to one shows its report again.
  const checked = useRef(new Map<string, Id<"reports">>());
  // The listing the drawer is showing; navigation events for the same listing leave it alone.
  const shownKey = useRef<string | undefined>(undefined);
  // In-memory copy of the agreement, so a check still runs if storage can't be written.
  const consented = useRef(false);

  // Keep the on-page button in sync when there's no report on screen.
  useEffect(() => {
    if (phase.kind !== "report") postToPage({ type: "larpai:status", state: "idle" });
  }, [phase.kind]);

  // Called when the drawer opens and when the tab navigates. Only looks at the tab URL; never sends anything.
  const refresh = useCallback(async () => {
    const tab = await activeListingTab();
    if (tab?.key === shownKey.current && shownKey.current !== undefined) return;
    shownKey.current = tab?.key;
    if (!tab) return setPhase({ kind: "unsupported" });
    const reportId = checked.current.get(tab.key);
    setPhase(reportId ? { kind: "report", reportId, cached: false } : { kind: "ready" });
  }, []);

  // Runs only when the shopper presses a button.
  const run = useCallback(
    async (force = false) => {
      const tab = await activeListingTab();
      shownKey.current = tab?.key;
      if (!tab) return setPhase({ kind: "unsupported" });
      if (!consented.current) consented.current = await hasConsent();
      if (!consented.current) return setPhase({ kind: "consent" });
      setPhase({ kind: "extracting" });
      try {
        const res = await requestListing(tab.id);
        if (!res) throw new Error("Couldn't reach the page. Try reloading the listing tab.");
        if (!res.ok) throw new Error(res.error);
        if (res.listing.sellerImages.length === 0) {
          throw new Error("Couldn't find the listing photos on this page. Scroll to the gallery and try again.");
        }
        const { reportId, cached } = await startCheck({ listing: res.listing, force });
        checked.current.set(tab.key, reportId);
        if (shownKey.current === tab.key) setPhase({ kind: "report", reportId, cached });
      } catch (err) {
        if (shownKey.current === tab.key) {
          setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
    },
    [startCheck],
  );

  const agree = async () => {
    consented.current = true;
    try {
      await browser.storage.local.set({ [CONSENT_KEY]: true });
    } catch (err) {
      // Storage unavailable (e.g. extension not reloaded after the permission was added):
      // the agreement still counts while this panel is open.
      console.warn("LarpAI: couldn't save consent", err);
    }
    run();
  };

  // "Check listing" on the page starts the check straight away (consent is still asked first).
  useEffect(() => {
    if (new URLSearchParams(location.search).has(AUTOSTART_PARAM)) run();
    else refresh();
    const onMessage = (event: MessageEvent) => {
      if (event.source === window.parent && (event.data as StartMessage)?.type === "larpai:start") run();
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // Once on mount: run and refresh never change.
  }, []);

  useEffect(() => {
    // Sites like Amazon and Temu change listing (e.g. picking a variant) without reloading the page.
    let ownTabId: number | undefined;
    browser.tabs.getCurrent().then((tab) => (ownTabId = tab?.id));
    const onUpdated = (tabId: number, info: { url?: string; status?: string }) => {
      if (tabId === ownTabId && (info.url || info.status === "complete")) refresh();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") postToPage({ type: "larpai:close" });
    };
    browser.tabs.onUpdated.addListener(onUpdated);
    window.addEventListener("keydown", onKey);
    return () => {
      browser.tabs.onUpdated.removeListener(onUpdated);
      window.removeEventListener("keydown", onKey);
    };
  }, [refresh]);

  return (
    <main className="mx-auto min-h-screen max-w-md text-sm">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200/80 bg-white/90 px-4 py-3 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-950/90">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-900 text-xs font-semibold text-white dark:bg-white dark:text-neutral-950">
            L
          </span>
          <div>
            <h1 className="text-sm font-semibold leading-none tracking-tight">LarpAI</h1>
            <p className="mt-1 text-[11px] text-neutral-500">Does this listing match?</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {phase.kind === "report" && (
            <button type="button" className={buttonClass} onClick={() => run(true)}>
              Re-check
            </button>
          )}
          <button
            type="button"
            aria-label="Close LarpAI"
            className="flex h-7 w-7 items-center justify-center rounded-full text-lg leading-none text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            onClick={() => postToPage({ type: "larpai:close" })}
          >
            ×
          </button>
        </div>
      </header>

      <div className="space-y-4 px-4 py-4">
        {phase.kind === "idle" && <StatusCard title="Opening the check" body="Looking at the tab you have open." />}
        {phase.kind === "unsupported" && (
          <StatusCard
            title="No product page on this tab"
            body="Open a Taobao, Tmall, Temu, or Amazon product page. The check runs on the listing you're already viewing."
          />
        )}
        {phase.kind === "ready" && (
          <section className="space-y-3 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
            <div>
              <p className="font-medium">Ready to check this listing</p>
              <p className="mt-1 leading-relaxed text-neutral-500">
                We'll compare its photos, reviews and price with what buyers actually got.
              </p>
            </div>
            <button type="button" className={primaryButtonClass} onClick={() => run()}>
              Check this listing
            </button>
          </section>
        )}
        {phase.kind === "consent" && <ConsentNotice onAgree={agree} onCancel={() => setPhase({ kind: "ready" })} />}
        {phase.kind === "extracting" && <ReadingCard />}
        {phase.kind === "error" && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
            <p className="font-medium">Couldn't read this page</p>
            <p className="mt-1 leading-relaxed">{phase.message}</p>
            <button type="button" className={`${buttonClass} mt-3`} onClick={() => run()}>
              Try again
            </button>
          </div>
        )}
        {phase.kind === "report" && <Report reportId={phase.reportId} cached={phase.cached} />}
      </div>
    </main>
  );
}

const buttonClass =
  "rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-800 transition hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:focus-visible:outline-neutral-100";

const primaryButtonClass =
  "w-full rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200 dark:focus-visible:outline-neutral-100";

function ConsentNotice({ onAgree, onCancel }: { onAgree: () => void; onCancel: () => void }) {
  return (
    <section className="space-y-3 rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div>
        <p className="font-medium">Before your first check</p>
        <p className="mt-1 leading-relaxed text-neutral-600 dark:text-neutral-400">
          LarpAI reads this listing's title, price, photos and the review text shown on the page. It never reads
          reviewer names or anything about you.
        </p>
      </div>
      <ul className="list-disc space-y-1.5 pl-5 leading-relaxed text-neutral-700 dark:text-neutral-300">
        <li>The listing goes to the LarpAI server to run the checks.</li>
        <li>The product name is searched on the public web (via Apify) to find the official product.</li>
        <li>Photos and check results are analysed by Claude, Anthropic's AI model.</li>
        <li>Reports are saved so the next check of the same listing is instant.</li>
      </ul>
      <p className="text-xs text-neutral-500">Nothing is sent until you press Check. This notice shows once.</p>
      <div className="flex items-center gap-2">
        <button type="button" className={primaryButtonClass} onClick={onAgree}>
          I agree, check it
        </button>
        <button type="button" className={`${buttonClass} shrink-0`} onClick={onCancel}>
          Not now
        </button>
      </div>
    </section>
  );
}

function Report({ reportId, cached }: { reportId: Id<"reports">; cached: boolean }) {
  const report = useQuery(api.reports.get, { reportId });
  const score = (report?.verdict as Verdict | undefined)?.score;
  const label = (report?.verdict as Verdict | undefined)?.label;
  const reason = (report?.verdict as Verdict | undefined)?.reasons[0];
  const running = report?.status === "running";

  // Mirror the result onto the listing page (floating button and inline summary).
  useEffect(() => {
    if (report === undefined) return;
    postToPage(
      label !== undefined
        ? { type: "larpai:status", state: "done", score, label, reason }
        : { type: "larpai:status", state: running ? "running" : "idle" },
    );
  }, [report === undefined, running, score, label, reason]);

  if (report === undefined) return <StatusCard title="Connecting" body="Waiting for the report." />;
  if (report === null) return <StatusCard title="Report not found" body="Run the check again from this listing." />;

  const listing = report.listing as ListingInput;
  const checks = report.checks as Record<CheckName, CheckResult>;
  const steps = CHECK_NAMES.filter((name) => name !== "verdict");
  const verdict = report.verdict as Verdict | undefined;

  return (
    <div className="space-y-4">
      <ListingHeading listing={listing} />
      {cached && (
        <p className="rounded-xl bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
          Saved {new Date(report.createdAt).toLocaleString()}. Re-check to run it again.
        </p>
      )}
      <VerdictHero verdict={verdict} running={report.status === "running"} />
      {verdict && verdict.label !== "looks legit" && <Alternative checks={checks} listing={listing} />}
      <PhotoCompare listing={listing} />
      <ScoreStrip checks={checks} steps={steps} />
      {report.status === "running" && <CheckProgress checks={checks} steps={steps} />}
      <VerdictDetails verdict={verdict} />
      <section className="space-y-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Checks</h2>
        {steps.map((name) => (
          <CheckCard key={name} check={checks[name]} />
        ))}
        {checks.verdict.status === "error" && <CheckCard check={checks.verdict} />}
      </section>
    </div>
  );
}

const TONE: Record<Verdict["label"], { ring: string; pill: string; bar: string }> = {
  "looks legit": {
    ring: "stroke-emerald-500",
    pill: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    bar: "bg-emerald-500",
  },
  "some concerns": {
    ring: "stroke-amber-500",
    pill: "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    bar: "bg-amber-500",
  },
  "likely misleading": {
    ring: "stroke-red-500",
    pill: "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200",
    bar: "bg-red-500",
  },
  "not enough data": {
    ring: "stroke-neutral-400",
    pill: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200",
    bar: "bg-neutral-400",
  },
};

const LABEL_COPY: Record<Verdict["label"], string> = {
  "looks legit": "Looks legit",
  "some concerns": "Some concerns",
  "likely misleading": "Likely misleading",
  "not enough data": "Not enough data",
};

function VerdictHero({ verdict, running }: { verdict?: Verdict; running: boolean }) {
  if (!verdict) {
    return (
      <section className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
        <p className="font-medium">{running ? "Checking this listing" : "No verdict yet"}</p>
        <p className="mt-1 text-neutral-500">
          {running ? "Scores will fill in as each check finishes." : "The verdict didn't finish. The checks below still show what we found."}
        </p>
      </section>
    );
  }

  const tone = TONE[verdict.label];
  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-center gap-4 p-4">
        <ScoreRing score={verdict.score} ringClass={tone.ring} />
        <div className="min-w-0">
          <p className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${tone.pill}`}>{LABEL_COPY[verdict.label]}</p>
          <p className="mt-1.5 text-xs capitalize text-neutral-500">{verdict.confidence} confidence</p>
        </div>
      </div>
      <div className="h-1 bg-neutral-100 dark:bg-neutral-800">
        <div className={`h-full ${tone.bar}`} style={{ width: `${verdict.score}%` }} />
      </div>
    </section>
  );
}

function VerdictDetails({ verdict }: { verdict?: Verdict }) {
  if (!verdict) return null;
  return (
    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <h2 className="border-b border-neutral-100 px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800">
        Why
      </h2>
      <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {verdict.reasons.map((reason) => (
          <li key={reason} className="px-4 py-3 leading-relaxed text-neutral-800 dark:text-neutral-200">
            {reason}
          </li>
        ))}
      </ul>
      {verdict.caveats.length > 0 && (
        <div className="border-t border-neutral-200 bg-neutral-50 px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">What we couldn't check</p>
          <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
            {verdict.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function ScoreRing({ score, ringClass }: { score: number; ringClass: string }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, Math.max(0, score)) / 100) * circumference;
  return (
    <div className="relative h-16 w-16 shrink-0" role="img" aria-label={`Match score ${score} out of 100`}>
      <svg viewBox="0 0 72 72" className="h-16 w-16 -rotate-90">
        <circle cx="36" cy="36" r={radius} fill="none" strokeWidth="6" className="stroke-neutral-200 dark:stroke-neutral-800" />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={ringClass}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-semibold tabular-nums">{score}</span>
    </div>
  );
}

function CheckProgress({ checks, steps }: { checks: Record<CheckName, CheckResult>; steps: CheckName[] }) {
  const finished = steps.filter((name) => {
    const status = checks[name]?.status;
    return status === "done" || status === "error" || status === "skipped";
  }).length;
  const pct = Math.round((finished / steps.length) * 100);
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[11px] text-neutral-500">
        <span>Still running</span>
        <span className="tabular-nums">
          {finished}/{steps.length}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div className="h-full rounded-full bg-neutral-900 transition-all dark:bg-neutral-100" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const STRIP_TITLES: Record<CheckName, string> = {
  comparison: "Sources",
  images: "Photos",
  reviews: "Reviews",
  price: "Price",
  verdict: "Verdict",
};

function ScoreStrip({ checks, steps }: { checks: Record<CheckName, CheckResult>; steps: CheckName[] }) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {steps.map((name) => {
        const check = checks[name];
        const showScore = check?.score !== undefined && name !== "comparison";
        return (
          <div key={name} className="rounded-xl border border-neutral-200 px-2 py-2 dark:border-neutral-800">
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">{STRIP_TITLES[name]}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {showScore ? check.score : statusLabel(check?.status ?? "pending")}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function ListingHeading({ listing }: { listing: ListingInput }) {
  const price = formatPrice(listing.price);
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {siteLabel(listing)}
        {price ? ` · ${price}` : ""}
      </p>
      <h2 className="mt-1 line-clamp-2 text-sm font-medium leading-snug">{listing.title}</h2>
    </div>
  );
}

// Shapes the comparison and price steps save in `details` (see convex/steps/comparison.ts and price.ts).
type FoundListing = {
  url: string;
  title: string;
  isOfficial: boolean;
  images: string[];
  price?: { amount: number; currency: string };
};
type ConvertedPrice = { url: string; amount: number };

// Points the shopper at the official page, or failing that a priced product page,
// that the comparison step found. Only real search results; shows nothing if there are none.
function pickAlternative(checks: Record<CheckName, CheckResult>, currency?: string) {
  if (checks.comparison.status !== "done") return undefined;
  const found = (checks.comparison.details?.comparables as FoundListing[] | undefined) ?? [];
  const pick = found
    .filter((c) => c.isOfficial || c.price)
    .sort((a, b) => Number(b.isOfficial) - Number(a.isOfficial) || Number(!!b.price) - Number(!!a.price))[0];
  if (!pick) return undefined;

  // Prefer the price check's figure, already converted to the listing's currency.
  const converted =
    checks.price.status === "done"
      ? (checks.price.details?.comparables as ConvertedPrice[] | undefined)?.find((c) => c.url === pick.url)
      : undefined;
  const price =
    converted && currency ? formatPrice({ amount: converted.amount, currency }) : formatPrice(pick.price);
  return { ...pick, price };
}

function Alternative({ checks, listing }: { checks: Record<CheckName, CheckResult>; listing: ListingInput }) {
  const alt = pickAlternative(checks, listing.price?.currency);
  if (!alt) return null;
  let host = alt.url;
  try {
    host = new URL(alt.url).hostname.replace(/^www\./, "");
  } catch {
    // keep the raw URL
  }
  const listingPrice = formatPrice(listing.price);
  return (
    <section className="rounded-2xl border border-neutral-200 p-3 dark:border-neutral-800">
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">Before you buy, compare with</h2>
      <a href={alt.url} target="_blank" rel="noreferrer" className="flex gap-3 rounded-xl transition hover:opacity-80">
        {alt.images[0] && (
          <img src={alt.images[0]} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-neutral-200 dark:ring-neutral-700" />
        )}
        <div className="min-w-0">
          <p className="line-clamp-2 font-medium leading-snug underline decoration-neutral-300 underline-offset-2">{alt.title || host}</p>
          <p className="mt-1 text-xs text-neutral-500">
            {alt.isOfficial ? "Official brand site" : host}
            {alt.price && ` · ${alt.price}`}
            {alt.price && listingPrice && ` (this listing ${listingPrice})`}
          </p>
        </div>
      </a>
      {!alt.isOfficial && (
        <p className="mt-2 text-xs text-neutral-500">Found by web search. We haven't checked this page ourselves.</p>
      )}
    </section>
  );
}

function PhotoCompare({ listing }: { listing: ListingInput }) {
  if (listing.sellerImages.length === 0 && listing.buyerImages.length === 0) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-neutral-200 p-3 dark:border-neutral-800">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Photos</h2>
      <PhotoRow label="Seller" urls={listing.sellerImages} />
      <PhotoRow label="Buyer" urls={listing.buyerImages} />
    </section>
  );
}

function PhotoRow({ label, urls }: { label: string; urls: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium">
        {label}
        <span className="ml-1.5 font-normal text-neutral-500">{urls.length === 0 ? "None on this page" : urls.length}</span>
      </p>
      {urls.length > 0 && (
        <div className="photo-row flex gap-2 overflow-x-auto">
          {urls.slice(0, 6).map((url, index) => (
            <img
              key={`${url}-${index}`}
              src={url}
              alt={`${label} photo ${index + 1}`}
              className="h-20 w-20 shrink-0 rounded-lg object-cover ring-1 ring-neutral-200 dark:ring-neutral-700"
            />
          ))}
        </div>
      )}
    </div>
  );
}

const CHECK_TITLES: Record<CheckName, string> = {
  comparison: "Find the real product",
  images: "Photo comparison",
  reviews: "Review patterns",
  price: "Price check",
  verdict: "Verdict",
};

const STATUS_DOT: Record<CheckResult["status"], string> = {
  pending: "bg-neutral-300 dark:bg-neutral-600",
  running: "animate-pulse bg-amber-400",
  done: "bg-emerald-500",
  error: "bg-red-500",
  skipped: "bg-neutral-300 dark:bg-neutral-600",
};

function CheckCard({ check }: { check: CheckResult }) {
  const showScore = check.score !== undefined && check.name !== "comparison";
  return (
    <article className="rounded-xl border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-start justify-between gap-3">
        <h3 className="flex items-center gap-2 font-medium">
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[check.status]}`} aria-hidden />
          {CHECK_TITLES[check.name]}
        </h3>
        <span className="shrink-0 text-xs tabular-nums text-neutral-500">{showScore ? check.score : statusLabel(check.status)}</span>
      </div>
      {check.summary && <p className="mt-2 leading-relaxed text-neutral-700 dark:text-neutral-300">{check.summary}</p>}
      {check.error && <p className="mt-2 leading-relaxed text-red-700 dark:text-red-300">{check.error}</p>}
      {check.evidence && check.evidence.length > 0 && (
        <ul className="mt-3 space-y-2">
          {check.evidence.slice(0, 4).map((item, index) => (
            <li key={index} className="flex items-center gap-2 text-xs">
              {item.imageUrl && <img src={item.imageUrl} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover ring-1 ring-neutral-200 dark:ring-neutral-700" />}
              {item.sourceUrl ? (
                <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="truncate text-neutral-700 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-600 dark:text-neutral-300">
                  {item.label}
                </a>
              ) : (
                <span className="truncate text-neutral-600 dark:text-neutral-400">{item.label}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function StatusCard({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
      <p className="font-medium">{title}</p>
      <p className="mt-1 leading-relaxed text-neutral-500">{body}</p>
    </section>
  );
}

function ReadingCard() {
  return (
    <section className="rounded-2xl border border-neutral-200 p-4 dark:border-neutral-800">
      <p className="font-medium">Reading this listing</p>
      <p className="mt-1 text-neutral-500">Pulling the title, price, and photos from the page.</p>
      <div className="mt-4 space-y-2">
        <div className="h-3 w-3/4 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-3 w-1/2 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-16 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-900" />
      </div>
    </section>
  );
}

function siteLabel(listing: ListingInput): string {
  const url = listing.url;
  if (/amazon\./i.test(url)) return "Amazon";
  if (/tmall\.com/i.test(url)) return "Tmall";
  if (listing.site === "taobao" || /taobao\.com/i.test(url)) return "Taobao";
  if (listing.site === "temu" || /temu\.com/i.test(url)) return "Temu";
  if (listing.site === "aliexpress") return "AliExpress";
  return "Listing";
}

function formatPrice(price: ListingInput["price"]): string | null {
  if (!price) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: price.currency }).format(price.amount);
  } catch {
    return `${price.amount} ${price.currency}`;
  }
}

function statusLabel(status: CheckResult["status"]): string {
  if (status === "done") return "Done";
  if (status === "running") return "Running";
  if (status === "error") return "Failed";
  if (status === "skipped") return "Skipped";
  return "Waiting";
}
