/**
 * Regulatory monitoring scrapers — the regulatory twin of the legislative adapters.
 *
 * Each DR regulatory institution publishes norms/resoluciones/reglamentos/NORDOM and,
 * crucially, **public consultations** of draft norms (where there's still room to
 * intervene). Adapters map each source into a canonical `RawRegulation`.
 *
 * Phase-1 adapters (the two easiest, both reachable over plain HTTP):
 *  - MispasAdapter        — MISPAS (Salud) DSpace RSS feed of technical regulations.
 *  - ProconsumidorAdapter — PROCONSUMIDOR public-consultations page (static HTML).
 *  - IndotelAdapter       — INDOTEL (telecom) WordPress JSON Feed: resoluciones + consulta pública.
 *  - IndocalAdapter       — INDOCAL (calidad/NORDOM) WPFD admin-ajax JSON: norms in consultation + resoluciones.
 *  - MicmAdapter          — MICM (industria/comercio) Joomla-ZOO category crawl: consultas abiertas + resoluciones.
 *  - IntrantAdapter       — INTRANT (transporte) headless-WP GraphQL: resoluciones + normativas.
 */
import { fetchJson, fetchText } from "./http.js";
import { buildISODate, spanishMonthToNum } from "./dates.js";
// Reuse the feed module's rich RSS reader + HTML helpers (entity decoding included)
// instead of carrying a duplicate mini reader that let encoded titles through raw.
import { readRichRss, stripHtml } from "./feeds.js";

export interface RawRegulation {
  source: string; // adapter key, e.g. "reg-mispas"
  sourceId: string; // stable id within the source
  institution: string; // acronym, e.g. "MISPAS"
  regType: string | null; // Reglamento | Resolución | Norma | NORDOM | …
  title: string;
  status: string | null;
  /** HIGH (draft/consulta — influenceable) … LOW (published — too late). */
  interventionLevel: "HIGH" | "INTERMEDIATE" | "LOW" | null;
  category: string | null;
  isConsulta: boolean;
  publishedAt: string | null; // ISO date
  deadline: string | null;
  url: string | null;
  raw: unknown;
}

/** Infer the regulation type from a title. */
export function inferRegType(title: string): string | null {
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

/** Map a regulatory status/consulta flag → possibility-of-intervention level. */
export function interventionFor(status: string | null, isConsulta: boolean): RawRegulation["interventionLevel"] {
  const s = (status ?? "").toLowerCase();
  if (isConsulta || /borrador|consulta|draft|anteproyecto/.test(s)) return "HIGH";
  if (/revisi[oó]n|interna|observaci/.test(s)) return "INTERMEDIATE";
  if (/publicad|vigente|promulgad/.test(s)) return "LOW";
  return isConsulta ? "HIGH" : "LOW";
}

/** MISPAS (Ministerio de Salud Pública) — DSpace RSS of technical regulations. */
export class MispasAdapter {
  readonly source = "reg-mispas";
  readonly institution = "MISPAS";
  constructor(private readonly feed = "https://repositorio.msp.gob.do/feed/rss_2.0/123456789/13") {}

  async collect(): Promise<{ regulations: RawRegulation[]; gaps: string[] }> {
    const items = await readRichRss(this.feed);
    const regulations = items
      .filter((i) => i.title)
      .map((i): RawRegulation => {
        const status = "Norma/Reglamento Publicado";
        return {
          source: this.source,
          sourceId: i.link ?? i.title,
          institution: this.institution,
          regType: inferRegType(i.title),
          title: i.title,
          status,
          interventionLevel: interventionFor(status, false),
          category: "SALUD",
          isConsulta: false,
          publishedAt: isoDate(i.publishedAt),
          deadline: null,
          url: i.link,
          raw: i,
        };
      });
    return { regulations, gaps: [] };
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
      .map((m) => ({ href: m[1]!, text: stripHtml(m[2]!) }))
      .filter((l) => !/formulario/i.test(l.href));
    const base = "https://proconsumidor.gob.do";
    const regulations = links.map((l): RawRegulation => {
      const url = l.href.startsWith("http") ? l.href : base + (l.href.startsWith("/") ? l.href : "/" + l.href);
      const title = (l.text || l.href.split("/").pop() || "").replace(/[_-]+/g, " ").replace(/\.pdf$/i, "").trim();
      const status = "Consulta Pública";
      return {
        source: this.source,
        sourceId: url,
        institution: this.institution,
        regType: inferRegType(title) ?? "Resolución",
        title: title || "Consulta pública",
        status,
        interventionLevel: interventionFor(status, true),
        category: null,
        isConsulta: true,
        publishedAt: null,
        deadline: null,
        url,
        raw: l,
      };
    });
    return { regulations, gaps: regulations.length ? [] : ["PROCONSUMIDOR · no se hallaron consultas (revisar selector)."] };
  }
}

// --- shared helpers for the structured adapters below ---
const cleanTitle = (t: string) => stripHtml(t);
const isoDate = (s?: string | null): string | null => {
  const m = (s ?? "").match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
};
const uniq = <T,>(a: T[]): T[] => [...new Set(a)];

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

interface ZooArticle { title: string; url: string | null; date: string | null; }
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
interface JsonFeedItem { id?: string; url?: string; title?: string; date_published?: string }
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
    for (const g of groups) {
      let items: JsonFeedItem[] = [];
      try {
        items = await readJsonFeed(g.url);
      } catch (err) {
        gaps.push(`INDOTEL ${g.label} · ${(err as Error).message}`);
        continue;
      }
      for (const it of items) {
        if (!it.title) continue;
        const status = g.isConsulta ? "Consulta Pública" : "Resolución publicada";
        regulations.push({
          source: this.source,
          sourceId: it.id ?? it.url ?? it.title,
          institution: this.institution,
          regType: inferRegType(it.title) ?? (g.isConsulta ? "Consulta" : "Resolución"),
          title: cleanTitle(it.title),
          status,
          interventionLevel: interventionFor(status, g.isConsulta),
          category: "TELECOMUNICACIONES",
          isConsulta: g.isConsulta,
          publishedAt: isoDate(it.date_published),
          deadline: null,
          url: it.url ?? null,
          raw: it,
        });
      }
    }
    return { regulations, gaps };
  }
}

// --- INDOCAL (calidad / NORDOM) ---
interface WpfdFile {
  ID: number; post_title?: string; post_name?: string; ext?: string;
  created_time?: string; catname?: string; catid?: string; seouri?: string;
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
      { id: 3948, isConsulta: true, category: "NORMAS EN CONSULTA" },
      { id: 2047, isConsulta: false, category: "RESOLUCIONES" },
    ],
  ) {}

  private ajax(id: number) {
    return `${this.host}/wp-admin/admin-ajax.php?juwpfisadmin=false&action=wpfd&task=files.display&id=${id}`;
  }

  async collect(): Promise<{ regulations: RawRegulation[]; gaps: string[] }> {
    const gaps: string[] = [];
    const regulations: RawRegulation[] = [];
    for (const c of this.categories) {
      let files: WpfdFile[] = [];
      try {
        const d = await fetchJson<{ files?: WpfdFile[] }>(this.ajax(c.id), { timeoutMs: 25_000 });
        files = d.files ?? [];
      } catch (err) {
        gaps.push(`INDOCAL cat ${c.id} · ${(err as Error).message}`);
        continue;
      }
      if (!files.length) gaps.push(`INDOCAL cat ${c.id} sin archivos (¿cambió el id de la ronda de consulta?).`);
      for (const f of files) {
        if (!f.post_title) continue;
        const status = c.isConsulta ? "Consulta Pública" : "Resolución/Norma publicada";
        const url =
          f.catid && f.catname && f.post_name
            ? `${this.host}/${f.seouri ?? "download"}/${f.catid}/${f.catname}/${f.ID}/${f.post_name}.${f.ext ?? "pdf"}`
            : null;
        regulations.push({
          source: this.source,
          sourceId: String(f.ID),
          institution: this.institution,
          regType: inferRegType(f.post_title) ?? (c.isConsulta ? "NORDOM" : "Resolución"),
          title: cleanTitle(f.post_title),
          status,
          interventionLevel: interventionFor(status, c.isConsulta),
          category: c.category,
          isConsulta: c.isConsulta,
          publishedAt: isoDate(f.created_time),
          deadline: null,
          url,
          raw: f,
        });
      }
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

    // Resoluciones: index → latest "resoluciones-YYYY" → leaf articles.
    try {
      const idx = await fetchText(this.resolucionesIndex, { timeoutMs: 25_000 });
      const yearCat = latestCategory(idx, /href="(\/transparencia\/[^"]*\/category\/resoluciones-(\d{4}))"/gi);
      if (!yearCat) gaps.push("MICM resoluciones: no se halló categoría por año.");
      else {
        const leaf = await fetchText(this.host + yearCat, { timeoutMs: 25_000 });
        for (const a of parseZooArticles(leaf, this.host)) {
          const status = "Resolución publicada";
          regulations.push({
            source: this.source, sourceId: a.url ?? a.title, institution: this.institution,
            regType: inferRegType(a.title) ?? "Resolución", title: a.title, status,
            interventionLevel: interventionFor(status, false), category: "INDUSTRIA Y COMERCIO",
            isConsulta: false, publishedAt: a.date, deadline: null, url: a.url, raw: a,
          });
        }
      }
    } catch (err) {
      gaps.push(`MICM resoluciones · ${(err as Error).message}`);
    }

    // Consultas abiertas: index → latest "YYYY-N" → month subcategories → leaf articles.
    try {
      const idx = await fetchText(this.consultasIndex, { timeoutMs: 25_000 });
      const yearCat = latestCategory(idx, /href="(\/transparencia\/[^"]*\/proceso-de-consultas-abiertas\/category\/(\d{4})-\d+)"/gi);
      if (!yearCat) gaps.push("MICM consultas: no se halló categoría por año.");
      else {
        const yearPage = await fetchText(this.host + yearCat, { timeoutMs: 25_000 });
        const months = uniq(
          [...yearPage.matchAll(/href="(\/transparencia\/[^"]*\/proceso-de-consultas-abiertas\/category\/[a-zñ]+-\d+)"/gi)].map((m) => m[1]!),
        );
        for (const mUrl of months) {
          let leaf: string;
          try {
            leaf = await fetchText(this.host + mUrl, { timeoutMs: 20_000 });
          } catch (err) {
            gaps.push(`MICM consulta mes ${mUrl} · ${(err as Error).message}`);
            continue;
          }
          for (const a of parseZooArticles(leaf, this.host)) {
            const status = "Consulta Pública (borrador)";
            regulations.push({
              source: this.source, sourceId: a.url ?? a.title, institution: this.institution,
              regType: inferRegType(a.title) ?? "Resolución", title: a.title, status,
              interventionLevel: interventionFor(status, true), category: "INDUSTRIA Y COMERCIO",
              isConsulta: true, publishedAt: a.date, deadline: null, url: a.url, raw: a,
            });
          }
        }
      }
    } catch (err) {
      gaps.push(`MICM consultas · ${(err as Error).message}`);
    }

    return { regulations, gaps };
  }
}

// --- INTRANT (transporte) ---
interface IntrantDoc { title?: string; mimeType?: string; mediaItemUrl?: string; date?: string }
/** INTRANT — headless WordPress (Next.js frontend); documents come from WPGraphQL,
 *  not the SSR shell. One query per transparency section URI. */
export class IntrantAdapter {
  readonly source = "reg-intrant";
  readonly institution = "INTRANT";
  constructor(
    private readonly endpoint = "https://wp.intrant.gob.do/graphql",
    private readonly sections = [
      { uri: "/transparencia/base-legal-de-la-institucion/resoluciones-base-legal/", category: "TRANSPORTE", label: "resoluciones" },
      { uri: "/transparencia/marco-legal-del-sistema-de-transparencia/normativas/", category: "TRANSPORTE · NORMAS", label: "normativas" },
    ],
    private readonly perSection = 25,
  ) {}

  async collect(): Promise<{ regulations: RawRegulation[]; gaps: string[] }> {
    const gaps: string[] = [];
    const regulations: RawRegulation[] = [];
    const query =
      "query($id:ID!){transparencia(idType:URI,id:$id){title relatedDocuments{documents{document{title mimeType mediaItemUrl date}}}}}";
    for (const s of this.sections) {
      let docs: { document?: IntrantDoc }[] = [];
      try {
        const d = await fetchJson<{ data?: { transparencia?: { relatedDocuments?: { documents?: { document?: IntrantDoc }[] } } } }>(
          this.endpoint,
          {
            method: "POST",
            body: JSON.stringify({ query, variables: { id: s.uri } }),
            headers: { "Content-Type": "application/json" },
            timeoutMs: 30_000,
          },
        );
        docs = d.data?.transparencia?.relatedDocuments?.documents ?? [];
      } catch (err) {
        gaps.push(`INTRANT ${s.label} · ${(err as Error).message}`);
        continue;
      }
      if (!docs.length) gaps.push(`INTRANT ${s.label} sin documentos (¿cambió el URI?).`);
      const items = docs
        .map((x) => x.document)
        .filter((doc): doc is IntrantDoc => !!doc?.title && (doc.mimeType ?? "").includes("pdf"))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
        .slice(0, this.perSection);
      for (const doc of items) {
        const status = "Publicada/Vigente";
        regulations.push({
          source: this.source,
          sourceId: doc.mediaItemUrl ?? doc.title!,
          institution: this.institution,
          regType: inferRegType(doc.title!) ?? (/^\s*normativa/i.test(doc.title!) ? "Norma" : "Resolución"),
          title: cleanTitle(doc.title!),
          status,
          interventionLevel: interventionFor(status, false),
          category: s.category,
          isConsulta: false,
          publishedAt: isoDate(doc.date),
          deadline: null,
          url: doc.mediaItemUrl ?? null,
          raw: doc,
        });
      }
    }
    return { regulations, gaps };
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
