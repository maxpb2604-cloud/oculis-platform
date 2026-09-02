import { DIPUTADOS_OFFICIAL_DOCUMENT_DOMAINS, officialDepositedBillPdfUrl } from "@oculis/core";

const MAX_REDIRECTS = 4;
const MAX_PROBE_BYTES = 16 * 1024;
// Historical SIL PDFs can take roughly 20 seconds to deliver their first byte.
// Keep the explicit-click probe bounded, but do not reject a real official PDF merely
// because it lives on the slower historical file service.
const DEFAULT_TIMEOUT_MS = 30_000;
const CACHE_MAX = 256;
const SUCCESS_TTL_MS = 5 * 60_000;
const FAILURE_TTL_MS = 60_000;
const TRANSIENT_FAILURE_TTL_MS = 15_000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 30;
const MAX_CONCURRENT_PROBES = 4;
const SOURCE_PENDING_BODY = "Este archivo no existe.";
const ERROR_PAGE_STYLE =
  ':root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#07110f;color:#edf5f1;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(680px,100%);padding:32px;border:1px solid #29423b;border-radius:18px;background:#0d1a17;box-shadow:0 18px 70px rgba(0,0,0,.28)}.brand{margin:0 0 28px;color:#75c8ff;font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.eyebrow{margin:0 0 8px;color:#91a69f;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}h1{margin:0;font-family:Georgia,serif;font-size:clamp(28px,5vw,42px);line-height:1.08}p{color:#c2d0cb;font-size:16px;line-height:1.6}.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px}a{display:inline-flex;min-height:42px;align-items:center;padding:10px 14px;border:1px solid #38564d;border-radius:9px;color:#dceae5;font-weight:650;text-decoration:none}a.primary{border-color:#4aa9e8;background:#123b55;color:#eaf7ff}a:hover,a:focus-visible{border-color:#75c8ff;outline:none}.note{margin:24px 0 0;color:#91a69f;font-size:13px}';
// SHA-256 of ERROR_PAGE_STYLE. Keeping style inline but hash-pinned preserves a
// self-contained failure page without allowing arbitrary inline styles or scripts.
const ERROR_PAGE_STYLE_HASH = "sha256-Mi3bnDKLZiTcS322lbsfUIWCEMyvZYGqJjjOqC3gT1s=";

const PDF_MIME_TYPES = new Set([
  "application/pdf",
  "application/x-pdf",
  "application/acrobat",
  "applications/vnd.pdf",
  // The historical SIL file service returns this generic MIME for a small set of
  // genuine PDFs. It is accepted only after the official-host checks above and the
  // independent `%PDF-` magic-byte check below.
  "application/octet-stream",
]);

type ProbeResult =
  | { ok: true; finalUrl: string }
  | {
      ok: false;
      kind: "invalid_pdf" | "source_pending" | "upstream" | "timeout";
      detail: string;
    };

interface CacheEntry {
  result: ProbeResult;
  expiresAt: number;
}

export interface OfficialDocumentOpenRecord {
  id: number;
  initiativeId: number;
  initiativeSourceId: string | null;
  initiativeCode: string | null;
  initiativeTitle: string | null;
  source: string;
  sourceDocId: string | null;
  docType: string | null;
  url: string;
  uploadedAt: string | null;
  modifiedAt: string | null;
  /** Persisted verification of the exact current metadata snapshot. */
  pdfAvailable: boolean;
}

export interface OfficialDocumentOpenHandlerOptions {
  lookupDocument: (
    documentId: number,
    initiativeId: number,
  ) => Promise<OfficialDocumentOpenRecord | null>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
  rateMax?: number;
  maxConcurrent?: number;
}

/**
 * Stateful factory kept exportable so the safety boundary can be tested without a
 * real network. Production creates one module-scoped handler below.
 */
export function createOfficialDocumentOpenHandler(
  options: OfficialDocumentOpenHandlerOptions,
): (request: Request) => Promise<Response> {
  const lookupDocument = options.lookupDocument;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const rateMax = options.rateMax ?? RATE_MAX;
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_PROBES;
  const cache = new Map<string, CacheEntry>();
  const inFlight = new Map<string, Promise<ProbeResult>>();
  let activeProbes = 0;
  let rate = { startedAt: 0, count: 0 };

  return async (request: Request): Promise<Response> => {
    const requestUrl = new URL(request.url);
    const lang = requestUrl.searchParams.get("lang") === "en" ? "en" : "es";
    const documentIds = requestUrl.searchParams.getAll("documentId");
    const initiativeIds = requestUrl.searchParams.getAll("initiativeId");
    const langs = requestUrl.searchParams.getAll("lang");
    const hasUnexpectedQuery = [...requestUrl.searchParams.keys()].some(
      (key) => key !== "documentId" && key !== "initiativeId" && key !== "lang",
    );
    const documentIdText = documentIds[0];
    const initiativeIdText = initiativeIds[0];
    if (
      hasUnexpectedQuery ||
      documentIds.length !== 1 ||
      initiativeIds.length !== 1 ||
      langs.length > 1 ||
      !documentIdText ||
      !initiativeIdText ||
      !/^\d{1,12}$/.test(documentIdText) ||
      !/^\d{1,12}$/.test(initiativeIdText)
    ) {
      return errorResponse(lang, "bad_request", 400);
    }
    const documentId = Number(documentIdText);
    const initiativeId = Number(initiativeIdText);
    if (
      !Number.isSafeInteger(documentId) ||
      documentId <= 0 ||
      !Number.isSafeInteger(initiativeId) ||
      initiativeId <= 0
    ) {
      return errorResponse(lang, "bad_request", 400);
    }

    let document: OfficialDocumentOpenRecord | null;
    try {
      document = await lookupDocument(documentId, initiativeId);
    } catch {
      return errorResponse(lang, "repository", 503);
    }
    const officialUrl =
      document?.id === documentId && document.initiativeId === initiativeId
        ? officialDepositedBillPdfUrl(document)
        : null;
    if (!document || !officialUrl) {
      return errorResponse(lang, "unavailable", 404);
    }
    const cacheKey = documentSnapshotKey(document);

    pruneCache(cache, now());
    const cached = cache.get(cacheKey);
    if (cached) return resultResponse(cached.result, lang, document);

    let pending = inFlight.get(cacheKey);
    if (!pending) {
      const retryAfter = checkRateLimit(now(), rate, rateMax);
      if (retryAfter != null) {
        return errorResponse(lang, "rate_limited", 429, retryAfter);
      }
      if (activeProbes >= maxConcurrent) {
        return errorResponse(lang, "busy", 429, 1);
      }
      rate = advanceRate(now(), rate);
      activeProbes += 1;
      pending = probeOfficialPdf(officialUrl, fetchImpl, timeoutMs).finally(() => {
        activeProbes -= 1;
        inFlight.delete(cacheKey);
      });
      inFlight.set(cacheKey, pending);
    }

    const result = await pending;
    if (result.ok) {
      let current: OfficialDocumentOpenRecord | null;
      try {
        current = await lookupDocument(documentId, initiativeId);
      } catch {
        return errorResponse(lang, "repository", 503);
      }
      const currentOfficialUrl =
        current?.id === documentId && current.initiativeId === initiativeId
          ? officialDepositedBillPdfUrl(current)
          : null;
      if (
        !current ||
        currentOfficialUrl !== officialUrl ||
        documentSnapshotKey(current) !== cacheKey
      ) {
        return errorResponse(lang, "unavailable", 409);
      }
    }
    const ttl = result.ok
      ? SUCCESS_TTL_MS
      : result.kind === "timeout" || result.kind === "upstream" || result.kind === "source_pending"
        ? TRANSIENT_FAILURE_TTL_MS
        : FAILURE_TTL_MS;
    cache.set(cacheKey, { result, expiresAt: now() + ttl });
    trimCache(cache);
    return resultResponse(result, lang, document);
  };
}

async function probeOfficialPdf(
  initialUrl: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let currentUrl = initialUrl;

  try {
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "application/pdf",
            range: `bytes=0-${MAX_PROBE_BYTES - 1}`,
            "user-agent": "Oculis-Official-Document-Guard/1.0",
          },
        });
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) {
          return { ok: false, kind: "timeout", detail: "probe_timeout" };
        }
        return { ok: false, kind: "upstream", detail: "fetch_failed" };
      }

      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirectCount === MAX_REDIRECTS) {
          await cancelBody(response);
          return { ok: false, kind: "upstream", detail: "invalid_redirect" };
        }
        let redirected: string | null = null;
        try {
          redirected = officialDiputadosHttpsUrl(new URL(location, currentUrl).toString());
        } catch {
          // The uniform invalid-redirect result deliberately does not echo source input.
        }
        await cancelBody(response);
        if (!redirected) {
          return { ok: false, kind: "invalid_pdf", detail: "unsafe_redirect" };
        }
        currentUrl = redirected;
        continue;
      }

      if (response.status !== 200 && response.status !== 206) {
        await cancelBody(response);
        return { ok: false, kind: "upstream", detail: `upstream_${response.status}` };
      }

      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && /^\d+$/.test(declaredLength) && Number(declaredLength) === 0) {
        await cancelBody(response);
        return { ok: false, kind: "invalid_pdf", detail: "empty_body" };
      }
      const mime = (response.headers.get("content-type") ?? "")
        .split(";", 1)[0]!
        .trim()
        .toLowerCase();
      if (!PDF_MIME_TYPES.has(mime)) {
        const prefix = await readPrefix(response, MAX_PROBE_BYTES);
        if (isSourcePendingBody(prefix)) {
          return { ok: false, kind: "source_pending", detail: "source_file_missing" };
        }
        return { ok: false, kind: "invalid_pdf", detail: "invalid_mime" };
      }

      const prefix = await readPrefix(response, MAX_PROBE_BYTES);
      if (!startsWithPdfMagic(prefix)) {
        if (isSourcePendingBody(prefix)) {
          return { ok: false, kind: "source_pending", detail: "source_file_missing" };
        }
        return {
          ok: false,
          kind: "invalid_pdf",
          detail: prefix.byteLength === 0 ? "empty_body" : "invalid_magic",
        };
      }
      return { ok: true, finalUrl: currentUrl };
    }
    return { ok: false, kind: "upstream", detail: "redirect_limit" };
  } catch (error) {
    if (controller.signal.aborted || isAbortError(error)) {
      return { ok: false, kind: "timeout", detail: "probe_timeout" };
    }
    return { ok: false, kind: "upstream", detail: "body_read_failed" };
  } finally {
    clearTimeout(timeout);
  }
}

async function readPrefix(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const kept = value.subarray(0, Math.min(value.byteLength, limit - length));
      chunks.push(kept);
      length += kept.byteLength;
      if (length >= limit) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The prefix has already been read; cancellation failures are not validation data.
    }
  }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Discarding an untrusted response body is best effort.
  }
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function isSourcePendingBody(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength === SOURCE_PENDING_BODY.length &&
    new TextDecoder().decode(bytes) === SOURCE_PENDING_BODY
  );
}

function documentSnapshotKey(document: OfficialDocumentOpenRecord): string {
  return JSON.stringify([
    document.id,
    document.initiativeId,
    document.source,
    document.sourceDocId,
    document.docType,
    document.url,
    document.uploadedAt,
    document.modifiedAt,
  ]);
}

function officialDiputadosHttpsUrl(value: string): string | null {
  if (value.length > 2_048) return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const allowed = DIPUTADOS_OFFICIAL_DOCUMENT_DOMAINS.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  );
  return allowed ? url.toString() : null;
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function checkRateLimit(
  current: number,
  rate: { startedAt: number; count: number },
  max: number,
): number | null {
  if (current - rate.startedAt >= RATE_WINDOW_MS) return null;
  return rate.count >= max
    ? Math.max(1, Math.ceil((RATE_WINDOW_MS - (current - rate.startedAt)) / 1_000))
    : null;
}

function advanceRate(
  current: number,
  rate: { startedAt: number; count: number },
): { startedAt: number; count: number } {
  return current - rate.startedAt >= RATE_WINDOW_MS
    ? { startedAt: current, count: 1 }
    : { startedAt: rate.startedAt, count: rate.count + 1 };
}

function pruneCache(cache: Map<string, CacheEntry>, current: number): void {
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= current) cache.delete(key);
  }
}

function trimCache(cache: Map<string, CacheEntry>): void {
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

function resultResponse(
  result: ProbeResult,
  lang: "es" | "en",
  document: OfficialDocumentOpenRecord,
): Response {
  if (!result.ok) {
    const status = result.kind === "timeout" ? 504 : result.kind === "upstream" ? 502 : 422;
    const retryAfter =
      result.kind === "source_pending" ? Math.ceil(TRANSIENT_FAILURE_TTL_MS / 1_000) : undefined;
    return errorResponse(lang, result.kind, status, retryAfter, document);
  }
  return new Response(null, {
    status: 302,
    headers: {
      location: result.finalUrl,
      // The process cache avoids repeat probes; browsers must re-enter the id/snapshot
      // boundary so a stale tab cannot retain an old redirect after metadata changes.
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function errorResponse(
  lang: "es" | "en",
  kind:
    | "bad_request"
    | "unavailable"
    | "repository"
    | "invalid_pdf"
    | "source_pending"
    | "upstream"
    | "timeout"
    | "rate_limited"
    | "busy",
  status: number,
  retryAfter?: number,
  document?: OfficialDocumentOpenRecord,
): Response {
  const es = lang === "es";
  const detail =
    kind === "bad_request"
      ? es
        ? "La solicitud del documento oficial no es válida."
        : "The official-document request is invalid."
      : kind === "unavailable"
        ? es
          ? "El documento ya no está disponible como texto oficial depositado en los datos actuales de Oculis."
          : "The document is no longer available as an official deposited text in Oculis's current data."
        : kind === "repository"
          ? es
            ? "Oculis no pudo confirmar el registro actual del documento."
            : "Oculis could not confirm the document's current record."
          : kind === "source_pending"
            ? es
              ? "La Cámara de Diputados registra este documento, pero su servidor de archivos todavía responde «Este archivo no existe». Puede tratarse de una publicación pendiente en la fuente oficial; vuelva a intentarlo en unos segundos."
              : "The Chamber of Deputies lists this document, but its file server still responds that the file does not exist. Publication may still be pending at the official source; try again in a few seconds."
            : kind === "invalid_pdf"
              ? es
                ? "La fuente respondió con un archivo vacío, HTML o contenido que no es un PDF verificable."
                : "The source returned an empty file, HTML, or content that is not a verifiable PDF."
              : kind === "timeout"
                ? es
                  ? "La fuente oficial no respondió dentro del tiempo de seguridad."
                  : "The official source did not respond within the safety timeout."
                : kind === "rate_limited" || kind === "busy"
                  ? es
                    ? "El verificador está atendiendo demasiadas aperturas. Inténtelo de nuevo en un momento."
                    : "The verifier is handling too many opens. Please try again shortly."
                  : es
                    ? "La fuente oficial no pudo verificarse en este momento."
                    : "The official source could not be verified right now.";
  const title =
    kind === "source_pending"
      ? es
        ? "El PDF oficial todavía no está disponible"
        : "The official PDF is not available yet"
      : es
        ? "No se abrió el documento oficial"
        : "The official document was not opened";
  const headers: Record<string, string> = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; script-src 'none'; style-src '${ERROR_PAGE_STYLE_HASH}'`,
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
  if (retryAfter != null) headers["retry-after"] = String(retryAfter);
  const navigation = errorNavigation(document, lang, true);
  const eyebrow = es ? "Documento oficial" : "Official document";
  const note = es
    ? "Oculis no sustituye el PDF ni abre contenido que no puede verificar como documento oficial."
    : "Oculis does not substitute the PDF or open content it cannot verify as an official document.";
  return new Response(
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
      `<style>${ERROR_PAGE_STYLE}</style></head><body><main><p class="brand">Oculis Auribus</p>` +
      `<p class="eyebrow">${eyebrow}</p><h1>${title}</h1><p>${detail}</p>${navigation}` +
      `<p class="note">${note}</p></main></body></html>`,
    { status, headers },
  );
}

function errorNavigation(
  document: OfficialDocumentOpenRecord | undefined,
  lang: "es" | "en",
  includeRetry: boolean,
): string {
  if (!document) return "";
  const es = lang === "es";
  const query = new URLSearchParams({
    documentId: String(document.id),
    initiativeId: String(document.initiativeId),
  });
  if (lang === "en") query.set("lang", "en");
  const retryHref = htmlEscape(`/api/document/open?${query.toString()}`);
  const localHref = htmlEscape(
    `/initiatives/${document.initiativeId}${lang === "en" ? "?lang=en" : ""}`,
  );
  const officialHref = officialInitiativeUrl(document);
  const officialAction = officialHref
    ? `<a href="${htmlEscape(officialHref)}" target="_blank" rel="noopener noreferrer">${
        es ? "Ver ficha oficial" : "View official record"
      }</a>`
    : "";
  return (
    `<nav class="actions" aria-label="${es ? "Opciones" : "Options"}">` +
    (includeRetry
      ? `<a class="primary" href="${retryHref}">${es ? "Reintentar" : "Try again"}</a>`
      : "") +
    `<a href="${localHref}">${es ? "Volver a la iniciativa" : "Back to the initiative"}</a>` +
    `${officialAction}</nav>`
  );
}

function officialInitiativeUrl(document: OfficialDocumentOpenRecord): string | null {
  const sourceId = document.initiativeSourceId?.trim();
  return document.source === "sil-diputados" && sourceId && /^\d{1,12}$/.test(sourceId)
    ? `https://www.diputadosrd.gob.do/sil/iniciativa/${sourceId}`
    : null;
}

function htmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
