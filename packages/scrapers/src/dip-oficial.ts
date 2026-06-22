/**
 * Adapter for the **official** Cámara de Diputados site (camaradediputados.gob.do).
 *
 * Unlike the SIL "actividad" subsystem, this is where the **plenary order-of-the-day**
 * (orden del día del Pleno) is published — as one PDF per session, containing the bills
 * to be discussed and their reading statuses (primera/segunda/única lectura). It answers
 * "¿qué se conoce hoy en el Pleno?".
 *
 * The list page is plain WordPress HTML (no JS needed); each PDF's filename encodes the
 * session type, number, and date. We download the latest N PDFs, parse the text for
 * referenced initiative codes and the reading-statuses present, and emit one PLENARY
 * activity event per session (keeping the PDF link for analyst detail).
 *
 * Committee agendas are NOT taken from here — SIL `comision/ordenes` already provides
 * them structured (see sil-actividad.ts).
 */
import type { RawActivityEvent } from "./sil-actividad.js";
import { extractCodes } from "./codes.js";
import { buildISODate, spanishMonthToNum } from "./dates.js";
import { fetchText } from "./http.js";
import { fetchPdfText } from "./pdf.js";

const LIST_URL = "https://camaradediputados.gob.do/ordenes-del-dia-del-pleno/";

export interface OrdenDelDiaRef {
  url: string;
  fileName: string;
  sessionType: string | null; // "ordinaria" | "extraordinaria"
  sessionNumber: string | null;
  date: string | null; // ISO yyyy-mm-dd
}

/** Parse session type/number/date out of a download filename. */
export function parseOrdenFileName(url: string): OrdenDelDiaRef {
  const fileName = decodeURIComponent(url.split("/").pop() ?? "");
  const type = /extraordinaria/i.test(fileName) ? "extraordinaria" : /ordinaria/i.test(fileName) ? "ordinaria" : null;
  const num = fileName.match(/no-?(\d{4,5})/i)?.[1] ?? null;
  const dm = fileName.match(/(\d{1,2})-de-([a-zñ]+)-de-(\d{4})/i);
  let date: string | null = null;
  if (dm) {
    const mm = spanishMonthToNum(dm[2]);
    if (mm) date = buildISODate(dm[1]!, mm, dm[3]!);
  }
  return { url, fileName, sessionType: type, sessionNumber: num ? String(Number(num)) : null, date };
}

export interface DipOficialResult {
  events: RawActivityEvent[];
  /** Health gaps (e.g. PDFs that failed to parse). */
  gaps: string[];
}

export class DipOficialAdapter {
  readonly source = "dip-oficial";

  constructor(private readonly listUrl: string = LIST_URL) {}

  /** Scrape the list page for the most recent orden-del-día PDFs. */
  async listOrdenes(): Promise<OrdenDelDiaRef[]> {
    const html = await fetchText(this.listUrl, { timeoutMs: 25_000 });
    const urls = [
      ...new Set(
        [...html.matchAll(/href="(https:\/\/camaradediputados\.gob\.do\/download\/[^"]+\.pdf)"/gi)].map(
          (m) => m[1]!,
        ),
      ),
    ];
    return urls.map(parseOrdenFileName);
  }

  /**
   * Download + parse the latest `limit` orden-del-día PDFs into PLENARY activity events.
   * Each event links the bills referenced and carries the reading-statuses found.
   * PDF parse failures are counted and surfaced as gaps (not silently dropped).
   */
  async collect(opts: { limit?: number } = {}): Promise<DipOficialResult> {
    const { limit = 30 } = opts;
    const refs = (await this.listOrdenes()).slice(0, limit);
    const events: RawActivityEvent[] = [];
    let parseFailures = 0;

    for (const ref of refs) {
      let codes: string[] = [];
      let statuses: string[] = [];
      try {
        const { text } = await fetchPdfText(ref.url);
        codes = extractCodes(text);
        statuses = detectReadingStatuses(text);
      } catch {
        parseFailures++; // keep the agenda item; the PDF link still works for analysts
      }
      const label = `Pleno — Sesión ${ref.sessionType ?? ""} No. ${ref.sessionNumber ?? "?"}`.replace(/\s+/g, " ").trim();
      // dedupeKey must distinguish distinct sessions: an extraordinaria and an
      // ordinaria can share a number, and numbers repeat across legislatures.
      const dedupeKey = `dip-pleno|${ref.sessionType ?? "?"}|${ref.date ?? ref.fileName}|${ref.sessionNumber ?? "?"}`;
      events.push({
        source: this.source,
        scope: "PLENARY",
        chamber: "DIPUTADOS",
        agendaUrl: ref.url,
        date: ref.date,
        kind: "Orden del Día",
        body: label,
        description: label, // human title only; counts/statuses live in structured fields
        statuses,
        initiativeCodes: codes,
        dedupeKey,
        raw: { ref, statuses },
      });
    }

    const gaps = parseFailures
      ? [`Diputados oficial · ${parseFailures} de ${refs.length} PDF(s) de orden del día no se pudieron leer.`]
      : [];
    return { events, gaps };
  }

  async *list(opts: { limit?: number } = {}): AsyncIterable<RawActivityEvent> {
    const { events } = await this.collect(opts);
    yield* events;
  }
}

/** Which reading-statuses appear in an orden-del-día PDF (Spanish labels). */
export function detectReadingStatuses(text: string): string[] {
  const found = new Set<string>();
  if (/primera lectura/i.test(text)) found.add("Aprobado 1ra lectura");
  if (/segunda lectura/i.test(text)) found.add("Aprobado 2da lectura");
  if (/única lectura|unica lectura/i.test(text)) found.add("Aprobado única lectura");
  if (/declarad[ao] de urgencia/i.test(text)) found.add("Declarado de urgencia");
  if (/tomad[ao] en consideraci/i.test(text)) found.add("Tomado en consideración");
  return [...found];
}
