/**
 * Adapter for the Senado de la República (senadord.gob.do).
 *
 * The Senate publishes its órdenes del día (Pleno / Asamblea), weekly committee
 * agendas, síntesis, and approved-initiative lists through the **WPFD** (WordPress
 * File Download) plugin. Its file lists are reachable over plain HTTP via
 * `admin-ajax.php?action=wpfd&task=files.getFiles&id={categoryId}` — no Playwright or
 * reCAPTCHA needed for these document categories (the reCAPTCHA only guards the separate
 * "Sistema de Gestión de Expedientes Digitales" search, which we flag as a gap).
 *
 * Category IDs were discovered from each section page's embedded WPFD shortcode.
 */
import type { RawActivityEvent } from "./sil-actividad.js";
import { fetchPdfText } from "./pdf.js";

const AJAX = "https://www.senadord.gob.do/wp-admin/admin-ajax.php";
const FILE = "https://www.senadord.gob.do/wpfd_file";
const H = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://www.senadord.gob.do/",
};
const CODE_RE = /\d{5}-\d{4}-\d{4}-[A-Z]{2}/g;

/** WPFD document categories on the Senate site → our activity scope. */
export const SENADO_CATEGORIES: Array<{
  id: number;
  label: string;
  scope: "PLENARY" | "ASAMBLEA" | "COMMITTEE";
  page: string;
}> = [
  { id: 1380, label: "Orden del Día Pleno", scope: "PLENARY", page: "orden-del-dia-pleno" },
  { id: 1379, label: "Orden del Día", scope: "PLENARY", page: "orden-del-dia" },
  { id: 1415, label: "Orden del Día Asamblea", scope: "ASAMBLEA", page: "orden-del-dia-asamblea" },
  { id: 1382, label: "Agenda Semanal de Comisiones", scope: "COMMITTEE", page: "agenda-semanal-comisiones" },
];

export interface WpfdFile {
  ID: number;
  post_title: string;
  post_name: string;
  ext: string;
  created_time: string;
  modified_time?: string;
}

interface SenadoOptions {
  /** Parse each file's PDF to extract referenced initiative codes (slower). */
  parsePdfs?: boolean;
  /** Max files per category to process. */
  limitPerCategory?: number;
}

const MONTHS: Record<string, string> = {
  ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06",
  jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12",
};

/** Pull a yyyy-mm-dd date out of a Senate file title like "...-17-6-2026-SIL". */
export function parseSenadoDate(title: string): string | null {
  const numeric = title.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (numeric) {
    const [, d, m, y] = numeric;
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
  }
  const named = title.match(/(\d{1,2})[-\s]de[-\s]([a-zñ]{3})[a-zñ]*[-\s]de[-\s](\d{4})/i);
  if (named) {
    const mm = MONTHS[named[2]!.slice(0, 3).toLowerCase()];
    if (mm) return `${named[3]}-${mm}-${named[1]!.padStart(2, "0")}`;
  }
  return null;
}

export interface SenadoResult {
  events: RawActivityEvent[];
  /** Health gaps (e.g. Expedientes portal not scraped) for the dashboard. */
  gaps: string[];
}

export class SenadoAdapter {
  readonly source = "senado";

  async filesInCategory(categoryId: number): Promise<WpfdFile[]> {
    const res = await fetch(
      `${AJAX}?juwpfisadmin=false&action=wpfd&task=files.getFiles&id=${categoryId}`,
      { headers: H, signal: AbortSignal.timeout(30_000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} for Senado category ${categoryId}`);
    const data = (await res.json()) as { files?: WpfdFile[] };
    return (data.files ?? []).filter((f) => /pdf/i.test(f.ext));
  }

  fileUrl(slug: string): string {
    return `${FILE}/${slug}/`;
  }

  /**
   * Collect Senate agenda/orden-del-día activity. Plain HTTP per WPFD category;
   * the Expedientes Digitales search portal is reCAPTCHA-gated → recorded as a gap.
   */
  async collect(opts: SenadoOptions = {}): Promise<SenadoResult> {
    const { parsePdfs = false, limitPerCategory = 12 } = opts;
    const events: RawActivityEvent[] = [];
    const gaps: string[] = [];

    for (const cat of SENADO_CATEGORIES) {
      let files: WpfdFile[];
      try {
        files = (await this.filesInCategory(cat.id)).slice(0, limitPerCategory);
      } catch (err) {
        gaps.push(`Senado · ${cat.label}: no se pudo leer (${(err as Error).message})`);
        continue;
      }
      for (const f of files) {
        const url = this.fileUrl(f.post_name);
        let codes: string[] = [];
        if (parsePdfs) {
          try {
            const { text } = await fetchPdfText(url);
            codes = [...new Set(text.match(CODE_RE) ?? [])];
          } catch {
            /* keep the item; the link still works for analysts */
          }
        }
        events.push({
          source: this.source,
          scope: cat.scope,
          chamber: "SENADO",
          agendaUrl: url,
          date: parseSenadoDate(f.post_title) ?? f.created_time?.slice(0, 10) ?? null,
          kind: cat.label,
          body: `Senado — ${cat.label}`,
          description: f.post_title.replace(/\s+/g, " ").trim(),
          initiativeCodes: codes,
          dedupeKey: `senado|${cat.id}|${f.ID}`,
          raw: f,
        });
      }
    }

    // The per-expediente detail lives behind the reCAPTCHA-gated "Sistema de Gestión de
    // Expedientes Digitales" — not scraped in Phase 1; surface it honestly.
    gaps.push(
      "Senado · Iniciativas (Sistema de Gestión de Expedientes Digitales): portal con reCAPTCHA, pendiente de verificación manual.",
    );

    return { events, gaps };
  }
}
