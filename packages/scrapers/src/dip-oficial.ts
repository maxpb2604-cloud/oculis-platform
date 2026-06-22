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
import { fetchPdfText } from "./pdf.js";

const LIST_URL = "https://camaradediputados.gob.do/ordenes-del-dia-del-pleno/";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const CODE_RE = /\d{5}-\d{4}-\d{4}-[A-Z]{2}/g;

export interface OrdenDelDiaRef {
  url: string;
  fileName: string;
  sessionType: string | null; // "ordinaria" | "extraordinaria"
  sessionNumber: string | null;
  date: string | null; // ISO yyyy-mm-dd
}

const MONTHS: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06",
  julio: "07", agosto: "08", septiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

/** Parse session type/number/date out of a download filename. */
export function parseOrdenFileName(url: string): OrdenDelDiaRef {
  const fileName = decodeURIComponent(url.split("/").pop() ?? "");
  const type = /extraordinaria/i.test(fileName) ? "extraordinaria" : /ordinaria/i.test(fileName) ? "ordinaria" : null;
  const num = fileName.match(/no-?(\d{4,5})/i)?.[1] ?? null;
  const dm = fileName.match(/(\d{1,2})-de-([a-zñ]+)-de-(\d{4})/i);
  let date: string | null = null;
  if (dm) {
    const mm = MONTHS[dm[2]!.toLowerCase()];
    if (mm) date = `${dm[3]}-${mm}-${dm[1]!.padStart(2, "0")}`;
  }
  return { url, fileName, sessionType: type, sessionNumber: num ? String(Number(num)) : null, date };
}

export class DipOficialAdapter {
  readonly source = "dip-oficial";

  constructor(private readonly listUrl: string = LIST_URL) {}

  /** Scrape the list page for the most recent orden-del-día PDFs. */
  async listOrdenes(): Promise<OrdenDelDiaRef[]> {
    const res = await fetch(this.listUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${this.listUrl}`);
    const html = await res.text();
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
   * Each event links the bills referenced and notes which reading-statuses appear.
   */
  async *plenaryAgenda(opts: { limit?: number } = {}): AsyncIterable<RawActivityEvent> {
    const { limit = 5 } = opts;
    const refs = (await this.listOrdenes()).slice(0, limit);
    for (const ref of refs) {
      let codes: string[] = [];
      let statuses: string[] = [];
      try {
        const { text } = await fetchPdfText(ref.url);
        codes = [...new Set(text.match(CODE_RE) ?? [])];
        statuses = detectReadingStatuses(text);
      } catch {
        // keep the agenda item even if the PDF can't be parsed; link stays for analysts
      }
      const label = `Pleno — Sesión ${ref.sessionType ?? ""} No. ${ref.sessionNumber ?? "?"}`.trim();
      const statusNote = statuses.length ? ` · Estados: ${statuses.join(", ")}` : "";
      yield {
        source: this.source,
        scope: "PLENARY",
        chamber: "DIPUTADOS",
        agendaUrl: ref.url,
        date: ref.date,
        kind: "Orden del Día",
        body: label,
        description: `${label} (${ref.date ?? "s/f"}) — ${codes.length} iniciativas en agenda${statusNote}`,
        initiativeCodes: codes,
        dedupeKey: `dip-pleno|${ref.sessionNumber ?? ref.fileName}`,
        raw: { ref, statuses },
      };
    }
  }

  async *list(opts: { limit?: number } = {}): AsyncIterable<RawActivityEvent> {
    yield* this.plenaryAgenda(opts);
  }
}

/** Which reading-statuses appear in an orden-del-día PDF. */
export function detectReadingStatuses(text: string): string[] {
  const found = new Set<string>();
  if (/primera lectura/i.test(text)) found.add("1ra lectura");
  if (/segunda lectura/i.test(text)) found.add("2da lectura");
  if (/única lectura|unica lectura/i.test(text)) found.add("única lectura");
  if (/declarad[ao] de urgencia/i.test(text)) found.add("urgencia");
  if (/tomad[ao] en consideraci/i.test(text)) found.add("en consideración");
  return [...found];
}
