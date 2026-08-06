/**
 * Literal document inventory for the Cámara de Diputados section
 * "Orden del día conocida por el pleno".
 *
 * This adapter deliberately does not emit a legislative status, result, category,
 * probability, or other interpretation. A document proves only that the official
 * source published that document in this named section. Optional PDF parsing extracts
 * exact initiative codes and nothing else.
 */
import { INITIATIVE_CODE_RE } from "./codes.js";
import { buildISODate, extractLeadingISODate, spanishMonthToNum } from "./dates.js";
import { fetchJson } from "./http.js";

export const DIP_KNOWN_AGENDA_PAGE =
  "https://camaradediputados.gob.do/orden-del-dia-conocida-por-el-pleno/";
export const DIP_KNOWN_AGENDA_AJAX = "https://camaradediputados.gob.do/wp-admin/admin-ajax.php";
export const DIP_KNOWN_AGENDA_ROOT_CATEGORY_ID = 143;

type JsonRecord = Record<string, unknown>;

export interface KnownAgendaCategory {
  id: number;
  title: string;
  slug: string;
  count: number;
  ordering: string;
  orderingDirection: string;
}

export interface KnownAgendaCatalog {
  sectionId: number;
  sectionTitle: string;
  sectionSlug: string;
  sectionCount: number;
  categories: KnownAgendaCategory[];
}

export interface KnownAgendaDocument {
  source: "dip-known-agenda";
  sourceId: string;
  sectionTitle: string;
  categoryId: number;
  categoryTitle: string;
  fileId: number;
  title: string;
  slug: string;
  extension: string;
  sessionNumber: string | null;
  sessionDate: string | null;
  uploadedDate: string | null;
  modifiedDate: string | null;
  downloadUrl: string;
  previewUrl: string | null;
  initiativeCodes: string[];
  raw: {
    payload: JsonRecord;
    provenance: { sectionUrl: string; metadataUrl: string; documentUrl: string };
  };
}

export interface KnownAgendaFilePage {
  category: KnownAgendaCategory;
  documents: KnownAgendaDocument[];
}

export interface KnownAgendaTitleParts {
  sessionNumber: string | null;
  sessionDate: string | null;
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
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`Invalid ${label}: ${String(value)}`);
  return parsed;
}

function parseCategory(value: unknown): KnownAgendaCategory {
  const item = record(value, "WPFD category");
  return {
    id: integer(item.term_id ?? item.termID, "category id"),
    title: requiredString(item.name, "category title"),
    slug: requiredString(item.slug, "category slug"),
    count: integer(item.count, "category count"),
    ordering: typeof item.ordering === "string" && item.ordering ? item.ordering : "ordering",
    orderingDirection:
      typeof item.orderingdir === "string" && item.orderingdir ? item.orderingdir : "asc",
  };
}

export function parseKnownAgendaCatalog(value: unknown): KnownAgendaCatalog {
  const payload = record(value, "WPFD catalog response");
  const section = parseCategory(payload.category);
  if (!Array.isArray(payload.categories)) throw new Error("Invalid WPFD catalog categories");
  return {
    sectionId: section.id,
    sectionTitle: section.title,
    sectionSlug: section.slug,
    sectionCount: section.count,
    categories: payload.categories.map(parseCategory),
  };
}

/** Normalize only the session number/date literally present in the official title. */
export function parseKnownAgendaTitle(title: string): KnownAgendaTitleParts {
  const sessionNumber = title.match(/sesi[oó]n\s+(\d+)/i)?.[1] ?? null;
  const dateMatch = title.match(/(\d{1,2})\s+de\s+([a-záéíóúüñ]+)\s+de\s+(\d{4})/i);
  const month = dateMatch ? spanishMonthToNum(dateMatch[2]) : null;
  return {
    sessionNumber,
    sessionDate: dateMatch && month ? buildISODate(dateMatch[1]!, month, dateMatch[3]!) : null,
  };
}

export interface KnownAgendaCodeMention {
  code: string;
  /** Literal slice beginning at the code and ending before the next code. */
  rawText: string;
}

/** Extract exact initiative identifiers only; words such as "aprobado" are ignored. */
export function parseKnownAgendaPdf(text: string): {
  initiativeCodes: string[];
  mentions: KnownAgendaCodeMention[];
} {
  const matches = [
    ...text.matchAll(new RegExp(INITIATIVE_CODE_RE.source, INITIATIVE_CODE_RE.flags)),
  ];
  const seen = new Set<string>();
  const mentions: KnownAgendaCodeMention[] = [];
  for (const [index, match] of matches.entries()) {
    const code = match[0]!.toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);
    mentions.push({
      code,
      rawText: text.slice(match.index!, matches[index + 1]?.index ?? text.length).trim(),
    });
  }
  return { initiativeCodes: mentions.map((mention) => mention.code), mentions };
}

function officialUrl(value: unknown, label: string, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const url = requiredString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid ${label}: ${url}`);
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "camaradediputados.gob.do") {
    throw new Error(`Non-official ${label}: ${url}`);
  }
  return url;
}

export function parseKnownAgendaFilesPage(
  value: unknown,
  metadataUrl: string,
  expectedCategoryId?: number,
): KnownAgendaFilePage {
  const payload = record(value, "WPFD files response");
  const category = parseCategory(payload.category);
  if (expectedCategoryId !== undefined && category.id !== expectedCategoryId) {
    throw new Error(
      `WPFD category mismatch: expected ${expectedCategoryId}, received ${category.id}`,
    );
  }
  if (!Array.isArray(payload.files)) throw new Error("Invalid WPFD files list");
  const documents = payload.files.map((entry): KnownAgendaDocument => {
    const file = record(entry, "WPFD file");
    const fileId = integer(file.ID, "file id");
    const fileCategoryId = integer(file.catid, "file category id");
    if (fileCategoryId !== category.id) {
      throw new Error(
        `WPFD file ${fileId} belongs to category ${fileCategoryId}, not ${category.id}`,
      );
    }
    const title = requiredString(file.post_title, "file title");
    const downloadUrl = officialUrl(file.linkdownload, "download URL")!;
    const titleParts = parseKnownAgendaTitle(title);
    return {
      source: "dip-known-agenda",
      sourceId: `${category.id}:${fileId}`,
      sectionTitle: "Orden del día conocida por el pleno",
      categoryId: category.id,
      categoryTitle: requiredString(file.cattitle ?? category.title, "file category title"),
      fileId,
      title,
      slug: requiredString(file.post_name, "file slug"),
      extension: requiredString(file.ext, "file extension"),
      sessionNumber: titleParts.sessionNumber,
      sessionDate: titleParts.sessionDate,
      uploadedDate: extractLeadingISODate(
        typeof file.created_time === "string" ? file.created_time : null,
      ),
      modifiedDate: extractLeadingISODate(
        typeof file.modified_time === "string" ? file.modified_time : null,
      ),
      downloadUrl,
      previewUrl: officialUrl(file.openpdflink, "preview URL", true),
      initiativeCodes: [],
      raw: {
        payload: file,
        provenance: {
          sectionUrl: DIP_KNOWN_AGENDA_PAGE,
          metadataUrl,
          documentUrl: downloadUrl,
        },
      },
    };
  });
  return { category, documents };
}

export interface DipKnownAgendaOptions {
  ajaxUrl?: string;
  rootCategoryId?: number;
  fetchJson?: (url: string) => Promise<unknown>;
}

/** Metadata-only collector with exact-count pagination reconciliation. */
export class DipKnownAgendaAdapter {
  readonly source = "dip-known-agenda";
  private readonly ajaxUrl: string;
  private readonly rootCategoryId: number;
  private readonly readJson: (url: string) => Promise<unknown>;

  constructor(options: DipKnownAgendaOptions = {}) {
    this.ajaxUrl = options.ajaxUrl ?? DIP_KNOWN_AGENDA_AJAX;
    this.rootCategoryId = options.rootCategoryId ?? DIP_KNOWN_AGENDA_ROOT_CATEGORY_ID;
    this.readJson = options.fetchJson ?? ((url) => fetchJson<unknown>(url, { timeoutMs: 25_000 }));
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

  async catalog(): Promise<KnownAgendaCatalog> {
    const url = this.url({ task: "categories.getCategories", id: String(this.rootCategoryId) });
    const catalog = parseKnownAgendaCatalog(await this.readJson(url));
    if (catalog.sectionId !== this.rootCategoryId) {
      throw new Error(
        `WPFD root category mismatch: expected ${this.rootCategoryId}, received ${catalog.sectionId}`,
      );
    }
    return catalog;
  }

  async documentsInCategory(
    category: KnownAgendaCategory,
    options: { pageSize?: number } = {},
  ): Promise<KnownAgendaDocument[]> {
    const pageSize = options.pageSize ?? 100;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 500) {
      throw new Error(`Invalid WPFD page size: ${pageSize}`);
    }
    const documents = new Map<number, KnownAgendaDocument>();
    for (let page = 1; page <= 200 && documents.size < category.count; page++) {
      const url = this.url({
        task: "files.display",
        view: "files",
        id: String(category.id),
        rootcat: String(this.rootCategoryId),
        page: String(page),
        orderCol: category.ordering,
        orderDir: category.orderingDirection,
        page_limit: String(pageSize),
      });
      const parsed = parseKnownAgendaFilesPage(await this.readJson(url), url, category.id);
      if (parsed.category.count !== category.count) {
        throw new Error(
          `WPFD count changed for category ${category.id}: ${category.count} → ${parsed.category.count}`,
        );
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
        `WPFD incomplete category ${category.id}: expected ${category.count}, received ${documents.size} unique files`,
      );
    }
    return [...documents.values()];
  }
}
