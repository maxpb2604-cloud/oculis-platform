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
  /** Parse each Pleno/Asamblea PDF to extract referenced initiative codes + reading statuses. */
  parsePdfs?: boolean;
  /** Max files per category to process. */
  limitPerCategory?: number;
  /** How many recent weekly committee agendas to download + split into per-committee rows. */
  committeeWeeks?: number;
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

/** Spanish title-case for committee names ("COMISIÓN PERMANENTE DE SALUD" → "Comisión Permanente de Salud"). */
const NAME_LOWER = new Set(["de", "del", "la", "las", "los", "y", "e", "en", "el", "a", "por"]);
function titleCaseEs(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w, i) => (i > 0 && NAME_LOWER.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export interface SenateCommitteeEntry {
  committee: string;
  date: string | null;
  hora: string | null;
  asunto: string;
  expedientes: string[];
}

/**
 * Parse the Senate's weekly "Agenda Semanal de Comisiones" PDF text into ONE entry per
 * committee meeting. In the PDF, days are bulleted with "●" ("● Lunes 22 de junio:") and
 * each committee with "➢" ("➢ COMISIÓN PERMANENTE DE …:"), followed by HORA / ASUNTO /
 * INVITADOS / LUGAR and "Expediente No. NNNNN" references. `year` comes from the PDF header.
 */
export function parseSenateCommitteeAgenda(text: string, year: string): SenateCommitteeEntry[] {
  const out: SenateCommitteeEntry[] = [];
  const marks: Array<{ pos: number; day: boolean }> = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "●") marks.push({ pos: i, day: true });
    else if (c === "➢") marks.push({ pos: i, day: false });
  }
  let curDate: string | null = null;
  for (let k = 0; k < marks.length; k++) {
    const m = marks[k]!;
    const end = k + 1 < marks.length ? marks[k + 1]!.pos : text.length;
    const seg = text.slice(m.pos + 1, end).trim();
    if (m.day) {
      const dm = seg.match(/^[A-Za-zÁÉÍÓÚáéíóúñ]+\s+(\d{1,2})\s+de\s+([a-záéíóúñ]+)/i);
      if (dm) {
        const mm = spanishMonthToNum(dm[2]);
        if (mm && year) curDate = buildISODate(dm[1]!, mm, year) ?? curDate;
      }
      continue;
    }
    const nm = seg.match(/^\s*(COMISI[ÓO]N[^:]{0,90}?):/i);
    if (!nm) continue;
    const rest = seg.slice(nm[0].length);
    const asunto = (rest.match(/ASUNTO:\s*([\s\S]*?)(?:INVITAD|LUGAR:|$)/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
    const hora = (rest.match(/HORA:\s*([\s\S]*?)(?:ASUNTO:|INVITAD|LUGAR:|$)/i)?.[1] ?? "").replace(/\s+/g, " ").trim().slice(0, 18) || null;
    const expedientes = [...new Set([...rest.matchAll(/Expediente\s*No\.?\s*(\d{3,6})/gi)].map((x) => x[1]!))];
    out.push({ committee: titleCaseEs(nm[1]!), date: curDate, hora, asunto, expedientes });
  }
  return out;
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

  /** WPFD raw-PDF download (returns application/pdf — unlike the wpfd_file viewer page). */
  private downloadUrl(categoryId: number, fileId: number): string {
    return `${AJAX}?juwpfisadmin=false&action=wpfd&task=file.download&wpfd_category_id=${categoryId}&wpfd_file_id=${fileId}`;
  }

  /**
   * Collect Senate agenda/orden-del-día activity. Plain HTTP per WPFD category;
   * the Expedientes Digitales search portal is reCAPTCHA-gated → recorded as a gap.
   * With parsePdfs, each PDF is read for initiative codes + reading statuses; genuine
   * parse failures (vs. empty agendas) are counted and surfaced as gaps.
   */
  async collect(opts: SenadoOptions = {}): Promise<SenadoResult> {
    const { parsePdfs = false, limitPerCategory = 12, committeeWeeks = 6 } = opts;
    const events: RawActivityEvent[] = [];
    const gaps: string[] = [];
    let parseFailures = 0;
    let parsed = 0;
    let committeeParseFailures = 0;

    for (const cat of SENADO_CATEGORIES) {
      let files: WpfdFile[];
      try {
        files = (await this.filesInCategory(cat.id)).slice(0, limitPerCategory);
      } catch (err) {
        gaps.push(`Senado · ${cat.label}: no se pudo leer (${(err as Error).message})`);
        continue;
      }

      // Committees: the Senate publishes ONE weekly agenda covering every committee.
      // Download + parse it into per-committee rows so each committee gets its own bubble
      // (matching how Diputados' comision/ordenes yields one row per committee).
      if (cat.scope === "COMMITTEE") {
        for (const f of files.slice(0, committeeWeeks)) {
          const viewer = this.fileUrl(f.post_name);
          let text: string;
          try {
            ({ text } = await fetchPdfText(this.downloadUrl(cat.id, f.ID)));
          } catch {
            committeeParseFailures++;
            continue;
          }
          const year = text.match(/A[ÑN]O\s+(\d{4})/i)?.[1] ?? f.created_time?.slice(0, 4) ?? "";
          for (const c of parseSenateCommitteeAgenda(text, year)) {
            events.push({
              source: this.source,
              scope: "COMMITTEE",
              chamber: "SENADO",
              agendaUrl: viewer,
              date: c.date,
              kind: c.hora ? `Reunión · ${c.hora}` : "Reunión",
              body: c.committee,
              description: c.asunto || "Reunión de comisión",
              statuses: [],
              initiativeCodes: c.expedientes,
              dedupeKey: `senado-com|${c.date ?? "?"}|${c.committee}`,
              raw: { ...c, fileId: f.ID, week: f.post_title },
            });
          }
        }
        if (committeeParseFailures) {
          gaps.push(`Senado · ${committeeParseFailures} agenda(s) semanal(es) de comisiones no se pudieron leer.`);
        }
        continue;
      }

      // Pleno / Asamblea: one event per orden-del-día file.
      for (const f of files) {
        const url = this.fileUrl(f.post_name);
        let codes: string[] = [];
        let statuses: string[] = [];
        if (parsePdfs) {
          parsed++;
          try {
            const { text } = await fetchPdfText(this.downloadUrl(cat.id, f.ID));
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
      gaps.push(`Senado · ${parseFailures} de ${parsed} PDF(s) de Pleno no se pudieron leer (posible bloqueo/WAF).`);
    }
    // Per-expediente detail lives behind the reCAPTCHA-gated "Sistema de Gestión de
    // Expedientes Digitales" — not scraped in Phase 1; surface it honestly.
    gaps.push(
      "Senado · Iniciativas (Sistema de Gestión de Expedientes Digitales): portal con reCAPTCHA, pendiente de verificación manual.",
    );

    return { events, gaps };
  }
}
