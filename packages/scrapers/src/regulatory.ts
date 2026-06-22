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
 */
import { fetchText } from "./http.js";

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

// --- tiny RSS reader (no XML dep) ---
export interface RssItem {
  title: string;
  link: string | null;
  date: string | null; // ISO
  description: string | null;
}

const strip = (s: string) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
function tag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? strip(m[1]!) : null;
}
function isoFromRss(d: string | null): string | null {
  if (!d) return null;
  const m = d.match(/(\d{1,2})\s+(\w{3})\s+(\d{4})/); // "01 Nov 2025"
  const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
  if (m) {
    const mm = months[m[2]!.slice(0, 3).toLowerCase()];
    if (mm) return `${m[3]}-${mm}-${m[1]!.padStart(2, "0")}`;
  }
  const iso = d.match(/(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1]! : null;
}

export async function readRss(url: string): Promise<RssItem[]> {
  const xml = await fetchText(url, { timeoutMs: 20_000, headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" } });
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

/** MISPAS (Ministerio de Salud Pública) — DSpace RSS of technical regulations. */
export class MispasAdapter {
  readonly source = "reg-mispas";
  readonly institution = "MISPAS";
  constructor(private readonly feed = "https://repositorio.msp.gob.do/feed/rss_2.0/123456789/13") {}

  async collect(): Promise<{ regulations: RawRegulation[]; gaps: string[] }> {
    const items = await readRss(this.feed);
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
          publishedAt: i.date,
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
      .map((m) => ({ href: m[1]!, text: strip(m[2]!) }))
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

/** Registry of available regulatory adapters (extend as more institutions are added). */
export function regulatoryAdapters() {
  return [new MispasAdapter(), new ProconsumidorAdapter()];
}
