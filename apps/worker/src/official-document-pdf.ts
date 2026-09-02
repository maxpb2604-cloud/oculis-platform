/**
 * Exact-byte validation and full-text extraction for official PDFs.
 *
 * The module authenticates the source and every redirect, validates both MIME
 * type and PDF magic bytes, hashes the complete response, and extracts every
 * page without truncation. It never invokes a model.
 */
import { createHash } from "node:crypto";
import { DIPUTADOS_OFFICIAL_DOCUMENT_DOMAINS } from "@oculis/core";
import { extractText, getDocumentProxy } from "unpdf";

export const PDF_FETCH_TIMEOUT_MS = 45_000;
export const PDF_PREFIX_FETCH_TIMEOUT_MS = 15_000;
export const PDF_PARSE_TIMEOUT_MS = 45_000;
export const MIN_PDF_BYTES = 5;
/**
 * Independent reachability downloads may be much larger than the former 20 MB text-
 * extraction ceiling. Verification is serial and bounded at 256 MB to protect worker
 * memory while allowing the official large/scanned corpus to remain clickable.
 */
export const MAX_REACHABILITY_PDF_BYTES = 256_000_000;
export const PDF_REACHABILITY_PREFIX_BYTES = 16_384;
/** @deprecated Use MAX_REACHABILITY_PDF_BYTES. Kept for existing callers/tests. */
export const MAX_PDF_BYTES = MAX_REACHABILITY_PDF_BYTES;
export const MIN_DOCUMENT_CHARACTERS = 80;
export const MAX_DOCUMENT_CHARACTERS = 250_000;
export const MAX_PDF_PAGES = 400;
export const MAX_PDF_REDIRECTS = 5;

const OFFICIAL_DOCUMENT_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  "sil-diputados": DIPUTADOS_OFFICIAL_DOCUMENT_DOMAINS,
  "dip-known-agenda": ["camaradediputados.gob.do"],
  "sen-approved": ["senadord.gob.do"],
  "sen-expired": ["senadord.gob.do"],
  "sen-votes": ["senadord.gob.do"],
  "sen-attendance": ["senadord.gob.do"],
  "sen-reports": ["senadord.gob.do"],
};

export class OfficialDocumentPdfError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "OfficialDocumentPdfError";
  }
}

export function officialDocumentDomains(source: string): readonly string[] {
  const domains = OFFICIAL_DOCUMENT_DOMAINS[source];
  if (!domains) {
    throw new OfficialDocumentPdfError(
      "UNAPPROVED_DOCUMENT_SOURCE",
      `La fuente ${source} no está autorizada para la verificación de documentos oficiales.`,
    );
  }
  return domains;
}

export function isRetryableOfficialDocumentPdfError(
  error: unknown,
): error is OfficialDocumentPdfError {
  return error instanceof OfficialDocumentPdfError && error.retryable;
}

export interface ExtractedPdfText {
  text: string;
  pages: number;
}

export type PdfTextExtractor = (bytes: Uint8Array) => Promise<ExtractedPdfText>;

export interface PreparedOfficialPdf {
  contentHash: string;
  contentText: string;
  mimeType: "application/pdf";
  byteSize: number;
  pageCount: number;
  characterCount: number;
}

/** Authenticated binary facts; extraction is deliberately a separate concern. */
export interface VerifiedOfficialPdfBinary {
  bytes: Uint8Array;
  /** SHA-256 only when the complete file was deliberately downloaded. */
  contentHash: string | null;
  mimeType: "application/pdf" | "application/octet-stream";
  /** Total size observed from a complete body, Content-Length, or Content-Range. */
  byteSize: number | null;
  completeBody: boolean;
  httpStatus: 200 | 206;
  finalUrl: string;
}

async function extractPdfText(bytes: Uint8Array): Promise<ExtractedPdfText> {
  // PDF.js may transfer/detach the supplied buffer. Give it an owned copy and always
  // destroy the proxy so sequential batches do not retain fonts/pages in memory.
  const pdf = await getDocumentProxy(bytes.slice());
  try {
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return {
      text: Array.isArray(text) ? text.join("\n") : text,
      pages: totalPages,
    };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

function normalizeMimeType(contentType: string | null): string {
  return (contentType ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

function isPdfResponseMimeType(
  value: string,
): value is "application/pdf" | "application/octet-stream" {
  // Some historical files on the authenticated Cámara host use the generic binary
  // MIME. Host validation plus `%PDF-` below remains mandatory, so this does not
  // permit a foreign or non-PDF response to enter the evidence store.
  return value === "application/pdf" || value === "application/octet-stream";
}

function assertOfficialHttpsUrl(
  value: string,
  allowedDomains: readonly string[],
  label: "inicial" | "final",
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OfficialDocumentPdfError("INVALID_URL", "La URL del documento no es válida.");
  }
  if (url.protocol !== "https:") {
    throw new OfficialDocumentPdfError(
      "INVALID_URL_PROTOCOL",
      `La URL ${label} del documento debe usar HTTPS sin downgrade.`,
    );
  }
  if (url.username || url.password) {
    throw new OfficialDocumentPdfError(
      "INVALID_URL_CREDENTIALS",
      `La URL ${label} del documento no puede incluir credenciales.`,
    );
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const official = allowedDomains.some((domain) => {
    const normalized = domain.toLowerCase().replace(/\.$/, "");
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
  if (!official) {
    throw new OfficialDocumentPdfError(
      "UNOFFICIAL_DOCUMENT_HOST",
      `El host ${label} ${hostname} no pertenece a la fuente oficial autorizada.`,
    );
  }
  return url;
}

/**
 * Download and authenticate one official PDF by HTTPS host, HTTP status, MIME and
 * `%PDF-` magic. This binary result alone drives public availability; it never parses
 * pages or requires extractable text.
 */
export async function verifyOfficialPdfBinary(
  urlValue: string,
  opts: {
    allowedDomains: readonly string[];
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    maxBytes?: number;
    /** Prefix is the fast availability path; complete is reserved for extraction. */
    readMode?: "prefix" | "complete";
    prefixBytes?: number;
  },
): Promise<VerifiedOfficialPdfBinary> {
  if (!opts.allowedDomains?.length) {
    throw new OfficialDocumentPdfError(
      "MISSING_OFFICIAL_DOMAINS",
      "El documento no tiene un dominio oficial autorizado.",
    );
  }
  const url = assertOfficialHttpsUrl(urlValue, opts.allowedDomains, "inicial");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxBytes = opts.maxBytes ?? MAX_REACHABILITY_PDF_BYTES;
  const readMode = opts.readMode ?? "prefix";
  const prefixBytes = opts.prefixBytes ?? PDF_REACHABILITY_PREFIX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < MIN_PDF_BYTES) {
    throw new OfficialDocumentPdfError(
      "INVALID_PDF_BYTE_LIMIT",
      "El límite binario del PDF debe ser un entero positivo suficiente para su firma.",
    );
  }
  if (!Number.isSafeInteger(prefixBytes) || prefixBytes < MIN_PDF_BYTES) {
    throw new OfficialDocumentPdfError(
      "INVALID_PDF_PREFIX_LIMIT",
      "El prefijo binario del PDF debe permitir validar su firma.",
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? (readMode === "prefix" ? PDF_PREFIX_FETCH_TIMEOUT_MS : PDF_FETCH_TIMEOUT_MS),
  );
  let response: Response | undefined;
  let requestUrl = url;
  try {
    for (let redirects = 0; ; redirects++) {
      response = await fetchImpl(requestUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "application/pdf",
          ...(readMode === "prefix" ? { range: `bytes=0-${prefixBytes - 1}` } : {}),
        },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      if (redirects >= MAX_PDF_REDIRECTS) {
        throw new OfficialDocumentPdfError(
          "TOO_MANY_PDF_REDIRECTS",
          `El PDF excedió el límite de ${MAX_PDF_REDIRECTS} redirects oficiales.`,
        );
      }
      const location = response.headers.get("location");
      if (!location) {
        throw new OfficialDocumentPdfError(
          "INVALID_PDF_REDIRECT",
          "El servidor respondió con un redirect sin Location.",
        );
      }
      let redirected: URL;
      try {
        redirected = new URL(location, requestUrl);
      } catch {
        throw new OfficialDocumentPdfError(
          "INVALID_PDF_REDIRECT",
          "El servidor respondió con un Location inválido.",
        );
      }
      requestUrl = assertOfficialHttpsUrl(redirected.href, opts.allowedDomains, "final");
    }
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof OfficialDocumentPdfError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new OfficialDocumentPdfError(
      "PDF_FETCH_FAILED",
      `No se pudo descargar el PDF: ${message}`,
      true,
    );
  }
  let bytes: Uint8Array;
  let completeBody = false;
  let verifiedMimeType: "application/pdf" | "application/octet-stream" | undefined;
  let verifiedHttpStatus: 200 | 206 | undefined;
  let verifiedFinalUrl: string | undefined;
  try {
    if (!response) {
      throw new OfficialDocumentPdfError("PDF_FETCH_FAILED", "No se recibió respuesta del PDF.");
    }
    if (response.status !== 200 && response.status !== 206) {
      throw new OfficialDocumentPdfError(
        "PDF_HTTP_ERROR",
        `El documento oficial respondió HTTP ${response.status}.`,
        response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500,
      );
    }

    // Native fetch exposes the final URL after redirects. Test doubles may leave it
    // empty; in that case the already-validated request URL remains authoritative.
    const finalUrl = response.url || requestUrl.href;
    assertOfficialHttpsUrl(finalUrl, opts.allowedDomains, "final");

    const observedMimeType = normalizeMimeType(response.headers.get("content-type"));
    if (!isPdfResponseMimeType(observedMimeType)) {
      throw new OfficialDocumentPdfError(
        "INVALID_PDF_MIME",
        `El documento no declaró un MIME PDF/binario permitido (recibido: ${observedMimeType || "sin MIME"}).`,
      );
    }
    verifiedMimeType = observedMimeType;
    verifiedHttpStatus = response.status;
    verifiedFinalUrl = finalUrl;
    const declaredLength = Number(response.headers.get("content-length"));
    if (readMode === "complete" && Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new OfficialDocumentPdfError(
        "PDF_TOO_LARGE",
        `El PDF excede el límite binario seguro de ${maxBytes} bytes.`,
      );
    }

    if (readMode === "complete") {
      bytes = await readPdfResponseBytes(response, controller, maxBytes);
      completeBody = true;
    } else {
      const prefix = await readPdfResponsePrefix(response, prefixBytes);
      bytes = prefix.bytes;
      completeBody = response.status === 200 && prefix.completeResponse;
    }
    if (bytes.byteLength < MIN_PDF_BYTES) {
      throw new OfficialDocumentPdfError(
        "PDF_TOO_SMALL",
        "El archivo PDF está vacío o incompleto.",
      );
    }
    const magic = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
    if (magic !== "%PDF-") {
      throw new OfficialDocumentPdfError(
        "INVALID_PDF_MAGIC",
        "El archivo no comienza con los magic bytes %PDF-.",
      );
    }
  } catch (error) {
    if (error instanceof OfficialDocumentPdfError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new OfficialDocumentPdfError(
      "PDF_FETCH_FAILED",
      `No se pudo descargar el PDF: ${message}`,
      true,
    );
  } finally {
    clearTimeout(timeout);
  }

  // Capture immutable byte facts before invoking any extractor. PDF.js is allowed to
  // transfer its input ArrayBuffer, which would otherwise turn a real PDF into the
  // empty SHA-256 digest after successful extraction.
  const observedSize = observedPdfByteSize(response, completeBody ? bytes.byteLength : null);
  const contentHash = completeBody ? createHash("sha256").update(bytes).digest("hex") : null;
  if (!verifiedMimeType || !verifiedHttpStatus || !verifiedFinalUrl) {
    throw new OfficialDocumentPdfError(
      "PDF_FETCH_FAILED",
      "La verificación binaria no produjo metadatos completos.",
    );
  }

  return {
    bytes,
    contentHash,
    mimeType: verifiedMimeType,
    byteSize: observedSize,
    completeBody,
    httpStatus: verifiedHttpStatus,
    finalUrl: verifiedFinalUrl,
  };
}

/** Retry only operational failures; factual invalid-PDF evidence is never retried here. */
export async function verifyOfficialPdfBinaryWithRetry(
  urlValue: string,
  opts: Parameters<typeof verifyOfficialPdfBinary>[1] & {
    maxAttempts?: number;
    retryBaseDelayMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
    random?: () => number;
  },
): Promise<VerifiedOfficialPdfBinary> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const retryBaseDelayMs = opts.retryBaseDelayMs ?? 250;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
    throw new OfficialDocumentPdfError(
      "INVALID_PDF_RETRY_COUNT",
      "Los intentos de PDF deben ser un entero entre 1 y 5.",
    );
  }
  if (!Number.isSafeInteger(retryBaseDelayMs) || retryBaseDelayMs < 0) {
    throw new OfficialDocumentPdfError(
      "INVALID_PDF_RETRY_DELAY",
      "La espera base de PDF debe ser un entero no negativo.",
    );
  }
  const sleep =
    opts.sleep ?? ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const random = opts.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      return await verifyOfficialPdfBinary(urlValue, opts);
    } catch (error) {
      if (!isRetryableOfficialDocumentPdfError(error) || attempt >= maxAttempts) throw error;
      const exponential = retryBaseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.max(0, Math.min(1, random())) * retryBaseDelayMs);
      await sleep(exponential + jitter);
    }
  }
}

/** Extract full text from already-authenticated bytes without changing reachability. */
export async function extractOfficialPdfContent(
  binary: VerifiedOfficialPdfBinary,
  opts: { extractor?: PdfTextExtractor; parseTimeoutMs?: number } = {},
): Promise<PreparedOfficialPdf> {
  const extractor = opts.extractor ?? extractPdfText;
  if (!binary.completeBody || !binary.contentHash || binary.byteSize === null) {
    throw new OfficialDocumentPdfError(
      "PDF_COMPLETE_BODY_REQUIRED",
      "La extracción requiere descargar el PDF completo; el prefijo solo prueba disponibilidad.",
    );
  }

  let extracted: ExtractedPdfText;
  try {
    const parseTimeoutMs = opts.parseTimeoutMs ?? PDF_PARSE_TIMEOUT_MS;
    if (!Number.isSafeInteger(parseTimeoutMs) || parseTimeoutMs < 1) {
      throw new OfficialDocumentPdfError(
        "INVALID_PDF_PARSE_TIMEOUT",
        "El timeout de extracción del PDF debe ser un entero positivo.",
      );
    }
    let parseTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      extracted = await Promise.race([
        extractor(binary.bytes),
        new Promise<never>((_resolve, reject) => {
          parseTimer = setTimeout(
            () =>
              reject(
                new OfficialDocumentPdfError(
                  "PDF_PARSE_TIMEOUT",
                  `La extracción del PDF excedió ${parseTimeoutMs}ms.`,
                ),
              ),
            parseTimeoutMs,
          );
        }),
      ]);
    } finally {
      if (parseTimer) clearTimeout(parseTimer);
    }
  } catch (error) {
    if (error instanceof OfficialDocumentPdfError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new OfficialDocumentPdfError("PDF_PARSE_FAILED", `No se pudo leer el PDF: ${message}`);
  }
  if (!Number.isSafeInteger(extracted.pages) || extracted.pages < 1) {
    throw new OfficialDocumentPdfError("INVALID_PAGE_COUNT", "El PDF no produjo páginas válidas.");
  }
  if (extracted.pages > MAX_PDF_PAGES) {
    throw new OfficialDocumentPdfError(
      "PDF_TOO_MANY_PAGES",
      `El PDF excede el límite visible de ${MAX_PDF_PAGES} páginas.`,
    );
  }
  const contentText = extracted.text.replace(/\r\n?/g, "\n").trim();
  if (contentText.length < MIN_DOCUMENT_CHARACTERS) {
    throw new OfficialDocumentPdfError(
      "EMPTY_DOCUMENT_TEXT",
      `El texto extraído tiene menos de ${MIN_DOCUMENT_CHARACTERS} caracteres.`,
    );
  }
  if (contentText.length > MAX_DOCUMENT_CHARACTERS) {
    throw new OfficialDocumentPdfError(
      "DOCUMENT_TEXT_TOO_LARGE",
      `El texto excede el límite visible de ${MAX_DOCUMENT_CHARACTERS} caracteres; no se truncó.`,
    );
  }

  return {
    contentHash: binary.contentHash,
    contentText,
    mimeType: "application/pdf",
    byteSize: binary.byteSize,
    pageCount: extracted.pages,
    characterCount: contentText.length,
  };
}

/**
 * Backward-compatible combined helper. Production availability uses
 * `verifyOfficialPdfBinary` first and treats this extraction phase as optional.
 */
export async function prepareOfficialPdf(
  urlValue: string,
  opts: {
    allowedDomains: readonly string[];
    fetchImpl?: typeof fetch;
    extractor?: PdfTextExtractor;
    timeoutMs?: number;
    parseTimeoutMs?: number;
    maxBytes?: number;
  },
): Promise<PreparedOfficialPdf> {
  const binary = await verifyOfficialPdfBinary(urlValue, { ...opts, readMode: "complete" });
  return extractOfficialPdfContent(binary, opts);
}

function observedPdfByteSize(response: Response, completeSize: number | null): number | null {
  const contentRange = response.headers.get("content-range");
  const rangeMatch = contentRange?.match(/\/(\d+)$/);
  const rangeTotal = rangeMatch ? Number(rangeMatch[1]) : Number.NaN;
  const declaredLength = Number(response.headers.get("content-length"));
  const candidate =
    Number.isSafeInteger(rangeTotal) && rangeTotal > 0
      ? rangeTotal
      : response.status === 200 && Number.isSafeInteger(declaredLength) && declaredLength > 0
        ? declaredLength
        : completeSize;
  // Postgres integer is signed 32-bit. A larger official file remains reachable; its
  // exact size is simply not persisted in this optional field.
  return candidate !== null && Number.isSafeInteger(candidate) && candidate <= 2_147_483_647
    ? candidate
    : null;
}

async function readPdfResponsePrefix(
  response: Response,
  prefixBytes: number,
): Promise<{ bytes: Uint8Array; completeResponse: boolean }> {
  if (!response.body) {
    throw new OfficialDocumentPdfError(
      "PDF_EMPTY_BODY",
      "El documento oficial no devolvió cuerpo.",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let completeResponse = false;
  try {
    while (size < prefixBytes) {
      const { done, value } = await reader.read();
      if (done) {
        completeResponse = true;
        break;
      }
      if (!value?.byteLength) continue;
      const remaining = prefixBytes - size;
      const retained = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      chunks.push(retained);
      size += retained.byteLength;
      if (value.byteLength > remaining || size >= prefixBytes) {
        await reader.cancel("PDF reachability prefix complete").catch(() => {});
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes, completeResponse };
}

async function readPdfResponseBytes(
  response: Response,
  controller: AbortController,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    throw new OfficialDocumentPdfError(
      "PDF_EMPTY_BODY",
      "El documento oficial no devolvió cuerpo.",
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        controller.abort();
        await reader.cancel("PDF byte limit exceeded").catch(() => {});
        throw new OfficialDocumentPdfError(
          "PDF_TOO_LARGE",
          `El PDF excede el límite binario seguro de ${maxBytes} bytes.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
