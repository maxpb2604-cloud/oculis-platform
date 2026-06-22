/**
 * Small resilient HTTP-JSON helper for government sources.
 * Adds a browser-like UA (some gov WAFs reject default agents), timeouts,
 * and retry-with-backoff on transient failures.
 */
const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export interface FetchJsonOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

export async function fetchJson<T>(
  url: string,
  opts: FetchJsonOptions = {},
): Promise<T> {
  const { timeoutMs = 30_000, retries = 3, headers = {} } = opts;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          "User-Agent": DEFAULT_UA,
          Accept: "application/json, text/plain, */*",
          ...headers,
        },
      });
      if (!res.ok) {
        // 4xx are not retryable (bad request contract); 5xx/429 are.
        if (res.status < 500 && res.status !== 429) {
          throw new HttpError(res.status, url, await safeText(res));
        }
        throw new HttpError(res.status, url, await safeText(res));
      }
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) {
        throw err; // non-retryable
      }
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
