/**
 * Minimal PDF → text helper, used to parse the Cámara de Diputados plenary
 * order-of-the-day PDFs (and any other government PDF agendas). Uses `unpdf`
 * (serverless-friendly pdf.js build, no native deps).
 */
import { extractText, getDocumentProxy } from "unpdf";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

export interface PdfText {
  text: string;
  pages: number;
}

/** Download a PDF and return its merged text. Throws on non-PDF / fetch failure. */
export async function fetchPdfText(url: string, timeoutMs = 45_000): Promise<PdfText> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.slice(0, 5).toString() !== "" && Buffer.from(buf.slice(0, 5)).toString("latin1") !== "%PDF-") {
    throw new Error(`not a PDF: ${url}`);
  }
  const pdf = await getDocumentProxy(buf);
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text: Array.isArray(text) ? text.join("\n") : text, pages: totalPages };
}
