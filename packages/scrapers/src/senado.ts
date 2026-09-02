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
import { buildISODate, extractLeadingISODate, spanishMonthToNum } from "./dates.js";
import { browserHeaders, fetchJson } from "./http.js";
import { extractProceduralMentions } from "./dip-oficial.js";
import { fetchPdfText } from "./pdf.js";
import type { RawActivityEvent } from "./sil-actividad.js";

const AJAX = "https://www.senadord.gob.do/wp-admin/admin-ajax.php";
const SENATE_ORIGIN = "https://www.senadord.gob.do";
const WPFD_DOWNLOAD_PATH = "/wp-admin/admin-ajax.php";
const H = browserHeaders({
  "X-Requested-With": "XMLHttpRequest",
  Referer: "https://www.senadord.gob.do/",
});

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
  {
    id: 1382,
    label: "Agenda Semanal de Comisiones",
    scope: "COMMITTEE",
    page: "agenda-semanal-comisiones",
  },
];

export interface WpfdFile {
  ID: number;
  post_title: string;
  post_name: string;
  ext: string;
  created_time: string;
  modified_time?: string;
  /** Category identity and document URLs reported by WPFD's files.getFiles payload. */
  catid?: string | number;
  openpdflink?: string;
  linkdownload?: string;
}

export interface SenateWpfdLinks {
  /** Exact PDF endpoint reported by WPFD; safe to expose as the agenda destination. */
  openpdflink: string | null;
  /** Exact human-facing download permalink reported by WPFD; retained as provenance. */
  linkdownload: string | null;
}

const OPEN_PDF_PARAM_VALUES = {
  juwpfisadmin: "false",
  action: "wpfd",
  task: "file.download",
  token: "",
  preview: "1",
} as const;

function senateHttpsUrl(value: unknown): URL | null {
  if (typeof value !== "string" || !value.startsWith(`${SENATE_ORIGIN}/`)) return null;
  try {
    const url = new URL(value);
    if (
      url.origin !== SENATE_ORIGIN ||
      url.protocol !== "https:" ||
      url.hostname !== "www.senadord.gob.do" ||
      url.port ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function exactOpenPdfUrl(value: unknown, categoryId: number, fileId: number): string | null {
  const url = senateHttpsUrl(value);
  if (!url || url.pathname !== WPFD_DOWNLOAD_PATH) return null;

  const expected = new Map<string, string>([
    ...Object.entries(OPEN_PDF_PARAM_VALUES),
    ["wpfd_category_id", String(categoryId)],
    ["wpfd_file_id", String(fileId)],
  ]);
  const entries = [...url.searchParams.entries()];
  if (entries.length !== expected.size) return null;
  for (const [key, expectedValue] of expected) {
    const values = url.searchParams.getAll(key);
    if (values.length !== 1 || values[0] !== expectedValue) return null;
  }
  return url.href;
}

function exactLinkDownloadUrl(
  value: unknown,
  categoryId: number,
  fileId: number,
  postName: string,
): string | null {
  const url = senateHttpsUrl(value);
  if (!url || url.search) return null;
  const match = /^\/Descargas\/([1-9]\d*)\/([^/]+)\/([1-9]\d*)\/([^/]+)$/.exec(url.pathname);
  if (!match) return null;
  let reportedPostName: string;
  try {
    reportedPostName = decodeURIComponent(match[4]!);
  } catch {
    return null;
  }
  if (
    match[1] !== String(categoryId) ||
    match[3] !== String(fileId) ||
    reportedPostName !== postName
  ) {
    return null;
  }
  return url.href;
}

/**
 * Validate the two document destinations reported by WPFD against the exact source
 * category/file identity. This deliberately fails closed: a fabricated `/wpfd_file`
 * permalink, a foreign host, a duplicate/extra parameter, or any id mismatch produces
 * no customer-facing agenda URL.
 */
export function resolveSenateWpfdLinks(
  file: WpfdFile,
  expectedCategoryId: number,
): SenateWpfdLinks | null {
  if (!Number.isSafeInteger(file.ID) || file.ID <= 0) return null;
  if (file.catid !== expectedCategoryId && file.catid !== String(expectedCategoryId)) return null;

  return {
    openpdflink: exactOpenPdfUrl(file.openpdflink, expectedCategoryId, file.ID),
    linkdownload: exactLinkDownloadUrl(
      file.linkdownload,
      expectedCategoryId,
      file.ID,
      file.post_name,
    ),
  };
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
  /** Bare official expediente references preserved as provenance, never used as join keys. */
  expedientes: string[];
  /** Complete official initiative codes safe for exact activity↔initiative joins. */
  initiativeCodes: string[];
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
    const asunto = (rest.match(/ASUNTO:\s*([\s\S]*?)(?:INVITAD|LUGAR:|$)/i)?.[1] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const hora =
      (rest.match(/HORA:\s*([\s\S]*?)(?:ASUNTO:|INVITAD|LUGAR:|$)/i)?.[1] ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 18) || null;
    const expedientes = [
      ...new Set([...rest.matchAll(/Expediente\s*No\.?\s*(\d{3,6})/gi)].map((x) => x[1]!)),
    ];
    out.push({
      committee: titleCaseEs(nm[1]!),
      date: curDate,
      hora,
      asunto,
      expedientes,
      initiativeCodes: extractCodes(rest),
    });
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
      const da = parseSenadoDate(a.post_title) ?? extractLeadingISODate(a.created_time) ?? "";
      const db = parseSenadoDate(b.post_title) ?? extractLeadingISODate(b.created_time) ?? "";
      return db.localeCompare(da);
    });
  }

  /** Isolated for deterministic adapter tests; production always reads the verified URL. */
  protected readPdf(url: string) {
    return fetchPdfText(url);
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
    if (!parsePdfs) {
      gaps.push(
        "Senado · parsePdfs=false: los PDF de Pleno/Asamblea no se leyeron; initiativeCodes y statuses quedan vacíos para esos documentos.",
      );
    }
    let parseFailures = 0;
    let parsed = 0;
    let committeeParseFailures = 0;
    let successfulCategories = 0;
    let invalidAgendaLinks = 0;

    for (const cat of SENADO_CATEGORIES) {
      let files: WpfdFile[];
      try {
        files = (await this.filesInCategory(cat.id)).slice(0, limitPerCategory);
        successfulCategories++;
      } catch (err) {
        gaps.push(`Senado · ${cat.label}: no se pudo leer (${(err as Error).message})`);
        continue;
      }

      // Committees: the Senate publishes ONE weekly agenda covering every committee.
      // Download + parse it into per-committee rows so each committee gets its own bubble
      // (matching how Diputados' comision/ordenes yields one row per committee).
      if (cat.scope === "COMMITTEE") {
        for (const f of files.slice(0, committeeWeeks)) {
          const links = resolveSenateWpfdLinks(f, cat.id);
          if (!links?.openpdflink || !links.linkdownload) {
            if (!links?.openpdflink) invalidAgendaLinks++;
            committeeParseFailures++;
            continue;
          }
          let text: string;
          try {
            // openpdflink is the exact customer-facing viewer; linkdownload is the
            // exact application/pdf resource used only for extraction.
            ({ text } = await this.readPdf(links.linkdownload));
          } catch {
            committeeParseFailures++;
            continue;
          }
          const year = text.match(/A[ÑN]O\s+(\d{4})/i)?.[1] ?? "";
          let undatedInWeek = 0;
          for (const [entryIndex, c] of parseSenateCommitteeAgenda(text, year).entries()) {
            if (!c.date) undatedInWeek++;
            const date = c.date;
            events.push({
              source: this.source,
              sourceEventId: `${cat.id}:${f.ID}:${entryIndex}`,
              scope: "COMMITTEE",
              chamber: "SENADO",
              // Every committee row for the week intentionally opens the same exact
              // weekly PDF published by WPFD.
              agendaUrl: links.openpdflink,
              date,
              time: c.hora,
              kind: cat.label,
              body: c.committee,
              description: c.asunto || c.committee,
              statuses: [],
              // Bare references such as "Expediente No. 12345" stay in raw.payload only:
              // they are not complete initiative codes and must never drive an exact join.
              initiativeCodes: c.initiativeCodes,
              // Exact source identity only: never merge two published entries because
              // their date, committee, or text happens to match.
              dedupeKey: `senado-com|${cat.id}|${f.ID}|${entryIndex}`,
              raw: {
                payload: { ...c, fileId: f.ID, week: f.post_title },
                provenance: {
                  categoryId: cat.id,
                  documentUrl: links.openpdflink,
                  linkdownload: links.linkdownload,
                  officialSection: cat.label,
                },
              },
            });
          }
          if (undatedInWeek > 0) {
            gaps.push(
              `Senado · ${undatedInWeek} comisión(es) sin fecha exacta en "${f.post_title}"; el campo date queda null.`,
            );
          }
        }
        if (committeeParseFailures) {
          gaps.push(
            `Senado · ${committeeParseFailures} agenda(s) semanal(es) de comisiones no se pudieron leer.`,
          );
        }
        continue;
      }

      // Pleno / Asamblea: one event per orden-del-día file.
      for (const f of files) {
        const links = resolveSenateWpfdLinks(f, cat.id);
        const agendaUrl = links?.openpdflink ?? null;
        if (!agendaUrl) invalidAgendaLinks++;
        let codes: string[] = [];
        let statuses: string[] = [];
        if (parsePdfs) {
          parsed++;
          if (!agendaUrl || !links?.linkdownload) {
            parseFailures++;
          } else {
            try {
              const { text } = await this.readPdf(links.linkdownload);
              codes = extractCodes(text);
              statuses = extractProceduralMentions(text);
            } catch {
              parseFailures++;
            }
          }
        }
        const date = parseSenadoDate(f.post_title);
        // WPFD category + file id is the source record's exact identity. A re-upload
        // or same-day second document remains visible as a distinct published record.
        const dedupeKey = `senado-doc|${cat.id}|${f.ID}`;
        events.push({
          source: this.source,
          sourceEventId: `${cat.id}:${f.ID}`,
          scope: cat.scope,
          chamber: "SENADO",
          agendaUrl,
          date,
          kind: cat.label,
          body: `Senado — ${cat.label}`,
          description: f.post_title.replace(/\s+/g, " ").trim(),
          statuses,
          initiativeCodes: codes,
          dedupeKey,
          raw: {
            payload: f,
            provenance: {
              categoryId: cat.id,
              categoryEndpoint: `${AJAX}?juwpfisadmin=false&action=wpfd&task=files.getFiles&id=${cat.id}`,
              documentUrl: agendaUrl,
              linkdownload: links?.linkdownload ?? null,
              officialSection: cat.label,
            },
          },
        });
      }
    }

    if (parsePdfs && parseFailures) {
      gaps.push(`Senado · ${parseFailures} de ${parsed} PDF(s) de Pleno no se pudieron leer.`);
    }
    if (invalidAgendaLinks) {
      gaps.push(
        `Senado · ${invalidAgendaLinks} documento(s) no publicaron enlaces WPFD exactos; agendaUrl queda null y no se usa un permalink genérico.`,
      );
    }
    if (successfulCategories === 0) {
      throw new Error(gaps.join(" | ") || "Senate agenda categories were unavailable");
    }
    return { events, gaps };
  }
}
