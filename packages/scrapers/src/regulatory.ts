/**
 * Regulatory monitoring scrapers — the regulatory twin of the legislative adapters.
 *
 * Each DR regulatory institution publishes norms/resoluciones/reglamentos/NORDOM and,
 * crucially, **public consultations** of draft norms (where there's still room to
 * intervene). Adapters map each source into a canonical `RawRegulation`.
 *
 * Phase-1 adapters:
 *  - MispasAdapter        — MISPAS (Salud) official transparency WPFD catalog.
 *  - ProconsumidorAdapter — PROCONSUMIDOR public-consultations page (static HTML).
 *  - IndotelAdapter       — INDOTEL (telecom) WordPress JSON Feed: resoluciones + consulta pública.
 *  - IndocalAdapter       — INDOCAL (calidad/NORDOM) WPFD admin-ajax JSON: norms in consultation + resoluciones.
 *  - MicmAdapter          — MICM (industria/comercio) Joomla-ZOO category crawl: consultas abiertas + resoluciones.
 *  - IntrantAdapter       — INTRANT (transporte) official transparency pages.
 */
import { fetchJson, fetchText } from "./http.js";
import { buildISODate, extractLeadingISODate, spanishMonthToNum } from "./dates.js";

export interface RawRegulation {
  source: string; // adapter key, e.g. "reg-mispas"
  sourceId: string; // stable id within the source
  institution: string; // acronym, e.g. "MISPAS"
  regType: string | null; // Reglamento | Resolución | Norma | NORDOM | …
  title: string;
  status: string | null;
  /** Source-reported category only; null when the item payload has none. */
  sourceCategory: string | null;
  isConsulta: boolean;
  publishedAt: string | null; // ISO date
  deadline: string | null;
  url: string | null;
  raw: unknown;
}

/** Extract a regulation type only when the title literally names it. */
export function explicitRegTypeFromTitle(title: string): string | null {
  const t = title.toLowerCase();
  if (/nordom/.test(t)) return "NORDOM";
  if (/reglamento/.test(t)) return "Reglamento";
  if (/resoluci[oó]n\s+interna/.test(t)) return "Resolución Interna";
  if (/resoluci[oó]n/.test(t)) return "Resolución";
  if (/\bnorma/.test(t)) return "Norma";
  if (/pol[ií]tica/.test(t)) return "Política Pública";
  if (/\bplan\b/.test(t)) return "Plan";
  return null;
}

// --- tiny RSS reader (no XML dep) ---
export interface RssItem {
  title: string;
  link: string | null;
  date: string | null; // ISO
  description: string | null;
}

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  apos: "'",
  quot: '"',
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  ntilde: "ñ",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  Ntilde: "Ñ",
};

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const hexadecimal = entity[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (Number.isInteger(codePoint)) {
        try {
          return String.fromCodePoint(codePoint);
        } catch {
          return match;
        }
      }
      return match;
    }
    return HTML_ENTITIES[entity] ?? match;
  });
}

const strip = (s: string) =>
  decodeHtmlEntities(s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? strip(m[1]!) : null;
}
function isoFromRss(d: string | null): string | null {
  if (!d) return null;
  const m = d.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/); // "01 Nov 2025"
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  if (m) {
    const mm = months[m[2]!.slice(0, 3).toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1]!.padStart(2, "0")}`;
  }
  const iso = d.match(/(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1]! : null;
}

export async function readRss(url: string): Promise<RssItem[]> {
  const xml = await fetchText(url, {
    timeoutMs: 20_000,
    headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
  });
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => {
    const b = m[1]!;
    return {
      title: tag(b, "title") ?? "",
      link: tag(b, "link"),
      date: isoFromRss(tag(b, "pubDate") ?? tag(b, "dc:date")),
      description: tag(b, "description"),
    };
  });
}

interface MispasWpfdCategory {
  id: number;
  name: string;
  count: number;
}

/** Extract only populated, explicitly identified categories from the official WPFD tree. */
export function parseMispasWpfdCategories(payload: unknown): MispasWpfdCategory[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];

  const categories = new Map<number, MispasWpfdCategory>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const category = value as Record<string, unknown>;
    const id = Number(category.term_id);
    const count = Number(category.count);
    const name = typeof category.name === "string" ? cleanTitle(category.name) : "";
    if (Number.isSafeInteger(id) && id > 0 && Number.isSafeInteger(count) && count > 0 && name) {
      categories.set(id, { id, name, count });
    }
    if (Array.isArray(category.children)) category.children.forEach(visit);
  };
  data.forEach(visit);
  return [...categories.values()];
}

function wpfdLastPage(pagination: unknown): number {
  if (typeof pagination !== "string") return 1;
  let lastPage = 1;
  for (const match of pagination.matchAll(/\bdata-page=['"](\d+)['"]/gi)) {
    const page = Number(match[1]);
    if (Number.isSafeInteger(page) && page > lastPage && page <= 100) lastPage = page;
  }
  return lastPage;
}

function mispasWpfdFileUrl(host: string, file: WpfdFile): string | null {
  const id = Number(file.ID);
  const categoryId = Number(file.catid);
  const categorySlug = file.catname?.trim() ?? "";
  const fileSlug = file.post_name?.trim() ?? "";
  const extension = file.ext?.trim() ?? "";
  if (
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !Number.isSafeInteger(categoryId) ||
    categoryId <= 0 ||
    !/^[a-z0-9][a-z0-9-]*$/i.test(categorySlug) ||
    !/^[a-z0-9][a-z0-9-]*$/i.test(fileSlug) ||
    !/^[a-z0-9]{1,8}$/i.test(extension)
  ) {
    return null;
  }
  return `${host}/${file.seouri ?? "documentos_oai"}/${categoryId}/${categorySlug}/${id}/${fileSlug}.${extension}`;
}

/**
 * MISPAS (Ministerio de Salud Pública y Asistencia Social) — the official
 * Transparency portal's “Normas y Reglamentos Técnicos” category tree.
 *
 * The institutional repository omits a verifiable intermediate certificate in
 * Node's TLS path. The `www.msp.gob.do` origin is the ministry's primary portal,
 * exposes equivalent/current regulatory files, and validates without a TLS bypass.
 */
export class MispasAdapter {
  readonly source = "reg-mispas";
  readonly institution = "MISPAS";
  constructor(
    private readonly host = "https://www.msp.gob.do/web/Transparencia",
    private readonly rootCategoryId = 420,
    private readonly topCategoryId = 26,
  ) {}

  private ajax(params: Record<string, string | number>) {
    const query = new URLSearchParams({
      juwpfisadmin: "false",
      action: "wpfd",
      ...Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)])),
    });
    return `${this.host}/wp-admin/admin-ajax.php?${query.toString()}`;
  }

  private categoriesUrl() {
    return this.ajax({ task: "categories.getCats", dir: this.rootCategoryId });
  }

  private filesUrl(categoryId: number, page: number) {
    return this.ajax({
      task: "files.display",
      view: "files",
      id: categoryId,
      rootcat: this.topCategoryId,
      page,
      orderCol: "ordering",
      orderDir: "asc",
    });
  }

  async collect(): Promise<{ regulations: RawRegulation[]; gaps: string[] }> {
    const gaps: string[] = [];
    const treeUrl = this.categoriesUrl();
    const tree = await fetchJson<unknown>(treeUrl, { timeoutMs: 25_000 });
    const categories = parseMispasWpfdCategories(tree);
    if (categories.length === 0) {
      throw new Error("MISPAS · el catálogo oficial no publicó categorías con documentos.");
    }

    const filesById = new Map<number, { file: WpfdFile; category: MispasWpfdCategory }>();
    let successfulCategories = 0;
    for (const category of categories) {
      let firstPage: { files?: WpfdFile[]; pagination?: unknown };
      try {
        firstPage = await fetchJson(this.filesUrl(category.id, 1), { timeoutMs: 25_000 });
        successfulCategories++;
      } catch (error) {
        gaps.push(`MISPAS ${category.name} · ${(error as Error).message}`);
        continue;
      }

      const lastPage = wpfdLastPage(firstPage.pagination);
      const pages = [{ payload: firstPage }];
      for (let page = 2; page <= lastPage; page++) {
        try {
          pages.push({
            payload: await fetchJson(this.filesUrl(category.id, page), { timeoutMs: 25_000 }),
          });
        } catch (error) {
          gaps.push(
            `MISPAS ${category.name} página ${page}/${lastPage} · ${(error as Error).message}`,
          );
        }
      }

      let observedInCategory = 0;
      for (const { payload } of pages) {
        const files = Array.isArray(payload.files) ? payload.files : [];
        observedInCategory += files.length;
        for (const file of files) {
          const id = Number(file.ID);
          if (Number.isSafeInteger(id) && id > 0) filesById.set(id, { file, category });
        }
      }
      if (observedInCategory < category.count) {
        gaps.push(
          `MISPAS ${category.name}: ${observedInCategory}/${category.count} archivo(s) publicados fueron observados.`,
        );
      }
    }

    if (successfulCategories === 0) {
      throw new Error(gaps.join(" | ") || "MISPAS categories unavailable");
    }

    const regulations: RawRegulation[] = [];
    let missingTitles = 0;
    for (const { file, category } of filesById.values()) {
      const sourceTitle = cleanTitle(file.post_title ?? "");
      const description = cleanTitle(file.description ?? "");
      if (/^leyenda$/i.test(sourceTitle) && /no posee publicaciones oficiales/i.test(description)) {
        continue;
      }
      if (!sourceTitle) {
        missingTitles++;
        continue;
      }
      const title =
        description && description.localeCompare(sourceTitle, "es", { sensitivity: "base" }) !== 0
          ? `${sourceTitle}: ${description}`
          : sourceTitle;
      const sourceUrl = this.filesUrl(category.id, 1);
      regulations.push({
        source: this.source,
        sourceId: String(file.ID),
        institution: this.institution,
        regType: explicitRegTypeFromTitle(title),
        title,
        status: null,
        sourceCategory: category.name,
        isConsulta: false,
        publishedAt: extractLeadingISODate(file.created_time),
        deadline: null,
        url: mispasWpfdFileUrl(this.host, file),
        raw: {
          payload: file,
          provenance: {
            sourceUrl,
            officialSection: `Normas y Reglamentos Técnicos · ${category.name}`,
            categoryTree: treeUrl,
          },
        },
      });
    }

    if (missingTitles > 0) {
      gaps.push(`MISPAS · ${missingTitles} archivo(s) sin título explícito fueron descartados.`);
    }
    if (regulations.length === 0) {
      throw new Error(gaps.join(" | ") || "MISPAS · el catálogo oficial no publicó documentos.");
    }
    return { regulations, gaps };
  }
}

/** PROCONSUMIDOR — public-consultations page (draft resolutions open for comment). */
export class ProconsumidorAdapter {
  readonly source = "reg-proconsumidor";
  readonly institution = "PROCONSUMIDOR";
  constructor(private readonly page = "https://proconsumidor.gob.do/consultas-publicas/") {}

  async collect(): Promise<{ regulations: RawRegulation[]; gaps: string[] }> {
    const html = await fetchText(this.page, { timeoutMs: 20_000 });
    // Each consultation links a PDF of the draft resolution (skip the generic comment form).
    const links = [...html.matchAll(/href="([^"]+\.pdf)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((m) => ({ href: m[1]!, text: strip(m[2]!) }))
      .filter((l) => !/formulario/i.test(l.href));
    const base = "https://proconsumidor.gob.do";
    const regulations: RawRegulation[] = [];
    let missingTitles = 0;
    for (const l of links) {
      const url = l.href.startsWith("http")
        ? l.href
        : base + (l.href.startsWith("/") ? l.href : "/" + l.href);
      const title = (l.text || l.href.split("/").pop() || "")
        .replace(/[_-]+/g, " ")
        .replace(/\.pdf$/i, "")
        .trim();
      if (!title) {
        missingTitles++;
        continue;
      }
      regulations.push({
        source: this.source,
        sourceId: url,
        institution: this.institution,
        regType: explicitRegTypeFromTitle(title),
        title,
        status: null,
        sourceCategory: null,
        isConsulta: true,
        publishedAt: null,
        deadline: null,
        url,
        raw: {
          payload: l,
          provenance: { sourceUrl: this.page, officialSection: "Consultas públicas" },
        },
      });
    }
    const gaps: string[] = [];
    if (regulations.length === 0) {
      gaps.push("PROCONSUMIDOR · la página devolvió 0 documentos PDF de consulta.");
    }
    if (missingTitles) {
      gaps.push(
        `PROCONSUMIDOR · ${missingTitles} enlace(s) sin título explícito fueron descartados.`,
      );
    }
    return { regulations, gaps };
  }
}

// --- shared helpers for the structured adapters below ---
const cleanTitle = (t: string) => strip(t).replace(/\s+/g, " ").trim();
const uniq = <T>(a: T[]): T[] => [...new Set(a)];

/** "Martes, 28 Junio 2026" → "2026-06-28" (Joomla/ZOO "Fecha de subida"). */
function parseSpanishLongDate(s: string): string | null {
  const m = s.match(/(\d{1,2})\s+([A-Za-zñÑáéíóúÁÉÍÓÚ]+)\s+(\d{4})/);
  if (!m) return null;
  const mm = spanishMonthToNum(m[2]!);
  return mm ? buildISODate(m[1]!, mm, m[3]!) : null;
}

/** From a Joomla/ZOO category index, return the path of the category with the
 *  highest year. `re` must capture [fullPath, yearString]. */
function latestCategory(html: string, re: RegExp): string | null {
  let best: { year: number; path: string } | null = null;
  for (const m of html.matchAll(re)) {
    const year = Number(m[2]);
    if (!Number.isFinite(year)) continue;
    if (!best || year > best.year) best = { year, path: m[1]! };
  }
  return best?.path ?? null;
}

interface ZooArticle {
  title: string;
  url: string | null;
  date: string | null;
}
/** Parse `<article class="uk-article">` items from a ZOO leaf page (title in
 *  <strong>, document in the first .pdf link, optional "Fecha de subida"). */
function parseZooArticles(html: string, host: string): ZooArticle[] {
  const out: ZooArticle[] = [];
  for (const m of html.matchAll(/<article class="uk-article">([\s\S]*?)<\/article>/gi)) {
    const block = m[1]!;
    const tm = block.match(/<strong[^>]*>\s*(?:<i[^>]*><\/i>)?\s*([\s\S]*?)<\/strong>/i);
    const title = tm ? cleanTitle(tm[1]!) : "";
    if (!title) continue;
    const pm = block.match(/href="([^"]+\.pdf)"/i);
    let url: string | null = pm ? pm[1]! : null;
    if (url && !/^https?:/i.test(url)) url = host + (url.startsWith("/") ? url : "/" + url);
    const dm = block.match(/Fecha de subida:\s*([^<]+)/i);
    out.push({ title, url, date: dm ? parseSpanishLongDate(dm[1]!) : null });
  }
  return out;
}

// --- INDOTEL (telecomunicaciones) ---
interface JsonFeedItem {
  id?: string;
  url?: string;
  title?: string;
  date_published?: string;
}
async function readJsonFeed(url: string): Promise<JsonFeedItem[]> {
  const d = await fetchJson<{ items?: JsonFeedItem[] }>(url, {
    timeoutMs: 20_000,
    headers: { Accept: "application/feed+json, application/json, */*" },
  });
  return d.items ?? [];
}

/** INDOTEL — WordPress JSON Feed of resoluciones + consultas públicas (no JS needed). */
export class IndotelAdapter {
  readonly source = "reg-indotel";
  readonly institution = "INDOTEL";
  constructor(
    private readonly feeds = {
      consultas: "https://indotel.gob.do/transparencia/documentos/consulta-publica/feed/json/",
      resoluciones: "https://indotel.gob.do/transparencia/documentos/resoluciones/feed/json/",
    },
  ) {}

  async collect(): Promise<{ regulations: RawRegulation[]; gaps: string[] }> {
    const gaps: string[] = [];
    const regulations: RawRegulation[] = [];
    const groups = [
      { url: this.feeds.consultas, isConsulta: true, label: "consultas" },
      { url: this.feeds.resoluciones, isConsulta: false, label: "resoluciones" },
    ];
    let successfulFeeds = 0;
    for (const g of groups) {
      let items: JsonFeedItem[] = [];
      try {
        items = await readJsonFeed(g.url);
        successfulFeeds++;
      } catch (err) {
        gaps.push(`INDOTEL ${g.label} · ${(err as Error).message}`);
        continue;
      }
      for (const it of items) {
        if (!it.title) continue;
        regulations.push({
          source: this.source,
          sourceId: it.id ?? it.url ?? it.title,
          institution: this.institution,
          regType: explicitRegTypeFromTitle(it.title),
          title: cleanTitle(it.title),
          status: null,
          sourceCategory: null,
          isConsulta: g.isConsulta,
          publishedAt: extractLeadingISODate(it.date_published),
          deadline: null,
          url: it.url ?? null,
          raw: {
            payload: it,
            provenance: {
              sourceUrl: g.url,
              officialSection: g.isConsulta ? "Consulta pública" : "Resoluciones",
            },
          },
        });
      }
    }
    if (successfulFeeds === 0) throw new Error(gaps.join(" | ") || "INDOTEL feeds unavailable");
    return { regulations, gaps };
  }
}

// --- INDOCAL (calidad / NORDOM) ---
interface WpfdFile {
  ID: number;
  post_title?: string;
  post_name?: string;
  description?: string;
  ext?: string;
  created_time?: string;
  catname?: string;
  catid?: string | number;
  seouri?: string;
}
/** INDOCAL — WPFD (WordPress File Download) admin-ajax JSON: NORDOM en consulta + resoluciones.
 *  Consultation rounds roll over to new category ids (3948 = "2da 2026"); a 0-file
 *  result is surfaced as a gap so we notice when the round id changes. */
export class IndocalAdapter {
  readonly source = "reg-indocal";
  readonly institution = "INDOCAL";
  constructor(
    private readonly host = "https://indocal.gob.do",
    private readonly categories = [
      { id: 3948, isConsulta: true, officialSection: "Normas en consulta" },
      { id: 2047, isConsulta: false, officialSection: "Resoluciones" },
    ],
  ) {}

  private ajax(id: number) {
    return `${this.host}/wp-admin/admin-ajax.php?juwpfisadmin=false&action=wpfd&task=files.display&id=${id}`;
  }

  async collect(): Promise<{ regulations: RawRegulation[]; gaps: string[] }> {
    const gaps: string[] = [];
    const regulations: RawRegulation[] = [];
    let successfulCategories = 0;
    for (const c of this.categories) {
      let files: WpfdFile[] = [];
      try {
        const d = await fetchJson<{ files?: WpfdFile[] }>(this.ajax(c.id), { timeoutMs: 25_000 });
        files = d.files ?? [];
        successfulCategories++;
      } catch (err) {
        gaps.push(`INDOCAL cat ${c.id} · ${(err as Error).message}`);
        continue;
      }
      if (!files.length) gaps.push(`INDOCAL cat ${c.id}: la fuente devolvió 0 archivos.`);
      for (const f of files) {
        if (!f.post_title) continue;
        const url =
          f.catid && f.catname && f.post_name
            ? `${this.host}/${f.seouri ?? "download"}/${f.catid}/${f.catname}/${f.ID}/${f.post_name}.${f.ext ?? "pdf"}`
            : null;
        regulations.push({
          source: this.source,
          sourceId: String(f.ID),
          institution: this.institution,
          regType: explicitRegTypeFromTitle(f.post_title),
          title: cleanTitle(f.post_title),
          status: null,
          sourceCategory: null,
          isConsulta: c.isConsulta,
          publishedAt: extractLeadingISODate(f.created_time),
          deadline: null,
          url,
          raw: {
            payload: f,
            provenance: {
              sourceUrl: this.ajax(c.id),
              officialSection: f.catname ?? c.officialSection,
            },
          },
        });
      }
    }
    if (successfulCategories === 0) {
      throw new Error(gaps.join(" | ") || "INDOCAL categories unavailable");
    }
    return { regulations, gaps };
  }
}

// --- MICM (industria y comercio) ---
/** MICM — Joomla/ZOO transparency portal. No flat endpoint: crawl index → latest
 *  year category → leaf articles; consultas nest one more level (year → months). */
export class MicmAdapter {
  readonly source = "reg-micm";
  readonly institution = "MICM";
  constructor(
    private readonly host = "https://micm.gob.do",
    private readonly resolucionesIndex = "https://micm.gob.do/transparencia/base-legal-de-la-institucion/resoluciones",
    private readonly consultasIndex = "https://micm.gob.do/transparencia/consultas-publicas-transparencia/proceso-de-consultas-abiertas",
  ) {}

  async collect(): Promise<{ regulations: RawRegulation[]; gaps: string[] }> {
    const gaps: string[] = [];
    const regulations: RawRegulation[] = [];
    let successfulBranches = 0;

    // Resoluciones: index → latest "resoluciones-YYYY" → leaf articles.
    try {
      const idx = await fetchText(this.resolucionesIndex, { timeoutMs: 25_000 });
      const yearCat = latestCategory(
        idx,
        /href="(\/transparencia\/[^"]*\/category\/resoluciones-(\d{4}))"/gi,
      );
      if (!yearCat) gaps.push("MICM resoluciones: no se halló categoría por año.");
      else {
        const leaf = await fetchText(this.host + yearCat, { timeoutMs: 25_000 });
        successfulBranches++;
        for (const a of parseZooArticles(leaf, this.host)) {
          regulations.push({
            source: this.source,
            sourceId: a.url ?? a.title,
            institution: this.institution,
            regType: explicitRegTypeFromTitle(a.title),
            title: a.title,
            status: null,
            sourceCategory: null,
            isConsulta: false,
            publishedAt: a.date,
            deadline: null,
            url: a.url,
            raw: {
              payload: a,
              provenance: {
                sourceUrl: this.host + yearCat,
                officialSection: "Resoluciones",
              },
            },
          });
        }
      }
    } catch (err) {
      gaps.push(`MICM resoluciones · ${(err as Error).message}`);
    }

    // Consultas abiertas: index → latest "YYYY-N" → month subcategories → leaf articles.
    try {
      const idx = await fetchText(this.consultasIndex, { timeoutMs: 25_000 });
      const yearCat = latestCategory(
        idx,
        /href="(\/transparencia\/[^"]*\/proceso-de-consultas-abiertas\/category\/(\d{4})-\d+)"/gi,
      );
      if (!yearCat) gaps.push("MICM consultas: no se halló categoría por año.");
      else {
        const yearPage = await fetchText(this.host + yearCat, { timeoutMs: 25_000 });
        const months = uniq(
          [
            ...yearPage.matchAll(
              /href="(\/transparencia\/[^"]*\/proceso-de-consultas-abiertas\/category\/[a-zñ]+-\d+)"/gi,
            ),
          ].map((m) => m[1]!),
        );
        if (months.length === 0) {
          gaps.push("MICM consultas: la categoría anual no contiene meses.");
        }
        for (const mUrl of months) {
          let leaf: string;
          try {
            leaf = await fetchText(this.host + mUrl, { timeoutMs: 20_000 });
            successfulBranches++;
          } catch (err) {
            gaps.push(`MICM consulta mes ${mUrl} · ${(err as Error).message}`);
            continue;
          }
          for (const a of parseZooArticles(leaf, this.host)) {
            regulations.push({
              source: this.source,
              sourceId: a.url ?? a.title,
              institution: this.institution,
              regType: explicitRegTypeFromTitle(a.title),
              title: a.title,
              status: null,
              sourceCategory: null,
              isConsulta: true,
              publishedAt: a.date,
              deadline: null,
              url: a.url,
              raw: {
                payload: a,
                provenance: {
                  sourceUrl: this.host + mUrl,
                  officialSection: "Proceso de consultas abiertas",
                },
              },
            });
          }
        }
      }
    } catch (err) {
      gaps.push(`MICM consultas · ${(err as Error).message}`);
    }

    if (successfulBranches === 0) {
      throw new Error(gaps.join(" | ") || "MICM branches unavailable");
    }
    return { regulations, gaps };
  }
}

// --- INTRANT (transporte) ---
export interface IntrantDocument {
  title: string;
  url: string;
  /** Exact date text printed by the source. */
  dateText: string | null;
  /** Exact file-type text printed by the source. */
  fileType: string | null;
}

/** Parse document cards rendered by the official INTRANT transparency template. */
export function parseIntrantDocuments(html: string, pageUrl: string): IntrantDocument[] {
  const documents: IntrantDocument[] = [];
  const blocks = html.split(/<div\b[^>]*class=["'][^"']*\barchivo-card\b[^"']*["'][^>]*>/gi);
  for (const block of blocks.slice(1)) {
    const titleMatch = block.match(
      /<div\b[^>]*class=["'][^"']*\barchivo-title\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    );
    const anchor = [...block.matchAll(/<a\b([^>]*)>/gi)].find((match) =>
      /\bclass=["'][^"']*\bbtn-descargar\b/i.test(match[1]!),
    );
    const hrefMatch = anchor?.[1]?.match(/\bhref=["']([^"']+)["']/i);
    const title = titleMatch ? strip(titleMatch[1]!) : "";
    if (!title || !hrefMatch) continue;
    let url: string;
    try {
      url = new URL(decodeHtmlEntities(hrefMatch[1]!), pageUrl).toString();
    } catch {
      continue;
    }
    const dateMatch = block.match(
      /<span\b[^>]*class=["'][^"']*\barchivo-fecha\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    );
    const typeMatch = block.match(
      /<span\b[^>]*class=["'][^"']*\barchivo-tipo\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    );
    documents.push({
      title,
      url,
      dateText: dateMatch ? strip(dateMatch[1]!) || null : null,
      fileType: typeMatch ? strip(typeMatch[1]!) || null : null,
    });
  }
  return documents;
}

/** INTRANT — documents rendered on its official transparency pages. */
export class IntrantAdapter {
  readonly source = "reg-intrant";
  readonly institution = "INTRANT";
  constructor(
    private readonly sections = [
      {
        url: "https://intrant.gob.do/transparencia/marco-legal-del-sistema-de-transparencia/resoluciones-y-reglamentos/resoluciones-resoluciones-marco-legal-de-transparencia",
        label: "Resoluciones",
      },
      {
        url: "https://intrant.gob.do/transparencia/marco-legal-del-sistema-de-transparencia/resoluciones-y-reglamentos/reglamentos",
        label: "Reglamentos",
      },
      {
        url: "https://intrant.gob.do/transparencia/marco-legal-del-sistema-de-transparencia/normativas",
        label: "Normativas",
      },
    ],
    private readonly perSection = 25,
  ) {}

  async collect(): Promise<{ regulations: RawRegulation[]; gaps: string[] }> {
    const gaps: string[] = [];
    const regulations: RawRegulation[] = [];
    let successfulSections = 0;
    for (const s of this.sections) {
      let docs: IntrantDocument[] = [];
      try {
        const html = await fetchText(s.url, { timeoutMs: 30_000 });
        docs = parseIntrantDocuments(html, s.url);
        successfulSections++;
      } catch (err) {
        gaps.push(`INTRANT ${s.label} · ${(err as Error).message}`);
        continue;
      }
      if (!docs.length) gaps.push(`INTRANT ${s.label}: la fuente devolvió 0 documentos.`);
      const items = docs
        .sort((a, b) => (b.dateText ?? "").localeCompare(a.dateText ?? ""))
        .slice(0, this.perSection);
      for (const doc of items) {
        regulations.push({
          source: this.source,
          sourceId: doc.url,
          institution: this.institution,
          regType: explicitRegTypeFromTitle(doc.title),
          title: doc.title,
          status: null,
          sourceCategory: null,
          isConsulta: false,
          publishedAt: parseSpanishLongDate(doc.dateText ?? ""),
          deadline: null,
          url: doc.url,
          raw: {
            payload: doc,
            provenance: {
              sourceUrl: s.url,
              officialSection: s.label,
            },
          },
        });
      }
    }
    if (successfulSections === 0) {
      throw new Error(gaps.join(" | ") || "INTRANT sections unavailable");
    }
    const deduplicated = [...new Map(regulations.map((item) => [item.sourceId, item])).values()];
    return { regulations: deduplicated, gaps };
  }
}

/** Registry of available regulatory adapters (extend as more institutions are added). */
export function regulatoryAdapters() {
  return [
    new MispasAdapter(),
    new ProconsumidorAdapter(),
    new IndotelAdapter(),
    new IndocalAdapter(),
    new MicmAdapter(),
    new IntrantAdapter(),
  ];
}
