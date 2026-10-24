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
    <main className="mx-auto max-w-md space-y-4 p-4 text-sm">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">LarpAI</h1>
        {phase.kind === "report" && (
          <button className="text-xs text-neutral-500 underline" onClick={() => run(true)}>
            Re-check
          </button>
        )}
      </header>
      {phase.kind === "idle" && <p className="text-neutral-500">Loading…</p>}
      {phase.kind === "unsupported" && (
        <p className="text-neutral-500">Open a Taobao, Tmall, Temu or Amazon product page to check whether the listing matches reality.</p>
      )}
      {phase.kind === "extracting" && <p className="text-neutral-500">Reading this listing…</p>}
      {phase.kind === "error" && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p>{phase.message}</p>
          <button className="mt-2 underline" onClick={() => run()}>
            Try again
          </button>
        </div>
      )}
      {phase.kind === "report" && <Report reportId={phase.reportId} cached={phase.cached} />}
    </main>
  );
}

function Report({ reportId, cached }: { reportId: Id<"reports">; cached: boolean }) {
  const report = useQuery(api.reports.get, { reportId });
  if (report === undefined) return <p className="text-neutral-500">Connecting…</p>;
  if (report === null) return <p className="text-red-700">Report not found.</p>;

  const checks = report.checks as Record<CheckName, CheckResult>;
  return (
    <div className="space-y-4">
      <VerdictCard verdict={report.verdict as Verdict | undefined} running={report.status === "running"} />
      {cached && <p className="text-xs text-neutral-500">Showing a report from {new Date(report.createdAt).toLocaleString()}.</p>}
      <PhotoCompare listing={report.listing as ListingInput} />
      <section className="space-y-2">
        {CHECK_NAMES.filter((n) => n !== "verdict").map((name) => (
          <CheckCard key={name} check={checks[name]} />
        ))}
        {checks.verdict.status === "error" && <CheckCard check={checks.verdict} />}
      </section>
    </div>
  );
}

const LABEL_STYLE: Record<Verdict["label"], string> = {
  "looks legit": "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200",
  "some concerns": "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  "likely misleading": "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  "not enough data": "bg-neutral-100 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200",
};

function VerdictCard({ verdict, running }: { verdict?: Verdict; running: boolean }) {
  if (!verdict) {
    return (
      <div className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
        <p className="text-neutral-500">{running ? "Checking the listing…" : "No verdict could be produced."}</p>
      </div>
    );
  }
  return (
    <div className={`space-y-3 rounded-xl p-4 ${LABEL_STYLE[verdict.label]}`}>
      <div className="flex items-baseline gap-3">
        <span className="text-4xl font-bold tabular-nums">{verdict.score}</span>
        <div>
          <p className="font-semibold capitalize">{verdict.label}</p>
          <p className="text-xs opacity-80">{verdict.confidence} confidence</p>
        </div>
      </div>
      <ul className="list-disc space-y-1 pl-5">
        {verdict.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {verdict.caveats.length > 0 && (
        <div className="text-xs opacity-80">
          <p className="font-medium">What we couldn't check</p>
          <ul className="list-disc pl-5">
            {verdict.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PhotoCompare({ listing }: { listing: ListingInput }) {
  if (listing.buyerImages.length === 0) return null;
  const row = (label: string, urls: string[]) => (
    <div>
      <p className="mb-1 text-xs font-medium text-neutral-500">{label}</p>
      <div className="grid grid-cols-3 gap-1">
        {urls.slice(0, 3).map((u) => (
          <img key={u} src={u} alt={label} className="aspect-square w-full rounded object-cover" />
        ))}
      </div>
    </div>
  );
  return (
    <section className="space-y-2">
      {row("Seller photos", listing.sellerImages)}
      {row("Buyer photos", listing.buyerImages)}
    </section>
  );
}

const CHECK_TITLES: Record<CheckName, string> = {
  comparison: "Find the real product",
  images: "Photo comparison",
  reviews: "Review patterns",
  price: "Price check",
  verdict: "Verdict",
};

function CheckCard({ check }: { check: CheckResult }) {
  const icon = { pending: "○", running: "◌", done: "●", error: "✕", skipped: "–" }[check.status];
  return (
    <div className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="flex items-center justify-between">
        <p className="font-medium">
          <span className={check.status === "running" ? "inline-block animate-spin" : ""}>{icon}</span>{" "}
          {CHECK_TITLES[check.name]}
        </p>
        {check.score !== undefined && check.name !== "comparison" && (
          <span className="tabular-nums text-neutral-500">{check.score}</span>
        )}
      </div>
      {check.summary && <p className="mt-1 text-neutral-700 dark:text-neutral-300">{check.summary}</p>}
      {check.error && <p className="mt-1 text-red-700 dark:text-red-300">{check.error}</p>}
      {check.evidence && check.evidence.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs">
          {check.evidence.slice(0, 4).map((e, i) => (
            <li key={i} className="flex items-center gap-2">
              {e.imageUrl && <img src={e.imageUrl} alt="" className="h-8 w-8 rounded object-cover" />}
              {e.sourceUrl ? (
                <a href={e.sourceUrl} target="_blank" rel="noreferrer" className="truncate underline">
                  {e.label}
                </a>
              ) : (
                <span className="truncate">{e.label}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
