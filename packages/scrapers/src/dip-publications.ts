/**
 * Literal document inventories published in four Cámara de Diputados sections.
 *
 * The adapter stores the official title, dates, category and download URL only.
 * A file appearing under a section is not converted into a legislative status.
 * This is particularly important for the "Iniciativas Aprobadas" landing page,
 * whose current two files are titled "Iniciativas Priorizadas".
 */
import { extractLeadingISODate } from "./dates.js";
import { fetchJson } from "./http.js";

const DIP_HOST = "camaradediputados.gob.do";
const DIP_AJAX = `https://${DIP_HOST}/wp-admin/admin-ajax.php`;

export type DipPublicationKind =
  | "APPROVED_INITIATIVES_INDEX"
  | "SESSION_MINUTES"
  | "SESSION_DEBATES"
  | "SESSION_ATTENDANCE";

export interface DipPublicationSource {
  kind: DipPublicationKind;
  sourceId: string;
  label: string;
  pageUrl: string;
  rootCategoryId: number;
}

export const DIP_PUBLICATION_SOURCES: readonly DipPublicationSource[] = [
  {
    kind: "APPROVED_INITIATIVES_INDEX",
    sourceId: "dip-approved",
    label: "Iniciativas aprobadas por la Cámara",
    pageUrl: `https://${DIP_HOST}/iniciativas-aprobadas/`,
    rootCategoryId: 147,
  },
  {
    kind: "SESSION_MINUTES",
    sourceId: "dip-minutes",
    label: "Actas de sesiones de la Cámara",
    pageUrl: `https://${DIP_HOST}/actas/`,
    rootCategoryId: 141,
  },
  {
    kind: "SESSION_DEBATES",
    sourceId: "dip-debates",
    label: "Debates de la Cámara",
    pageUrl: `https://${DIP_HOST}/debates-de-sesiones/`,
    rootCategoryId: 144,
  },
  {
    kind: "SESSION_ATTENDANCE",
    sourceId: "dip-attendance",
    label: "Asistencia a sesiones de la Cámara",
    pageUrl: `https://${DIP_HOST}/asistencia/`,
    rootCategoryId: 145,
  },
] as const;

type JsonRecord = Record<string, unknown>;

export interface DipPublicationCategory {
  id: number;
  title: string;
  slug: string;
  count: number;
  ordering: string;
  orderingDirection: string;
}

export interface DipPublicationCatalog {
  source: DipPublicationSource;
  root: DipPublicationCategory;
  categories: DipPublicationCategory[];
  declaredDocumentCount: number;
}

export interface DipPublishedDocument {
  source: "dip-publications";
  kind: DipPublicationKind;
  sourceId: string;
  fileId: number;
  categoryId: number;
  categoryTitle: string;
  title: string;
  slug: string;
  extension: string;
  sizeBytes: number | null;
  uploadedOn: string | null;
  modifiedOn: string | null;
  pageUrl: string;
  downloadUrl: string;
  previewUrl: string | null;
  raw: JsonRecord;
}

export interface DipPublicationObservation {
  kind: DipPublicationKind;
  sourceId: string;
  pageUrl: string;
  rootCategoryId: number;
  categoryCount: number;
  reportedCount: number;
  collectedCount: number;
  complete: boolean;
}

export interface DipPublicationCollection {
  documents: DipPublishedDocument[];
  observations: DipPublicationObservation[];
  gaps: string[];
}

export interface DipPublicationTransport {
  json(url: string): Promise<unknown>;
}

const defaultTransport: DipPublicationTransport = {
  json: (url) => fetchJson<unknown>(url, { timeoutMs: 30_000 }),
};

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Cámara · ${label}: se esperaba un objeto JSON`);
  }
  return value as JsonRecord;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Cámara · ${label}: falta texto obligatorio`);
  }
  return value.trim();
}

function integer(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Cámara · ${label}: entero inválido (${String(value)})`);
  }
  return parsed;
}

function optionalInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function officialUrl(value: unknown, label: string, optional = false): string | null {
  if (optional && (value === null || value === undefined || value === "")) return null;
  const raw = nonEmptyString(value, label);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Cámara · ${label}: URL inválida (${raw})`);
  }
  if (url.protocol !== "https:" || url.hostname !== DIP_HOST) {
    throw new Error(`Cámara · ${label}: URL no oficial (${raw})`);
  }
  return url.toString();
}

function parseCategory(value: unknown): DipPublicationCategory {
  const category = record(value, "categoría WPFD");
  return {
    id: integer(category.term_id ?? category.termID, "id de categoría"),
    title: nonEmptyString(category.name, "nombre de categoría"),
    slug: nonEmptyString(category.slug, "slug de categoría"),
    count: integer(category.count, "conteo de categoría"),
    ordering:
      typeof category.ordering === "string" && category.ordering.trim()
        ? category.ordering
        : "ordering",
    orderingDirection:
      typeof category.orderingdir === "string" && category.orderingdir.trim()
        ? category.orderingdir
        : "asc",
  };
}

export function parseDipPublicationCatalog(
  value: unknown,
  source: DipPublicationSource,
): DipPublicationCatalog {
  const payload = record(value, `${source.label} · catálogo WPFD`);
  const root = parseCategory(payload.category);
  if (root.id !== source.rootCategoryId) {
    throw new Error(
      `Cámara · ${source.label}: categoría raíz ${root.id}, esperada ${source.rootCategoryId}`,
    );
  }
  if (!Array.isArray(payload.categories)) {
    throw new Error(`Cámara · ${source.label}: falta la lista de categorías WPFD`);
  }
  const categories = payload.categories.map(parseCategory);
  const ids = [root.id, ...categories.map((category) => category.id)];
  if (new Set(ids).size !== ids.length) {
    throw new Error(`Cámara · ${source.label}: el catálogo repite categorías`);
  }
  return {
    source,
    root,
    categories,
    declaredDocumentCount:
      root.count + categories.reduce((sum, category) => sum + category.count, 0),
  };
}

export function parseDipPublicationFilesPage(
  value: unknown,
  source: DipPublicationSource,
  expectedCategory: DipPublicationCategory,
): DipPublishedDocument[] {
  const payload = record(value, `${source.label} · archivos WPFD`);
  const category = parseCategory(payload.category);
  if (category.id !== expectedCategory.id || category.count !== expectedCategory.count) {
    throw new Error(
      `Cámara · ${source.label}: la categoría ${expectedCategory.id} cambió durante la paginación`,
    );
  }
  if (!Array.isArray(payload.files)) {
    throw new Error(`Cámara · ${source.label}: falta la lista de archivos WPFD`);
  }
  return payload.files.map((value): DipPublishedDocument => {
    const file = record(value, `${source.label} · archivo WPFD`);
    const fileId = integer(file.ID, "id de archivo");
    const categoryId = integer(file.catid, "categoría del archivo");
    if (categoryId !== expectedCategory.id) {
      throw new Error(
        `Cámara · ${source.label}: archivo ${fileId} pertenece a ${categoryId}, no a ${expectedCategory.id}`,
      );
    }
    return {
      source: "dip-publications",
      kind: source.kind,
      sourceId: `${categoryId}:${fileId}`,
      fileId,
      categoryId,
      categoryTitle:
        typeof file.cattitle === "string" && file.cattitle.trim()
          ? file.cattitle.trim()
          : expectedCategory.title,
      title: nonEmptyString(file.post_title, "título del archivo"),
      slug: nonEmptyString(file.post_name, "slug del archivo"),
      extension: nonEmptyString(file.ext, "extensión del archivo").toLowerCase(),
      sizeBytes: optionalInteger(file.size),
      uploadedOn: extractLeadingISODate(
        typeof file.created_time === "string" ? file.created_time : null,
      ),
      modifiedOn: extractLeadingISODate(
        typeof file.modified_time === "string" ? file.modified_time : null,
      ),
      pageUrl: source.pageUrl,
      downloadUrl: officialUrl(file.linkdownload, "URL de descarga")!,
      previewUrl: officialUrl(file.openpdflink, "URL de vista previa", true),
      raw: file,
    };
  });
}

export class DipPublicationsAdapter {
  readonly source = "dip-publications";

  constructor(private readonly transport: DipPublicationTransport = defaultTransport) {}

  private url(params: Record<string, string>): string {
    const url = new URL(DIP_AJAX);
    url.search = new URLSearchParams({
      juwpfisadmin: "false",
      action: "wpfd",
      ...params,
    }).toString();
    return url.toString();
  }

  async catalog(kind: DipPublicationKind): Promise<DipPublicationCatalog> {
    const source = DIP_PUBLICATION_SOURCES.find((candidate) => candidate.kind === kind);
    if (!source) throw new Error(`Cámara · colección desconocida (${kind})`);
    const url = this.url({
      task: "categories.getCategories",
      id: String(source.rootCategoryId),
    });
    return parseDipPublicationCatalog(await this.transport.json(url), source);
  }

  private async documentsInCategory(
    source: DipPublicationSource,
    category: DipPublicationCategory,
  ): Promise<DipPublishedDocument[]> {
    const documents = new Map<number, DipPublishedDocument>();
    for (let page = 1; page <= 200 && documents.size < category.count; page++) {
      const url = this.url({
        task: "files.display",
        view: "files",
        id: String(category.id),
        rootcat: String(source.rootCategoryId),
        page: String(page),
        orderCol: category.ordering,
        orderDir: category.orderingDirection,
        page_limit: "100",
      });
      const pageDocuments = parseDipPublicationFilesPage(
        await this.transport.json(url),
        source,
        category,
      );
      const before = documents.size;
      for (const document of pageDocuments) {
        if (documents.has(document.fileId)) {
          throw new Error(
            `Cámara · ${source.label}: archivo duplicado ${document.fileId} en ${category.id}`,
          );
        }
        documents.set(document.fileId, document);
      }
      if (documents.size === before && documents.size < category.count) {
        throw new Error(
          `Cámara · ${source.label}: paginación sin avance en categoría ${category.id}`,
        );
      }
    }
    if (documents.size !== category.count) {
      throw new Error(
        `Cámara · ${source.label}: categoría ${category.id} incompleta (${documents.size}/${category.count})`,
      );
    }
    return [...documents.values()];
  }

  async collect(kinds: readonly DipPublicationKind[] = DIP_PUBLICATION_SOURCES.map((s) => s.kind)) {
    const selected = new Set(kinds);
    const documents: DipPublishedDocument[] = [];
    const observations: DipPublicationObservation[] = [];
    const gaps: string[] = [];

    for (const source of DIP_PUBLICATION_SOURCES) {
      if (!selected.has(source.kind)) continue;
      const catalog = await this.catalog(source.kind);
      const categories = [
        ...(catalog.root.count > 0 ? [catalog.root] : []),
        ...catalog.categories.filter((category) => category.count > 0),
      ];
      const sourceDocuments: DipPublishedDocument[] = [];
      for (const category of categories) {
        sourceDocuments.push(...(await this.documentsInCategory(source, category)));
      }
      const fileIds = sourceDocuments.map((document) => document.fileId);
      if (new Set(fileIds).size !== fileIds.length) {
        throw new Error(`Cámara · ${source.label}: un archivo aparece en múltiples categorías`);
      }
      const complete = sourceDocuments.length === catalog.declaredDocumentCount;
      if (!complete) {
        gaps.push(
          `Cámara · ${source.label}: ${sourceDocuments.length}/${catalog.declaredDocumentCount} documentos reconciliados.`,
        );
      }
      documents.push(...sourceDocuments);
      observations.push({
        kind: source.kind,
        sourceId: source.sourceId,
        pageUrl: source.pageUrl,
        rootCategoryId: source.rootCategoryId,
        categoryCount: categories.length,
        reportedCount: catalog.declaredDocumentCount,
        collectedCount: sourceDocuments.length,
        complete,
      });
    }
    return { documents, observations, gaps } satisfies DipPublicationCollection;
  }
}
