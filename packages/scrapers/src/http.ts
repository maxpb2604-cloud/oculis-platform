/**
 * Small resilient HTTP helper for government sources.
 * Adds a browser-like UA (some gov WAFs reject default agents), timeouts,
 * and retry-with-backoff on transient failures. JSON, text, and bytes share the
 * same retry core so every source gets the same resilience.
 */
export const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

/** Merge the shared browser UA with per-source headers (Referer, X-Requested-With…). */
export function browserHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "User-Agent": DEFAULT_UA, ...extra };
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

function retryable(err: unknown): boolean {
  // HttpError carries a status; 5xx/429 are transient. Network/abort errors retry too.
  if (err instanceof HttpError) return err.status >= 500 || err.status === 429;
  return true;
}

/** Core fetch-with-retry; returns the raw Response (already status-checked). */
async function fetchResilient(
  url: string,
  accept: string,
  opts: FetchOptions,
): Promise<Response> {
  const { timeoutMs = 30_000, retries = 3, headers = {} } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: browserHeaders({ Accept: accept, ...headers }),
      });
      if (!res.ok) throw new HttpError(res.status, url, await safeText(res));
      return res;
    } catch (err) {
      lastErr = err;
      if (!retryable(err)) throw err;
      if (attempt < retries) {
        await sleep(250 * 2 ** attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await fetchResilient(url, "application/json, text/plain, */*", opts);
  return (await res.json()) as T;
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await fetchResilient(url, "text/html,application/xhtml+xml,*/*", opts);
  return res.text();
}

export interface FetchBytesResult {
  bytes: Uint8Array;
  contentType: string;
}

export async function fetchBytes(url: string, opts: FetchOptions = {}): Promise<FetchBytesResult> {
  const res = await fetchResilient(url, "application/pdf,*/*", { timeoutMs: 45_000, ...opts });
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "",
  };
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
    this.name = "HttpError";
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
