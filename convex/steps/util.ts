"use node";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set on the Convex deployment`);
  return value;
}

export async function fetchWithTimeout(url: string, ms = 10_000, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${res.status}`);
  return res;
}

export async function fetchImage(url: string, ms = 10_000): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetchWithTimeout(normalizeImageUrl(url), ms, {
    headers: { "User-Agent": "Mozilla/5.0 LarpAI" },
  });
  const mimeType = res.headers.get("content-type")?.split(";")[0] ?? "image/jpeg";
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType };
}

// Taobao serves protocol-relative URLs and thumbnail suffixes like _60x60.jpg.
export function normalizeImageUrl(url: string): string {
  let out = url.startsWith("//") ? `https:${url}` : url;
  out = out.replace(/_(\d+x\d+)(q\d+)?\.jpg(_\.webp)?$/i, "");
  return out;
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
