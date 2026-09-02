/**
 * Exact daily commission-agenda documents published by the Cámara de Diputados.
 *
 * The SIL activity API identifies each meeting, but its detail endpoint is JSON. The
 * human-readable evidence is a separate, daily PDF in the official WP File Download
 * (WPFD) tree. This adapter traverses that tree, reconciles every category snapshot,
 * resolves a document only from the literal date in its title, and validates the PDF
 * bytes before exposing it to the activity adapter.
 */
import { extractCodes } from "./codes.js";
import { buildISODate, spanishMonthToNum } from "./dates.js";
import { fetchJson } from "./http.js";
import { fetchPdfText, type PdfText } from "./pdf.js";

export const DIP_COMMISSION_AGENDA_PAGE = "https://camaradediputados.gob.do/agenda-comisiones/";
export const DIP_COMMISSION_AGENDA_AJAX =
  "https://camaradediputados.gob.do/wp-admin/admin-ajax.php";
export const DIP_COMMISSION_AGENDA_ROOT_CATEGORY_ID = 211;

const MAX_CATEGORY_DEPTH = 12;
const MAX_FILE_PAGES = 200;
const OFFICIAL_HOST = "camaradediputados.gob.do";

type JsonRecord = Record<string, unknown>;

export interface CommissionAgendaCategory {
  id: number;
  parentId: number;
  title: string;
  slug: string;
  count: number;
  ordering: string;
  orderingDirection: string;
}

export interface CommissionAgendaCatalog {
  category: CommissionAgendaCategory;
  categories: CommissionAgendaCategory[];
}

export interface CommissionAgendaDocument {
  source: "dip-commission-agenda";
  sourceId: string;
  categoryId: number;
  categoryTitle: string;
  fileId: number;
  title: string;
  slug: string;
  extension: "pdf";
  /** Date stated literally in `title`; upload timestamps are never used. */
  agendaDate: string;
  downloadUrl: string;
  previewUrl: string;
  raw: {
    payload: JsonRecord;
    provenance: {
      pageSource: string;
      metadataUrl: string;
      downloadUrl: string;
      previewUrl: string;
    };
  };
}

export interface CommissionAgendaFilesPage {
  category: CommissionAgendaCategory;
  documents: CommissionAgendaDocument[];
}

export interface CommissionAgendaResolution {
  /** A date is null unless exactly one metadata record and a parseable PDF exist. */
  documentsByDate: Map<string, CommissionAgendaDocument | null>;
  /** Text is retained only in memory so SIL can prove that a commission is present. */
  pdfTextBySourceId: Map<string, string>;
  gaps: string[];
}

export interface CommissionAgendaResolver {
  resolveDates(
    dates: readonly string[],
    options?: { pageSize?: number },
  ): Promise<CommissionAgendaResolution>;
}

export interface DipCommissionAgendaOptions {
  ajaxUrl?: string;
  rootCategoryId?: number;
  readJson?: (url: string) => Promise<unknown>;
  readPdfText?: (url: string) => Promise<PdfText>;
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an object`);
  }
  return value as JsonRecord;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${label}: expected a non-empty string`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid ${label}: ${String(value)}`);
  }
  return parsed;
}

function orderingFromDescription(value: unknown): {
  ordering: string;
  orderingDirection: string;
} {
  if (typeof value !== "string" || value.trim() === "") {
    return { ordering: "title", orderingDirection: "desc" };
  }
  try {
    const description = record(JSON.parse(value), "WPFD category description");
    return {
      ordering:
        typeof description.ordering === "string" && description.ordering
          ? description.ordering
          : "title",
      orderingDirection:
        typeof description.orderingdir === "string" && description.orderingdir
          ? description.orderingdir
          : "desc",
    };
  } catch {
    return { ordering: "title", orderingDirection: "desc" };
  }
}

function parseCategory(value: unknown): CommissionAgendaCategory {
  const item = record(value, "WPFD category");
  const fromDescription = orderingFromDescription(item.description);
  return {
    id: integer(item.term_id ?? item.termID, "category id"),
    parentId: integer(item.parent ?? 0, "category parent id"),
    title: requiredString(item.name, "category title"),
    slug: requiredString(item.slug, "category slug"),
    count: integer(item.count, "category count"),
    ordering:
      typeof item.ordering === "string" && item.ordering ? item.ordering : fromDescription.ordering,
    orderingDirection:
      typeof item.orderingdir === "string" && item.orderingdir
        ? item.orderingdir
        : fromDescription.orderingDirection,
  };
}

export function parseCommissionAgendaCatalog(
  value: unknown,
  expectedCategoryId?: number,
): CommissionAgendaCatalog {
  const payload = record(value, "WPFD catalog response");
  const category = parseCategory(payload.category);
  if (expectedCategoryId !== undefined && category.id !== expectedCategoryId) {
    throw new Error(
      `WPFD category mismatch: expected ${expectedCategoryId}, received ${category.id}`,
    );
  }
  if (!Array.isArray(payload.categories)) {
    throw new Error("Invalid WPFD catalog categories");
  }
  return { category, categories: payload.categories.map(parseCategory) };
}

/** Parse only the canonical daily title. Incidental/upload dates are not accepted. */
export function parseCommissionAgendaTitleDate(title: string): string | null {
  const match = /^\s*agenda\s+del\s+(\d{1,2})\s+de\s+([a-záéíóúüñ]+)\s+de\s+(\d{4})\s*$/iu.exec(
    title,
  );
  if (!match) return null;
  const month = spanishMonthToNum(match[2]);
  return month ? buildISODate(match[1]!, month, match[3]!) : null;
}

function parsedOfficialUrl(value: unknown, label: string): URL {
  const literal = requiredString(value, label);
  let url: URL;
  try {
    url = new URL(literal);
  } catch {
    throw new Error(`Invalid ${label}: ${literal}`);
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== OFFICIAL_HOST ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw new Error(`Non-official ${label}: ${literal}`);
  }
  return url;
}

function officialDownloadUrl(value: unknown, categoryId: number, fileId: number): string {
  const url = parsedOfficialUrl(value, "download URL");
  const parts = url.pathname.split("/").filter(Boolean);
  if (
    parts.length < 5 ||
    parts[0] !== "download" ||
    parts[1] !== String(categoryId) ||
    parts.at(-2) !== String(fileId) ||
    !/\.pdf$/i.test(parts.at(-1) ?? "") ||
    url.search !== ""
  ) {
    throw new Error(
      `WPFD download URL does not identify category ${categoryId}, file ${fileId}: ${url.toString()}`,
    );
  }
  return url.toString();
}

function officialPreviewUrl(value: unknown, categoryId: number, fileId: number): string {
  const url = parsedOfficialUrl(value, "preview URL");
  if (
    url.pathname !== "/wp-admin/admin-ajax.php" ||
    url.searchParams.get("action") !== "wpfd" ||
    url.searchParams.get("task") !== "file.download" ||
    url.searchParams.get("wpfd_category_id") !== String(categoryId) ||
    url.searchParams.get("wpfd_file_id") !== String(fileId) ||
    url.searchParams.get("preview") !== "1"
  ) {
    throw new Error(
      `WPFD preview URL does not identify category ${categoryId}, file ${fileId}: ${url.toString()}`,
    );
  }
  return url.toString();
}

function pageSource(category: CommissionAgendaCategory, rootCategoryId: number): string {
  return `${DIP_COMMISSION_AGENDA_PAGE}#${rootCategoryId}-${category.id}-wpfd-${category.slug}`;
}

export function parseCommissionAgendaFilesPage(
  value: unknown,
  metadataUrl: string,
  expectedCategoryId?: number,
  rootCategoryId: number = DIP_COMMISSION_AGENDA_ROOT_CATEGORY_ID,
): CommissionAgendaFilesPage {
  const payload = record(value, "WPFD files response");
  const category = parseCategory(payload.category);
  if (expectedCategoryId !== undefined && category.id !== expectedCategoryId) {
    throw new Error(
      `WPFD category mismatch: expected ${expectedCategoryId}, received ${category.id}`,
    );
  }
  if (!Array.isArray(payload.files)) throw new Error("Invalid WPFD files list");

  const documents: CommissionAgendaDocument[] = [];
  for (const entry of payload.files) {
    const file = record(entry, "WPFD file");
    const fileId = integer(file.ID, "file id");
    const fileCategoryId = integer(file.catid, "file category id");
    if (fileCategoryId !== category.id) {
      throw new Error(
        `WPFD file ${fileId} belongs to category ${fileCategoryId}, not ${category.id}`,
      );
    }
    const title = requiredString(file.post_title, "file title");
    const agendaDate = parseCommissionAgendaTitleDate(title);
    // A file without the canonical daily title is part of the inventory but cannot
    // establish the date of a commission meeting, so do not emit it as a candidate.
    if (!agendaDate) continue;
    if (requiredString(file.ext, "file extension").toLocaleLowerCase("en") !== "pdf") {
      throw new Error(`WPFD commission agenda ${fileId} is not a PDF`);
    }
    const downloadUrl = officialDownloadUrl(file.linkdownload, category.id, fileId);
    const previewUrl = officialPreviewUrl(file.openpdflink, category.id, fileId);
    documents.push({
      source: "dip-commission-agenda",
      sourceId: `${category.id}:${fileId}`,
      categoryId: category.id,
      categoryTitle: requiredString(file.cattitle ?? category.title, "file category title"),
      fileId,
      title,
      slug: requiredString(file.post_name, "file slug"),
      extension: "pdf",
      agendaDate,
      downloadUrl,
      previewUrl,
      raw: {
        payload: file,
        provenance: {
          pageSource: pageSource(category, rootCategoryId),
          metadataUrl,
          downloadUrl,
          previewUrl,
        },
      },
    });
  }
  return { category, documents };
}

function explicitYears(value: string): number[] {
  return [...value.matchAll(/(?:^|\D)((?:19|20)\d{2})(?=\D|$)/g)].map((match) => Number(match[1]));
}

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

function categoryMonth(category: CommissionAgendaCategory): number | null {
  const text = `${category.title} ${category.slug}`.normalize("NFC").toLocaleLowerCase("es");
  const index = MONTH_NAMES.findIndex((month) =>
    new RegExp(`(?:^|[^a-záéíóúüñ])${month}(?:[^a-záéíóúüñ]|$)`, "iu").test(text),
  );
  return index < 0 ? null : index + 1;
}

function validISODate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  return buildISODate(match[3]!, match[2]!, match[1]!) === value;
}

class SnapshotCountChanged extends Error {
  constructor(
    readonly category: CommissionAgendaCategory,
    readonly observedCount: number,
  ) {
    super(`WPFD count changed for category ${category.id}: ${category.count} → ${observedCount}`);
  }
}

function normalizedEvidenceText(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("es");
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function displayDate(isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : null;
}

/**
 * Prove that a particular SIL row appears in the already date-matched daily PDF.
 *
 * A generic word such as "Trabajo" or "Salud" elsewhere in the PDF is not evidence.
 * The complete commission name must be immediately followed by the row date (the
 * official table heading), and the row description or every literal initiative code
 * from that description must also occur in the document. No fuzzy matching is used.
 */
export function commissionAppearsInAgendaPdf(
  commission: string | null | undefined,
  description: string | null | undefined,
  agendaDate: string | null | undefined,
  pdfText: string,
): {
  matched: boolean;
  evidenceType: "COMMISSION_CODE" | "COMMISSION_NAME" | null;
  evidence: string | null;
  agendaEvidenceType: "DESCRIPTION" | "INITIATIVE_CODES" | null;
  agendaEvidence: string[] | null;
} {
  const literal = commission?.trim();
  const literalDescription = description?.trim();
  const formattedDate = agendaDate ? displayDate(agendaDate) : null;
  if (!literal || !literalDescription || !formattedDate || !pdfText.trim()) {
    return {
      matched: false,
      evidenceType: null,
      evidence: null,
      agendaEvidenceType: null,
      agendaEvidence: null,
    };
  }

  const normalizedCommission = normalizedEvidenceText(literal);
  const normalizedDescription = normalizedEvidenceText(literalDescription);
  const normalizedPdf = normalizedEvidenceText(pdfText);
  // Each extracted WPFD table row has a numeric index immediately before the
  // commission heading. Requiring that boundary prevents suffix collisions such as
  // selected "Trabajo" matching only "Comisión Especial de Trabajo".
  const exactHeading = new RegExp(
    `(?:^|\\s)\\d{1,3}\\s+${escapedRegExp(normalizedCommission)}\\s+${escapedRegExp(formattedDate.toLocaleLowerCase("es"))}(?=\\s|$)`,
    "u",
  );
  if (!exactHeading.test(normalizedPdf)) {
    return {
      matched: false,
      evidenceType: null,
      evidence: null,
      agendaEvidenceType: null,
      agendaEvidence: null,
    };
  }

  const descriptionCodes = extractCodes(literalDescription);
  const pdfCodes = new Set(extractCodes(pdfText));
  const exactDescription =
    normalizedDescription.length >= 12 && normalizedPdf.includes(normalizedDescription);
  const exactDescriptionCodes =
    descriptionCodes.length > 0 && descriptionCodes.every((code) => pdfCodes.has(code));
  if (!exactDescription && !exactDescriptionCodes) {
    return {
      matched: false,
      evidenceType: null,
      evidence: null,
      agendaEvidenceType: null,
      agendaEvidence: null,
    };
  }

  const commissionCode = extractCodes(literal).find((code) => pdfCodes.has(code));
  return {
    matched: true,
    evidenceType: commissionCode ? "COMMISSION_CODE" : "COMMISSION_NAME",
    evidence: commissionCode ?? literal,
    agendaEvidenceType: exactDescription ? "DESCRIPTION" : "INITIATIVE_CODES",
    agendaEvidence: exactDescription ? null : descriptionCodes,
  };
}

export class DipCommissionAgendaAdapter implements CommissionAgendaResolver {
  readonly source = "dip-commission-agenda";
  private readonly ajaxUrl: string;
  private readonly rootCategoryId: number;
  private readonly readJson: (url: string) => Promise<unknown>;
  private readonly readPdf: (url: string) => Promise<PdfText>;

  constructor(options: DipCommissionAgendaOptions = {}) {
    this.ajaxUrl = options.ajaxUrl ?? DIP_COMMISSION_AGENDA_AJAX;
    this.rootCategoryId = options.rootCategoryId ?? DIP_COMMISSION_AGENDA_ROOT_CATEGORY_ID;
    this.readJson = options.readJson ?? ((url) => fetchJson<unknown>(url, { timeoutMs: 25_000 }));
    this.readPdf = options.readPdfText ?? ((url) => fetchPdfText(url));
  }

  private url(params: Record<string, string>): string {
    const url = new URL(this.ajaxUrl);
    url.search = new URLSearchParams({
      juwpfisadmin: "false",
      action: "wpfd",
      ...params,
    }).toString();
    return url.toString();
  }

  private async catalog(categoryId: number): Promise<CommissionAgendaCatalog> {
    const url = this.url({ task: "categories.getCategories", id: String(categoryId) });
    return parseCommissionAgendaCatalog(await this.readJson(url), categoryId);
  }

  private async readDocumentSnapshot(
    category: CommissionAgendaCategory,
    pageSize: number,
  ): Promise<CommissionAgendaDocument[]> {
    if (category.count === 0) return [];
    const documents = new Map<number, CommissionAgendaDocument>();
    for (let page = 1; page <= MAX_FILE_PAGES && documents.size < category.count; page++) {
      const metadataUrl = this.url({
        task: "files.display",
        view: "files",
        id: String(category.id),
        rootcat: String(this.rootCategoryId),
        page: String(page),
        orderCol: category.ordering,
        orderDir: category.orderingDirection,
        page_limit: String(pageSize),
      });
      const parsed = parseCommissionAgendaFilesPage(
        await this.readJson(metadataUrl),
        metadataUrl,
        category.id,
        this.rootCategoryId,
      );
      if (parsed.category.count !== category.count) {
        throw new SnapshotCountChanged(category, parsed.category.count);
      }
      const before = documents.size;
      for (const document of parsed.documents) documents.set(document.fileId, document);
      if (documents.size === before) {
        throw new Error(
          `WPFD pagination made no unique progress for category ${category.id} on page ${page}`,
        );
      }
    }
    if (documents.size !== category.count) {
      throw new Error(
        `WPFD incomplete category ${category.id}: expected ${category.count}, received ${documents.size} unique dated PDF files`,
      );
    }
    return [...documents.values()];
  }

  /** Retry one stable snapshot after a concurrent upload; a second change fails closed. */
  async documentsInCategory(
    category: CommissionAgendaCategory,
    options: { pageSize?: number } = {},
  ): Promise<CommissionAgendaDocument[]> {
    const pageSize = options.pageSize ?? 100;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      throw new Error(`Invalid WPFD page size: ${pageSize}`);
    }
    let snapshot = category;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.readDocumentSnapshot(snapshot, pageSize);
      } catch (error) {
        if (!(error instanceof SnapshotCountChanged) || attempt === 1) throw error;
        snapshot = { ...snapshot, count: error.observedCount };
      }
    }
    throw new Error(`WPFD could not obtain a stable snapshot for category ${category.id}`);
  }

  private async relevantFileCategories(
    dates: readonly string[],
  ): Promise<CommissionAgendaCategory[]> {
    const byYear = new Map<number, Set<number>>();
    for (const date of dates) {
      const year = Number(date.slice(0, 4));
      const month = Number(date.slice(5, 7));
      const months = byYear.get(year) ?? new Set<number>();
      months.add(month);
      byYear.set(year, months);
    }

    const root = await this.catalog(this.rootCategoryId);
    const selected = new Map<number, CommissionAgendaCategory>();
    const visited = new Set<string>();

    const walk = async (
      category: CommissionAgendaCategory,
      targetYear: number,
      targetMonths: ReadonlySet<number>,
      depth: number,
    ): Promise<void> => {
      if (depth > MAX_CATEGORY_DEPTH) {
        throw new Error(`WPFD category tree exceeded ${MAX_CATEGORY_DEPTH} levels`);
      }
      const visitKey = `${targetYear}:${category.id}`;
      if (visited.has(visitKey)) return;
      visited.add(visitKey);

      const years = explicitYears(`${category.title} ${category.slug}`);
      if (years.length > 0 && !years.includes(targetYear)) return;
      const month = categoryMonth(category);
      if (month !== null && !targetMonths.has(month)) return;
      if (category.count > 0) selected.set(category.id, category);

      const catalog = await this.catalog(category.id);
      await Promise.all(
        catalog.categories.map((child) => walk(child, targetYear, targetMonths, depth + 1)),
      );
    };

    for (const [year, months] of byYear) {
      const directYearBranches = root.categories.filter((category) =>
        explicitYears(`${category.title} ${category.slug}`).includes(year),
      );
      // Prefer the explicit period branches (PLO/SLO). A yearless branch such as
      // Histórico is traversed only when the current tree has no explicit branch.
      const branches =
        directYearBranches.length > 0
          ? directYearBranches
          : root.categories.filter(
              (category) => explicitYears(`${category.title} ${category.slug}`).length === 0,
            );
      await Promise.all(branches.map((branch) => walk(branch, year, months, 1)));
    }
    return [...selected.values()];
  }

  async resolveDates(
    inputDates: readonly string[],
    options: { pageSize?: number } = {},
  ): Promise<CommissionAgendaResolution> {
    const dates = [...new Set(inputDates)];
    for (const date of dates) {
      if (!validISODate(date)) throw new Error(`Invalid commission agenda date: ${date}`);
    }
    const documentsByDate = new Map<string, CommissionAgendaDocument | null>(
      dates.map((date) => [date, null]),
    );
    const pdfTextBySourceId = new Map<string, string>();
    const gaps: string[] = [];
    if (dates.length === 0) return { documentsByDate, pdfTextBySourceId, gaps };

    const targetDates = new Set(dates);
    const categories = await this.relevantFileCategories(dates);
    const pages = await Promise.all(
      categories.map((category) => this.documentsInCategory(category, options)),
    );
    const candidatesByDate = new Map<string, CommissionAgendaDocument[]>();
    for (const document of pages.flat()) {
      if (!targetDates.has(document.agendaDate)) continue;
      const candidates = candidatesByDate.get(document.agendaDate) ?? [];
      if (!candidates.some((candidate) => candidate.sourceId === document.sourceId)) {
        candidates.push(document);
      }
      candidatesByDate.set(document.agendaDate, candidates);
    }

    const uniqueDocuments = new Map<string, CommissionAgendaDocument>();
    for (const date of dates) {
      const candidates = candidatesByDate.get(date) ?? [];
      if (candidates.length !== 1) {
        gaps.push(
          candidates.length === 0
            ? `Diputados · agenda de comisiones (${date}): la fuente no publicó un PDF diario con esa fecha literal.`
            : `Diputados · agenda de comisiones (${date}): ${candidates.length} PDFs comparten la fecha literal; no se eligió uno por inferencia.`,
        );
        continue;
      }
      uniqueDocuments.set(candidates[0]!.sourceId, candidates[0]!);
      documentsByDate.set(date, candidates[0]!);
    }

    await Promise.all(
      [...uniqueDocuments.values()].map(async (document) => {
        try {
          const parsed = await this.readPdf(document.downloadUrl);
          if (!parsed.text.trim() || parsed.pages < 1) {
            throw new Error(`PDF sin texto verificable (${parsed.pages} páginas)`);
          }
          pdfTextBySourceId.set(document.sourceId, parsed.text);
        } catch (error) {
          documentsByDate.set(document.agendaDate, null);
          gaps.push(
            `Diputados · agenda de comisiones (${document.agendaDate}): el archivo ${document.fileId} no fue un PDF legible (${(error as Error).message}).`,
          );
        }
      }),
    );

    return { documentsByDate, pdfTextBySourceId, gaps };
  }
}
