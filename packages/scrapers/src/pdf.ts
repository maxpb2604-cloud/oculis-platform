/**
 * Minimal PDF → text helper, used to parse the Cámara de Diputados plenary
 * order-of-the-day PDFs and the Senate agenda PDFs. Uses `unpdf` (serverless-
 * friendly pdf.js build, no native deps) and the shared resilient fetch (retry +
 * backoff), so a transient 5xx no longer mints a permanent empty record.
 */
import { extractText, getDocumentProxy } from "unpdf";
import { fetchBytes } from "./http.js";

export interface PdfText {
  text: string;
  pages: number;
}

/** Distinguishes a genuine parse failure (WAF page, corrupt file, fetch error)
 *  from a successfully-parsed-but-empty PDF, so callers can flag it as a gap. */
export class PdfParseError extends Error {
  constructor(
    public readonly url: string,
    message: string,
  ) {
    super(`PDF parse failed for ${url}: ${message}`);
    this.name = "PdfParseError";
  }
}

function looksLikePdf(bytes: Uint8Array, contentType: string): boolean {
  // Real PDFs begin with the %PDF- magic bytes. A WAF/HTML/JSON interstitial
  // served with HTTP 200 will not — catch those instead of treating them as empty.
  const head = Buffer.from(bytes.subarray(0, 5)).toString("latin1");
  if (head === "%PDF-") return true;
  return /application\/pdf/i.test(contentType) && bytes.length > 1000;
}

/** Download a PDF and return its merged text. Throws PdfParseError on any failure. */
export async function fetchPdfText(url: string, timeoutMs = 45_000): Promise<PdfText> {
  let bytes: Uint8Array;
  let contentType: string;
  try {
    ({ bytes, contentType } = await fetchBytes(url, { timeoutMs }));
  } catch (err) {
    throw new PdfParseError(url, (err as Error).message);
  }
  if (!looksLikePdf(bytes, contentType)) {
    throw new PdfParseError(url, `not a PDF (content-type=${contentType}, ${bytes.length} bytes)`);
  }
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    return { text: Array.isArray(text) ? text.join("\n") : text, pages: totalPages };
  } catch (err) {
    throw new PdfParseError(url, (err as Error).message);
  }
}
