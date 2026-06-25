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
  /** HTTP method (defaults to GET). Used by JSON APIs that require POST (e.g. GraphQL). */
  method?: string;
  /** Request body for non-GET methods. */
  body?: string;
}

function retryable(err: unknown): boolean {
  // HttpError carries a status; 5xx/429 are transient. Network/abort errors retry too.
  if (err instanceof HttpError) return err.status >= 500 || err.status === 429;
  return true;
}

/** An AbortError here means our own AbortController fired → the request hit `timeoutMs`. */
function isTimeout(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/** One-line classification of a failed attempt for the diagnostics suffix. */
function describeError(err: unknown): string {
  if (err instanceof HttpError) return `HTTP ${err.status}`;
  if (isTimeout(err)) return "timeout";
  return `network (${(err as Error)?.message ?? "error"})`;
}

/** Core fetch-with-retry; returns the raw Response (already status-checked). */
async function fetchResilient(
  url: string,
  accept: string,
  opts: FetchOptions,
): Promise<Response> {
  const { timeoutMs = 30_000, retries = 3, headers = {}, method, body } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        method,
        body,
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
  // Out of retries: distinguish a timeout (our AbortController fired at `timeoutMs`) from a
  // 5xx/network failure so callers' health/gap messages name the real failure mode. The
  // original error is preserved as `cause` for stack-level debugging.
  if (isTimeout(lastErr)) {
    throw new Error(`timeout after ${timeoutMs}ms over ${retries + 1} attempt(s) for ${url}`, {
      cause: lastErr,
    });
  }
  if (!(lastErr instanceof HttpError)) {
    throw new Error(`${describeError(lastErr)} over ${retries + 1} attempt(s) for ${url}`, {
      cause: lastErr,
    });
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

/** Larger slice of the failing response retained on the error for debugging. */
const DEBUG_BODY_CHARS = 2_000;

export class HttpError extends Error {
  /** A longer slice of the response body than the message exposes, for diagnostics. */
  public readonly bodySnippet: string;
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    // Keep the message compact (200 chars) but retain a larger slice for debugging.
    super(`HTTP ${status} for ${url}: ${body.slice(0, 200)}`);
    this.name = "HttpError";
    this.bodySnippet = body.slice(0, DEBUG_BODY_CHARS);
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
