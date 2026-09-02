/**
 * Factual access to five documentary sections published by the Dominican Senate.
 *
 * Four sections expose paginated WP File Download (WPFD) categories. Electronic
 * votes currently has no category and the official landing page explicitly says
 * that it has no files. This adapter preserves that statement as an observation;
 * it never turns an empty response into a legislative fact.
 */
import { INITIATIVE_CODE_RE } from "./codes.js";
import { buildISODate, extractLeadingISODate } from "./dates.js";
import { browserHeaders, fetchBytes, fetchJson, fetchText, type FetchBytesResult } from "./http.js";
import { fetchPdfText, type PdfText } from "./pdf.js";
import WordExtractor from "word-extractor";

const SENATE_HOST = "https://www.senadord.gob.do";
const WPFD_AJAX = `${SENATE_HOST}/wp-admin/admin-ajax.php`;
const WPFD_HEADERS = browserHeaders({
  "X-Requested-With": "XMLHttpRequest",
  Referer: `${SENATE_HOST}/`,
});

export type SenadoPublicationKind =
  | "APPROVED_INITIATIVES"
  | "EXPIRED_PROJECTS"
  | "ELECTRONIC_VOTES"
  | "COMMITTEE_ATTENDANCE"
  | "REPORTS_FOR_READING";

export interface SenadoPublicationSource {
  kind: SenadoPublicationKind;
  label: string;
  pageUrl: string;
  /** Null means the official page currently publishes no WPFD category. */
  categoryId: number | null;
}

export const SENADO_PUBLICATION_SOURCES: readonly SenadoPublicationSource[] = [
  {
    kind: "APPROVED_INITIATIVES",
    label: "Iniciativas Aprobadas",
    pageUrl: `${SENATE_HOST}/secretaria-general-legislativa/iniciativas-aprobadas/`,
    categoryId: 1389,
  },
  {
    kind: "EXPIRED_PROJECTS",
    label: "Proyectos Perimidos",
    pageUrl: `${SENATE_HOST}/secretaria-general-legislativa/proyectos-perimidos/`,
    categoryId: 1390,
  },
  {
    kind: "ELECTRONIC_VOTES",
    label: "Votaciones Electrónicas",
    pageUrl: `${SENATE_HOST}/elaboracion-de-actas/votaciones-electronicas/`,
    categoryId: null,
  },
  {
    kind: "COMMITTEE_ATTENDANCE",
    label: "Asistencia a Comisiones",
    pageUrl: `${SENATE_HOST}/comisiones/asistencia-a-comisiones/`,
    categoryId: 1383,
  },
  {
    kind: "REPORTS_FOR_READING",
    label: "Informes para Lectura",
    pageUrl: `${SENATE_HOST}/comisiones/informes-para-lectura/`,
    categoryId: 1384,
  },
] as const;

interface RawWpfdFile {
  ID?: unknown;
  post_title?: unknown;
  post_name?: unknown;
  ext?: unknown;
  size?: unknown;
  created_time?: unknown;
  modified_time?: unknown;
  created?: unknown;
  modified?: unknown;
  catname?: unknown;
  cattitle?: unknown;
  catid?: unknown;
  linkdownload?: unknown;
  openpdflink?: unknown;
  [key: string]: unknown;
}

interface RawWpfdPayload {
  files?: unknown;
  category?: unknown;
  [key: string]: unknown;
}

interface RawWpfdCategory {
  term_id?: unknown;
  count?: unknown;
  [key: string]: unknown;
}

export interface SenadoPublishedDocument {
  source: "senado-publicaciones";
  kind: SenadoPublicationKind;
  categoryId: number;
  fileId: number;
  title: string;
  slug: string;
  extension: string;
  sizeBytes: number | null;
  /** Calendar date shown by WPFD; the original timestamp remains in `raw`. */
  addedOn: string | null;
  modifiedOn: string | null;
  categorySlug: string | null;
  categoryTitle: string | null;
  pageUrl: string;
  /** URL listed verbatim by the official WPFD response. */
  downloadUrl: string | null;
  /** Deterministic official endpoint used when a document body must be read. */
  directDownloadUrl: string;
  viewerUrl: string | null;
  raw: RawWpfdFile;
}

export interface SenadoPublicationObservation {
  kind: SenadoPublicationKind;
  pageUrl: string;
  categoryId: number | null;
  reportedCount: number | null;
  collectedCount: number;
  complete: boolean;
  /** Literal text extracted from the official page, never synthesized. */
  emptyMessage: string | null;
}

export interface SenadoPublicationCollection {
  documents: SenadoPublishedDocument[];
  observations: SenadoPublicationObservation[];
  gaps: string[];
}

export interface SenadoPublicationTransport {
  json(url: string): Promise<unknown>;
  text(url: string): Promise<string>;
  pdfText(url: string): Promise<PdfText>;
  bytes(url: string): Promise<FetchBytesResult>;
  legacyWordText(bytes: Uint8Array): Promise<string>;
}

const defaultTransport: SenadoPublicationTransport = {
  json: (url) => fetchJson<unknown>(url, { headers: WPFD_HEADERS, timeoutMs: 30_000 }),
  text: (url) => fetchText(url, { timeoutMs: 30_000 }),
  pdfText: (url) => fetchPdfText(url),
  bytes: (url) => fetchBytes(url, { headers: WPFD_HEADERS, timeoutMs: 45_000 }),
  legacyWordText: async (bytes) => {
    const document = await new WordExtractor().extract(Buffer.from(bytes));
    return document.getBody();
  },
};

const OLE_COMPOUND_DOCUMENT_MAGIC = Uint8Array.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);
const LEGACY_WORD_CONTENT_TYPES = new Set(["application/msword", "application/octet-stream"]);
const MAX_LEGACY_WORD_BYTES = 50 * 1024 * 1024;

function normalizedContentType(contentType: string): string {
  return contentType.split(";", 1)[0]!.trim().toLowerCase();
}

function hasMagic(bytes: Uint8Array, magic: Uint8Array): boolean {
  return bytes.length >= magic.length && magic.every((value, index) => bytes[index] === value);
}

function validateLegacyWordBody(document: SenadoPublishedDocument, body: FetchBytesResult): void {
  const contentType = normalizedContentType(body.contentType);
  if (!LEGACY_WORD_CONTENT_TYPES.has(contentType)) {
    throw new Error(
      `Senado · archivo ${document.fileId} DOC con MIME no permitido (${contentType || "ausente"})`,
    );
  }
  if (
    body.bytes.length < 512 ||
    body.bytes.length > MAX_LEGACY_WORD_BYTES ||
    !hasMagic(body.bytes, OLE_COMPOUND_DOCUMENT_MAGIC)
  ) {
    throw new Error(
      `Senado · archivo ${document.fileId} DOC no contiene un documento OLE válido (${body.bytes.length} bytes)`,
    );
  }
  if (document.sizeBytes !== null && document.sizeBytes !== body.bytes.length) {
    throw new Error(
      `Senado · archivo ${document.fileId} DOC cambió de tamaño (${document.sizeBytes} declarado, ${body.bytes.length} recibido)`,
    );
  }
}

function wpfdCategoryUrl(categoryId: number, page: number): string {
  const base = `${WPFD_AJAX}?juwpfisadmin=false&action=wpfd&task=files.getFiles&id=${categoryId}`;
  return page === 1 ? base : `${base}&page=${page}`;
}

function wpfdDownloadUrl(categoryId: number, fileId: number): string {
  return `${WPFD_AJAX}?juwpfisadmin=false&action=wpfd&task=file.download&wpfd_category_id=${categoryId}&wpfd_file_id=${fileId}`;
}

function finiteInteger(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function displayDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  return match ? buildISODate(match[1]!, match[2]!, match[3]!) : null;
}

function documentFromRaw(
  raw: RawWpfdFile,
  source: SenadoPublicationSource,
): SenadoPublishedDocument {
  const fileId = finiteInteger(raw.ID);
  const listedCategoryId = finiteInteger(raw.catid);
  const title = nonEmptyString(raw.post_title);
  const slug = nonEmptyString(raw.post_name);
  const extension = nonEmptyString(raw.ext);
  if (fileId === null || !title || !slug || !extension) {
    throw new Error(`WPFD ${source.label}: archivo sin ID, título, slug o extensión`);
  }
  if (source.categoryId === null || listedCategoryId !== source.categoryId) {
    throw new Error(
      `WPFD ${source.label}: archivo ${fileId} reportó categoría ${String(raw.catid)}, esperada ${String(source.categoryId)}`,
    );
  }
  const sizeBytes = finiteInteger(raw.size);
  const createdAtRaw = nonEmptyString(raw.created_time);
  const modifiedAtRaw = nonEmptyString(raw.modified_time);
  return {
    source: "senado-publicaciones",
    kind: source.kind,
    categoryId: source.categoryId,
    fileId,
    title,
    slug,
    extension: extension.toLowerCase(),
    sizeBytes,
    addedOn: displayDate(raw.created) ?? extractLeadingISODate(createdAtRaw),
    modifiedOn: displayDate(raw.modified) ?? extractLeadingISODate(modifiedAtRaw),
    categorySlug: nonEmptyString(raw.catname),
    categoryTitle: nonEmptyString(raw.cattitle),
    pageUrl: source.pageUrl,
    downloadUrl: nonEmptyString(raw.linkdownload),
    directDownloadUrl: wpfdDownloadUrl(source.categoryId, fileId),
    viewerUrl: nonEmptyString(raw.openpdflink),
    raw,
  };
}

/** Parse and validate one WPFD page without doing I/O. Useful for fixtures/audits. */
export function parseSenadoWpfdPage(
  payload: unknown,
  source: SenadoPublicationSource,
): { documents: SenadoPublishedDocument[]; reportedCount: number } {
  if (!payload || typeof payload !== "object") {
    throw new Error(`WPFD ${source.label}: respuesta no es un objeto JSON`);
  }
  if (source.categoryId === null) {
    throw new Error(`WPFD ${source.label}: la fuente no tiene categoría configurada`);
  }
  const data = payload as RawWpfdPayload;
  if (!Array.isArray(data.files) || !data.category || typeof data.category !== "object") {
    throw new Error(`WPFD ${source.label}: faltan files o category`);
  }
  const category = data.category as RawWpfdCategory;
  const returnedCategoryId = finiteInteger(category.term_id);
  const reportedCount = finiteInteger(category.count);
  if (returnedCategoryId !== source.categoryId || reportedCount === null) {
    throw new Error(
      `WPFD ${source.label}: categoría/conteo inválido (${String(category.term_id)}, ${String(category.count)})`,
    );
  }
  return {
    documents: data.files.map((raw) => {
      if (!raw || typeof raw !== "object") {
        throw new Error(`WPFD ${source.label}: entrada de archivo inválida`);
      }
      return documentFromRaw(raw as RawWpfdFile, source);
    }),
    reportedCount,
  };
}

function decodeHtmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface SenadoPublicationLanding {
  categoryId: number | null;
  emptyMessage: string | null;
}

/** Extract only literal category/empty-state evidence from a Senate landing page. */
export function parseSenadoPublicationLanding(html: string): SenadoPublicationLanding {
  const category =
    html.match(/wpfd_root_category_id\s*[=:]\s*["']?(\d+)/i)?.[1] ??
    html.match(/data-(?:category|category-id)=["'](\d+)["']/i)?.[1] ??
    null;
  const emptyBlock = html.match(
    /<[^>]*class=["'][^"']*wpfd-empty-category-message[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i,
  )?.[1];
  return {
    categoryId: category ? Number(category) : null,
    emptyMessage: emptyBlock ? decodeHtmlText(emptyBlock) || null : null,
  };
}

export interface ApprovedInitiativeMention {
  code: string;
  /** Literal slice beginning at this code and ending immediately before the next code. */
  rawText: string;
}

/**
 * Locate complete initiative codes in an official "Iniciativas Aprobadas" PDF.
 * No title, proponent, status, or date is inferred from flattened table columns.
 */
export function parseApprovedInitiativeMentions(text: string): ApprovedInitiativeMention[] {
  const regex = new RegExp(INITIATIVE_CODE_RE.source, INITIATIVE_CODE_RE.flags);
  const matches = [...text.matchAll(regex)];
  return matches.map((match, index) => ({
    code: match[0]!.toUpperCase(),
    rawText: text.slice(match.index!, matches[index + 1]?.index ?? text.length).trim(),
  }));
}

export interface ExpiredInitiativeRecord {
  code: string;
  /** Date attached to the literal phrase "Perimida el"; null when absent/invalid. */
  expiredOn: string | null;
  expiredOnRaw: string | null;
  /** Literal source slice ending at the record's Número Iniciativa marker. */
  rawText: string;
}

/** Parse only explicitly labelled expiry dates from a "Proyectos Perimidos" PDF. */
export function parseExpiredInitiativeRecords(text: string): ExpiredInitiativeRecord[] {
  const marker = new RegExp(
    `»?\\s*N[uú]mero\\s+Iniciativa\\s*:\\s*(${INITIATIVE_CODE_RE.source})`,
    "gi",
  );
  const matches = [...text.matchAll(marker)];
  return matches.map((match, index) => {
    const markerEnd = match.index! + match[0]!.length;
    const previousEnd =
      index === 0 ? 0 : matches[index - 1]!.index! + matches[index - 1]![0]!.length;
    const rawText = text.slice(previousEnd, markerEnd).trim();
    const expiry = [...rawText.matchAll(/Perimida\s+el\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/gi)].at(-1);
    const expiredOnRaw = expiry?.[0] ?? null;
    return {
      code: match[1]!.toUpperCase(),
      expiredOn: expiry ? buildISODate(expiry[1]!, expiry[2]!, expiry[3]!) : null,
      expiredOnRaw,
      rawText,
    };
  });
}

export interface SenadoPartialReference {
  /** Exact normalized partial reference; deliberately not a full initiative code. */
  reference: string;
  rawReference: string;
}

/** Preserve EXP references from committee reports without inventing a Senate suffix. */
export function parseSenadoReportReferences(text: string): SenadoPartialReference[] {
  return [...text.matchAll(/\bEXP(?:EDIENTE)?\.?\s*:?\s*(\d{5})\s*-\s*(\d{4})\b/gi)].map(
    (match) => ({ reference: `${match[1]}-${match[2]}`, rawReference: match[0]! }),
  );
}

export interface SenadoMeetingDateMention {
  date: string | null;
  rawText: string;
}

/** Extract only dates explicitly labelled "Fecha Reunión" from attendance PDFs. */
export function parseSenadoAttendanceMeetingDates(text: string): SenadoMeetingDateMention[] {
  return [...text.matchAll(/Fecha\s+Reuni[oó]n\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/gi)].map(
    (match) => ({
      date: buildISODate(match[1]!, match[2]!, match[3]!),
      rawText: match[0]!,
    }),
  );
}

export interface SenadoPublicationCollectOptions {
  kinds?: readonly SenadoPublicationKind[];
  /** Test/smoke limit. Omitting it requests the complete reported collection. */
  maxPagesPerSource?: number;
}

export class SenadoPublicationsAdapter {
  readonly source = "senado-publicaciones";

  constructor(private readonly transport: SenadoPublicationTransport = defaultTransport) {}

  private async readWpfdPage(url: string): Promise<unknown> {
    let lastError: unknown;
    // The site occasionally serves a maintenance sentence with HTTP 200. Since
    // JSON decoding happens after HTTP retries, retry that malformed payload here.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.transport.json(url);
      } catch (error) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw lastError;
  }

  async fetchDocumentText(document: SenadoPublishedDocument): Promise<PdfText> {
    if (document.extension === "pdf") {
      return this.transport.pdfText(document.directDownloadUrl);
    }
    if (document.extension === "doc") {
      const body = await this.transport.bytes(document.directDownloadUrl);
      validateLegacyWordBody(document, body);
      let text: string;
      try {
        text = await this.transport.legacyWordText(body.bytes);
      } catch (error) {
        throw new Error(
          `Senado · archivo ${document.fileId} DOC no pudo leerse: ${(error as Error).message}`,
          { cause: error },
        );
      }
      if (!text.trim()) {
        throw new Error(`Senado · archivo ${document.fileId} DOC no contiene texto legible`);
      }
      // Binary Word files do not expose a reliable page count without a rendering engine.
      return { text, pages: 0 };
    }
    throw new Error(
      `Senado · archivo ${document.fileId} usa un formato no compatible (${document.extension})`,
    );
  }

  async collect(opts: SenadoPublicationCollectOptions = {}): Promise<SenadoPublicationCollection> {
    const selected = new Set(opts.kinds ?? SENADO_PUBLICATION_SOURCES.map((source) => source.kind));
    const maxPages = opts.maxPagesPerSource ?? Number.POSITIVE_INFINITY;
    if (!(maxPages >= 1)) throw new Error("maxPagesPerSource debe ser al menos 1");

    const documents: SenadoPublishedDocument[] = [];
    const observations: SenadoPublicationObservation[] = [];
    const gaps: string[] = [];

    for (const source of SENADO_PUBLICATION_SOURCES) {
      if (!selected.has(source.kind)) continue;
      if (source.categoryId === null) {
        const landing = parseSenadoPublicationLanding(await this.transport.text(source.pageUrl));
        if (!landing.emptyMessage) {
          throw new Error(
            `Senado · ${source.label}: no hay categoría configurada ni mensaje oficial de categoría vacía`,
          );
        }
        observations.push({
          kind: source.kind,
          pageUrl: source.pageUrl,
          categoryId: landing.categoryId,
          reportedCount: null,
          collectedCount: 0,
          complete: true,
          emptyMessage: landing.emptyMessage,
        });
        continue;
      }

      const sourceDocuments: SenadoPublishedDocument[] = [];
      const seen = new Set<number>();
      let reportedCount: number | null = null;
      let page = 1;
      while (page <= maxPages) {
        const parsed = parseSenadoWpfdPage(
          await this.readWpfdPage(wpfdCategoryUrl(source.categoryId, page)),
          source,
        );
        if (reportedCount === null) reportedCount = parsed.reportedCount;
        if (parsed.reportedCount !== reportedCount) {
          throw new Error(
            `WPFD ${source.label}: el conteo cambió durante la paginación (${reportedCount} → ${parsed.reportedCount})`,
          );
        }
        if (!parsed.documents.length && sourceDocuments.length < reportedCount) {
          throw new Error(
            `WPFD ${source.label}: página ${page} vacía antes de alcanzar ${reportedCount} archivos`,
          );
        }
        for (const document of parsed.documents) {
          if (seen.has(document.fileId)) {
            throw new Error(`WPFD ${source.label}: archivo duplicado ${document.fileId}`);
          }
          seen.add(document.fileId);
          sourceDocuments.push(document);
        }
        if (sourceDocuments.length >= reportedCount) break;
        page++;
      }

      const complete = sourceDocuments.length === reportedCount;
      if (sourceDocuments.length > reportedCount!) {
        throw new Error(
          `WPFD ${source.label}: recibió ${sourceDocuments.length}, más que el conteo ${reportedCount}`,
        );
      }
      if (!complete) {
        gaps.push(
          `Senado · ${source.label}: smoke/truncado a ${sourceDocuments.length} de ${reportedCount} archivo(s).`,
        );
      }
      documents.push(...sourceDocuments);
      observations.push({
        kind: source.kind,
        pageUrl: source.pageUrl,
        categoryId: source.categoryId,
        reportedCount,
        collectedCount: sourceDocuments.length,
        complete,
        emptyMessage: null,
      });
    }

    return { documents, observations, gaps };
  }
}
