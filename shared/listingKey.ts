// Normalized cache key for a listing, so the same item hits the same Report.
export function normalizeListingKey(url: string, itemId?: string): string {
  let parsed: URL | undefined;
  try {
    parsed = new URL(url);
  } catch {
    // fall through to the raw string below
  }
  const host = parsed?.hostname ?? "";
  const site = /taobao\.com|tmall\.com/.test(host)
    ? "taobao"
    : /aliexpress\./.test(host)
      ? "aliexpress"
      : /temu\.com/.test(host)
        ? "temu"
        : "other";

  const id = itemId ?? parsed?.searchParams.get("id") ?? undefined;
  if (id) return `${site}:${id}`;
  if (parsed) return `${site}:${parsed.hostname}${parsed.pathname}`;
  return `${site}:${url}`;
}

export const CHECK_NAMES = ["comparison", "images", "reviews", "price", "verdict"] as const;
