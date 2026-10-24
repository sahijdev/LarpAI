import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { CheckName, CheckResult, ListingInput, Verdict } from "../../../shared/types";
import { CHECK_NAMES } from "../../../shared/listingKey";

// Taobao/Tmall item pages, Temu product pages ("...-g-<id>.html" or "goods.html?goods_id="),
// and Amazon product pages ("/dp/<ASIN>" or "/gp/product/<ASIN>").
const SUPPORTED = new RegExp(
  [
    String.raw`^https?://(item\.taobao\.com|detail\.tmall\.com)/`,
    String.raw`^https?://world\.taobao\.com/item/`,
    String.raw`^https?://([a-z]+\.)?temu\.com/(.*-g-\d+\.html|goods\.html\?.*goods_id=)`,
    String.raw`^https?://(www\.|smile\.)?amazon\.(com|co\.uk|ca)/(.*/)?(dp|gp/product)/[A-Z0-9]{10}`,
  ].join("|"),
);

type ExtractResponse = { ok: true; listing: ListingInput } | { ok: false; error: string } | undefined;

// Chrome only injects content scripts on page load, so a tab opened before the extension was
// installed or reloaded (every dev rebuild) has none. Inject it on demand and ask again.
async function requestListing(tabId: number): Promise<ExtractResponse> {
  const ask = () => browser.tabs.sendMessage(tabId, { type: "larpai:extract" }) as Promise<ExtractResponse>;
  try {
    return await ask();
  } catch (err) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(String(err))) throw err;
    await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/content.js"] });
    try {
      return await ask();
    } catch {
      throw new Error("Couldn't read this page. Reload the tab and try again.");
    }
  }
}

type Phase =
  | { kind: "idle" }
  | { kind: "unsupported" }
  | { kind: "extracting" }
  | { kind: "error"; message: string }
  | { kind: "report"; reportId: Id<"reports">; cached: boolean };

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const startCheck = useMutation(api.reports.startCheck);

  const run = useCallback(
    async (force = false) => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url || !SUPPORTED.test(tab.url)) {
        setPhase({ kind: "unsupported" });
        return;
      }
      setPhase({ kind: "extracting" });
      try {
        const res = await requestListing(tab.id);
        if (!res) throw new Error("Couldn't reach the page. Try reloading the listing tab.");
        if (!res.ok) throw new Error(res.error);
        if (res.listing.sellerImages.length === 0) {
          throw new Error("Couldn't find the listing photos on this page. Scroll to the gallery and try again.");
        }
        const { reportId, cached } = await startCheck({ listing: res.listing, force });
        setPhase({ kind: "report", reportId, cached });
      } catch (err) {
        setPhase({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      }
    },
    [startCheck],
  );

  // Run on open, and again when the user switches tabs or navigates.
  useEffect(() => {
    run();
    const onActivated = () => run();
    const onUpdated = (_id: number, info: { status?: string }, tab: { active?: boolean }) => {
      if (tab.active && info.status === "complete") run();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [run]);

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
        {phase.kind === "report" && (
          <button type="button" className={buttonClass} onClick={() => run(true)}>
            Re-check
          </button>
        )}
      </header>

      <div className="space-y-4 px-4 py-4">
        {phase.kind === "idle" && <StatusCard title="Opening the check" body="Looking at the tab you have open." />}
        {phase.kind === "unsupported" && (
          <StatusCard
            title="No product page on this tab"
            body="Open a Taobao, Tmall, Temu, or Amazon product page. The check runs on the listing you're already viewing."
          />
        )}
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

function Report({ reportId, cached }: { reportId: Id<"reports">; cached: boolean }) {
  const report = useQuery(api.reports.get, { reportId });
  if (report === undefined) return <StatusCard title="Connecting" body="Waiting for the report." />;
  if (report === null) return <StatusCard title="Report not found" body="Run the check again from this listing." />;

  const listing = report.listing as ListingInput;
  const checks = report.checks as Record<CheckName, CheckResult>;
  const steps = CHECK_NAMES.filter((name) => name !== "verdict");

  return (
    <div className="space-y-4">
      <ListingHeading listing={listing} />
      {cached && (
        <p className="rounded-xl bg-neutral-100 px-3 py-2 text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-400">
          Saved {new Date(report.createdAt).toLocaleString()}. Re-check to run it again.
        </p>
      )}
      <VerdictHero verdict={report.verdict as Verdict | undefined} running={report.status === "running"} />
      <PhotoCompare listing={listing} />
      <ScoreStrip checks={checks} steps={steps} />
      {report.status === "running" && <CheckProgress checks={checks} steps={steps} />}
      <VerdictDetails verdict={report.verdict as Verdict | undefined} />
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
