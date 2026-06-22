/**
 * Adapter for the Senado de la República (senadord.gob.do).
 *
 * The Senate publishes its órdenes del día (Pleno / Asamblea), weekly committee
 * agendas, síntesis, and approved-initiative lists through the **WPFD** (WordPress
 * File Download) plugin, reachable over plain HTTP via
 * `admin-ajax.php?action=wpfd&task=files.getFiles&id={categoryId}` — no Playwright or
 * reCAPTCHA needed for these document categories (the reCAPTCHA only guards the separate
 * "Sistema de Gestión de Expedientes Digitales" search, which we flag as a gap).
 */
import { extractCodes } from "./codes.js";
import { buildISODate, spanishMonthToNum } from "./dates.js";
import { browserHeaders, fetchJson } from "./http.js";
import { detectReadingStatuses } from "./dip-oficial.js";
import { fetchPdfText, PdfParseError } from "./pdf.js";
import type { RawActivityEvent } from "./sil-actividad.js";

const AJAX = "https://www.senadord.gob.do/wp-admin/admin-ajax.php";
const FILE = "https://www.senadord.gob.do/wpfd_file";
const H = browserHeaders({ "X-Requested-With": "XMLHttpRequest", Referer: "https://www.senadord.gob.do/" });

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
  /** Parse each file's PDF to extract referenced initiative codes + reading statuses. */
  parsePdfs?: boolean;
  /** Max files per category to process. */
  limitPerCategory?: number;
}

/** Pull a yyyy-mm-dd date out of a Senate file title like "...-17-6-2026-SIL". */
export function parseSenadoDate(title: string): string | null {
  const numeric = title.match(/(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (numeric) return buildISODate(numeric[1]!, numeric[2]!, numeric[3]!);
  const named = title.match(/(\d{1,2})[-\s]de[-\s]([a-zñ]{3,})[-\s]de[-\s](\d{4})/i);
  if (named) {
    const mm = spanishMonthToNum(named[2]);
    if (mm) return buildISODate(named[1]!, mm, named[3]!);
  }
  return null;
}

export interface SenadoResult {
  events: RawActivityEvent[];
  /** Health gaps (e.g. Expedientes portal not scraped, PDF parse failures) for the dashboard. */
  gaps: string[];
}

export class SenadoAdapter {
  readonly source = "senado";

  async filesInCategory(categoryId: number): Promise<WpfdFile[]> {
    // resilient (retry/backoff) so one blip doesn't drop a whole category
    const data = await fetchJson<{ files?: WpfdFile[] }>(
      `${AJAX}?juwpfisadmin=false&action=wpfd&task=files.getFiles&id=${categoryId}`,
      { headers: H, timeoutMs: 30_000 },
    );
    const files = (data.files ?? []).filter((f) => /pdf/i.test(f.ext));
    // sort newest-first by the actual session date (title), falling back to upload time,
    // so "latest N" is genuinely the latest regardless of WPFD payload order.
    return files.sort((a, b) => {
      const da = parseSenadoDate(a.post_title) ?? a.created_time?.slice(0, 10) ?? "";
      const db = parseSenadoDate(b.post_title) ?? b.created_time?.slice(0, 10) ?? "";
      return db.localeCompare(da);
    });
  }

  fileUrl(slug: string): string {
    return `${FILE}/${slug}/`;
  }

  /**
   * Collect Senate agenda/orden-del-día activity. Plain HTTP per WPFD category;
   * the Expedientes Digitales search portal is reCAPTCHA-gated → recorded as a gap.
   * With parsePdfs, each PDF is read for initiative codes + reading statuses; genuine
   * parse failures (vs. empty agendas) are counted and surfaced as gaps.
   */
  async collect(opts: SenadoOptions = {}): Promise<SenadoResult> {
    const { parsePdfs = false, limitPerCategory = 12 } = opts;
    const events: RawActivityEvent[] = [];
    const gaps: string[] = [];
    let parseFailures = 0;
    let parsed = 0;

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
        let statuses: string[] = [];
        if (parsePdfs) {
          parsed++;
          try {
            const { text } = await fetchPdfText(url);
            codes = extractCodes(text);
            statuses = detectReadingStatuses(text);
          } catch (err) {
            if (err instanceof PdfParseError) parseFailures++;
          }
        }
        const date = parseSenadoDate(f.post_title) ?? f.created_time?.slice(0, 10) ?? null;
        events.push({
          source: this.source,
          scope: cat.scope,
          chamber: "SENADO",
          agendaUrl: url,
          date,
          kind: cat.label,
          body: `Senado — ${cat.label}`,
          description: f.post_title.replace(/\s+/g, " ").trim(),
          statuses,
          initiativeCodes: codes,
          dedupeKey: `senado|${cat.id}|${f.ID}`,
          raw: f,
        });
      }
    }

    if (parsePdfs && parseFailures) {
      gaps.push(`Senado · ${parseFailures} de ${parsed} PDF(s) no se pudieron leer (posible bloqueo/WAF).`);
    }
    if (!parsePdfs) {
      // The WPFD file URL serves an HTML viewer, not raw PDF bytes (download needs a
      // client-side nonce), so per-agenda initiative codes aren't auto-linked yet.
      gaps.push(
        "Senado · vinculación de iniciativas por agenda pendiente: la descarga de PDF (WPFD) requiere flujo con token; las agendas se listan con su enlace oficial.",
      );
    }
    // Per-expediente detail lives behind the reCAPTCHA-gated "Sistema de Gestión de
    // Expedientes Digitales" — not scraped in Phase 1; surface it honestly.
    gaps.push(
      "Senado · Iniciativas (Sistema de Gestión de Expedientes Digitales): portal con reCAPTCHA, pendiente de verificación manual.",
    );

    return { events, gaps };
  }
}
