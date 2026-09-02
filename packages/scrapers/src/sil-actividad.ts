/**
 * Adapter for the Cámara de Diputados SIL **activity** subsystem — the daily
 * committee and plenary agenda, which is SEPARATE from the `iniciativa/*` corpus
 * covered by `sil-diputados.ts`.
 *
 * This is the source of "what happened today": initiatives may sit unchanged in the
 * iniciativa endpoints for days while committees actively meet on them.
 *
 *   comision/ordenes?page={p}&periodoId=0   -> Page<ComisionOrden>  (committee meetings/agenda)
 *   sesion/ordenes?page={p}&periodoId=0     -> Page<SesionOrden>    (plenary order-of-the-day)
 *
 * Committee rows carry no stable record id, so their identity is an exact fingerprint
 * of every consumed source field plus a literal-duplicate occurrence number. Plenary
 * rows use the official `id` when present. Each agenda item references initiatives by
 * official code; those links resolve only when the code identifies one unique PDL.
 */
import { extractCodes } from "./codes.js";
import { buildISODate, extractLeadingISODate, spanishMonthToNum } from "./dates.js";
import {
  commissionAppearsInAgendaPdf,
  DipCommissionAgendaAdapter,
  type CommissionAgendaResolution,
  type CommissionAgendaResolver,
} from "./dip-commission-agenda.js";
import { fetchJson } from "./http.js";
import type { Page } from "./sil-diputados.js";
import { createHash } from "node:crypto";

const ROOT = "https://www.diputadosrd.gob.do/sil/api";
const REFERER = "https://www.diputadosrd.gob.do/sil/sesiones";
const headers = { Referer: REFERER };
const MAX_PAGES = 200; // safety cap against an unbounded loop (pageSize=0/NaN, stale total)

export interface SilComisionOrden {
  fecha: string | null;
  descripcion: string | null;
  tipo: string | null;
  nombreComision: string | null;
  periodoLegislativo: number | null;
  [k: string]: unknown;
}

/** Calendar record returned by actividad/AgendaActividad. */
export interface SilAgendaActividad {
  id: number | null;
  comision: string | null;
  tipoActividad: string | null;
  start: string | null;
  end?: string | null;
  descripcion: string | null;
  title?: string | null;
  [k: string]: unknown;
}

/** Exact activity detail returned by actividad/actividad/{calendar activity id}. */
export interface SilActividadDetail {
  id?: number | null;
  ubicacion?: string | null;
  comisionId?: number | null;
  comision?: string | null;
  [k: string]: unknown;
}

/**
 * Plenary order-of-the-day record. NOTE: this endpoint carries NO `fecha`/`camara`/`tipo`
 * fields — the session date lives inside `documento` ("...MIÉRCOLES 24 DE JUNIO DE 2026...")
 * and the stable identity is `id`. (An earlier version assumed `fecha`, which the API
 * always returns as undefined → every plenary order was stored with a null date and was
 * invisible on the date-filtered "Hoy" view.)
 */
export interface SilSesionOrden {
  id: number | null;
  documento: string | null;
  descripcion: string | null;
  cargado: string | null; // ISO upload timestamp
  tipoAgenda: number | null;
  [k: string]: unknown;
}

/** Canonical, source-agnostic agenda/activity event. */
export interface RawActivityEvent {
  source: string;
  /** Stable official event id, when the source publishes one. */
  sourceEventId?: string | null;
  /** COMMITTEE (comisión), PLENARY (pleno), or ASAMBLEA (asamblea nacional). */
  scope: "COMMITTEE" | "PLENARY" | "ASAMBLEA";
  chamber?: "DIPUTADOS" | "SENADO" | null;
  agendaUrl?: string | null;
  /** Keep an already verified agenda URL only when the entire agenda catalog is
   * temporarily unavailable. A successful negative/ambiguous lookup still clears it. */
  preserveAgendaUrlOnNull?: boolean;
  date: string | null;
  /** Literal time/range reported by the agenda, when present. */
  time?: string | null;
  /** Literal official meeting location, when present. */
  location?: string | null;
  kind: string | null;
  body: string | null;
  description: string;
  /** Reading/processing statuses surfaced for this agenda item (structured). */
  statuses?: string[];
  initiativeCodes: string[];
  dedupeKey: string;
  raw: unknown;
}

export interface ActivityCollectResult {
  events: RawActivityEvent[];
  gaps: string[];
}

function exactFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizedExactText(value: string | null | undefined): string | null {
  const normalized = value?.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("es");
  return normalized || null;
}

function validActivityId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function activityUrl(root: string, activityId: number): string {
  return `${root.replace(/\/+$/, "")}/actividad/actividad/${activityId}`;
}

function calendarUrl(root: string, date: string): string {
  const query = new URLSearchParams({ inicio: date, fin: date });
  return `${root.replace(/\/+$/, "")}/actividad/AgendaActividad?${query.toString()}`;
}

function exactReportedTime(value: string | null | undefined): string | null {
  // Keep the time component exactly as published. Do not reinterpret it in the server's
  // timezone (the source does not publish a timezone offset).
  return /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/.exec(value ?? "")?.[1] ?? null;
}

interface CommitteeCalendarResolution {
  status: "UNIQUE" | "NO_MATCH" | "AMBIGUOUS" | "INSUFFICIENT_FIELDS";
  event: SilAgendaActividad | null;
  candidateCount: number;
}

/**
 * Match only the literal facts shared by both official endpoints. Whitespace, Unicode
 * composition, and case are normalized, but words, punctuation, accents, and dates are
 * never guessed or fuzzy-matched.
 */
function resolveCommitteeCalendarEvent(
  row: SilComisionOrden,
  calendar: readonly SilAgendaActividad[],
): CommitteeCalendarResolution {
  const date = extractLeadingISODate(row.fecha);
  const commission = normalizedExactText(row.nombreComision);
  const kind = normalizedExactText(row.tipo);
  const description = normalizedExactText(row.descripcion);
  if (!date || !commission || !kind || !description) {
    return { status: "INSUFFICIENT_FIELDS", event: null, candidateCount: 0 };
  }

  const candidates = calendar.filter(
    (event) =>
      validActivityId(event.id) &&
      extractLeadingISODate(event.start) === date &&
      normalizedExactText(event.comision) === commission &&
      normalizedExactText(event.tipoActividad) === kind &&
      normalizedExactText(event.descripcion) === description,
  );
  if (candidates.length === 1) {
    return { status: "UNIQUE", event: candidates[0]!, candidateCount: 1 };
  }
  return {
    status: candidates.length > 1 ? "AMBIGUOUS" : "NO_MATCH",
    event: null,
    candidateCount: candidates.length,
  };
}

/** Resolve only a uniquely matched calendar activity URL for technical provenance. */
export function resolveCommitteeActivityUrl(
  row: SilComisionOrden,
  calendar: readonly SilAgendaActividad[],
  root: string = ROOT,
): string | null {
  const match = resolveCommitteeCalendarEvent(row, calendar);
  return match.event && validActivityId(match.event.id) ? activityUrl(root, match.event.id) : null;
}

/** Pull a Spanish date ("24 de junio de 2026") out of free text → ISO yyyy-mm-dd. */
export function parseSpanishDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+de\s+(\d{4})/i.exec(text);
  if (!m) return null;
  const mm = spanishMonthToNum(m[2]);
  return mm ? buildISODate(m[1]!, mm, m[3]!) : null;
}

export class SilActividadAdapter {
  readonly source = "sil-actividad";

  constructor(
    private readonly root: string = ROOT,
    private readonly commissionAgendas: CommissionAgendaResolver = new DipCommissionAgendaAdapter(),
  ) {}

  /**
   * Fully paginate one endpoint with safety guards:
   *  - hard MAX_PAGES cap;
   *  - stop when a page returns fewer rows than pageSize (primary signal), or when
   *    page*pageSize >= total — but never trust a zero/NaN pageSize to terminate;
   *  - report a reconciliation gap when fewer rows were collected than `total`.
   */
  private async fetchAll<T>(
    path: string,
    label: string,
    query: Record<string, string> = { periodoId: "0" },
  ): Promise<{ rows: T[]; expected: number; gap?: string }> {
    const rows: T[] = [];
    let expected = 0;
    let page = 1;
    while (page <= MAX_PAGES) {
      const params = new URLSearchParams({ page: String(page), ...query });
      const env = await fetchJson<Page<T>>(`${this.root}/${path}?${params.toString()}`, {
        headers,
      });
      const pageSize = Number(env.pageSize);
      const total = Number(env.total);
      if (
        !env ||
        !Array.isArray(env.results) ||
        !Number.isFinite(pageSize) ||
        pageSize <= 0 ||
        !Number.isFinite(total) ||
        total < 0
      ) {
        throw new Error(
          `SIL actividad devolvió una página inválida para ${label} (página ${page}).`,
        );
      }
      if (page === 1) expected = total;
      if (env.results.length === 0) break;
      rows.push(...env.results);
      if (env.results.length < pageSize) break;
      if (page * pageSize >= total) break;
      page++;
    }
    const gap =
      expected > 0 && rows.length < expected
        ? `SIL · ${label}: se recolectaron ${rows.length} de ${expected} informados por la fuente.`
        : page > MAX_PAGES
          ? `SIL · ${label}: se alcanzó el tope de ${MAX_PAGES} páginas.`
          : undefined;
    return { rows, expected, gap };
  }

  async committeeOrders(): Promise<{ events: RawActivityEvent[]; gap?: string }> {
    const { rows, gap } = await this.fetchAll<SilComisionOrden>("comision/ordenes", "comisiones");

    // `comision/ordenes` omits the calendar activity id and meeting time. Fetch the
    // official calendar once per published date, then require one exact factual match.
    const dates = [
      ...new Set(rows.map((row) => extractLeadingISODate(row.fecha)).filter(Boolean) as string[]),
    ];
    const calendarByDate = new Map<
      string,
      { sourceUrl: string; events: SilAgendaActividad[]; available: boolean }
    >();
    const calendarGaps: string[] = [];
    await Promise.all(
      dates.map(async (date) => {
        const sourceUrl = calendarUrl(this.root, date);
        try {
          const calendar = await fetchJson<unknown>(sourceUrl, { headers });
          if (!Array.isArray(calendar)) {
            throw new Error("la respuesta no es una lista");
          }
          calendarByDate.set(date, {
            sourceUrl,
            events: calendar as SilAgendaActividad[],
            available: true,
          });
        } catch (error) {
          calendarByDate.set(date, { sourceUrl, events: [], available: false });
          calendarGaps.push(
            `SIL · calendario de comisiones (${date}): no se pudo consultar AgendaActividad (${(error as Error).message}).`,
          );
        }
      }),
    );

    let dailyAgendas: CommissionAgendaResolution = {
      documentsByDate: new Map(dates.map((date) => [date, null])),
      pdfTextBySourceId: new Map(),
      gaps: [],
    };
    let dailyAgendaCatalogAvailable = true;
    try {
      dailyAgendas = await this.commissionAgendas.resolveDates(dates);
    } catch (error) {
      dailyAgendaCatalogAvailable = false;
      dailyAgendas.gaps.push(
        `Diputados · agendas PDF diarias: no se pudo reconciliar la fuente oficial (${(error as Error).message}).`,
      );
    }

    const resolutions = rows.map((row) => {
      const date = extractLeadingISODate(row.fecha);
      const day = date ? calendarByDate.get(date) : undefined;
      const resolution = resolveCommitteeCalendarEvent(row, day?.events ?? []);
      return {
        day,
        resolution:
          day && !day.available
            ? ({ ...resolution, status: "NO_MATCH" } as CommitteeCalendarResolution)
            : resolution,
      };
    });

    // The exact activity URL remains valid even if this optional enrichment fails.
    const matchedIds = [
      ...new Set(resolutions.map(({ resolution }) => resolution.event?.id).filter(validActivityId)),
    ];
    const detailByActivityId = new Map<number, SilActividadDetail | null>();
    const detailFailures: number[] = [];
    await Promise.all(
      matchedIds.map(async (activityId) => {
        try {
          const detail = await fetchJson<SilActividadDetail>(activityUrl(this.root, activityId), {
            headers,
          });
          detailByActivityId.set(activityId, detail);
        } catch {
          detailByActivityId.set(activityId, null);
          detailFailures.push(activityId);
        }
      }),
    );

    // This endpoint has no stable id. Preserve its historical five-field fingerprint and
    // retain an occurrence number only for literally identical duplicate rows. No
    // date/name/text similarity is used to merge distinct published records.
    const occurrences = new Map<string, number>();
    let unresolved = 0;
    let ambiguous = 0;
    let dailyDocumentMissing = 0;
    let commissionNotInDailyDocument = 0;
    const events = rows.map((r, index): RawActivityEvent => {
      const description = (r.descripcion ?? "").replace(/\s+/g, " ").trim();
      const date = extractLeadingISODate(r.fecha);
      const body = (r.nombreComision ?? "").trim() || null;
      const { day, resolution } = resolutions[index]!;
      const calendarEvent = resolution.event;
      const activityId =
        calendarEvent && validActivityId(calendarEvent.id) ? calendarEvent.id : null;
      const calendarEventUrl = activityId == null ? null : activityUrl(this.root, activityId);
      const detail = activityId == null ? null : (detailByActivityId.get(activityId) ?? null);
      const dailyAgendaDocument = date ? (dailyAgendas.documentsByDate.get(date) ?? null) : null;
      const dailyAgendaText = dailyAgendaDocument
        ? (dailyAgendas.pdfTextBySourceId.get(dailyAgendaDocument.sourceId) ?? "")
        : "";
      const dailyAgendaVerification = commissionAppearsInAgendaPdf(
        body,
        r.descripcion,
        date,
        dailyAgendaText,
      );
      const agendaUrl =
        dailyAgendaDocument && dailyAgendaVerification.matched
          ? dailyAgendaDocument.previewUrl
          : null;
      if (!calendarEvent) unresolved++;
      if (resolution.status === "AMBIGUOUS") ambiguous++;
      if (!dailyAgendaDocument) dailyDocumentMissing++;
      else if (!dailyAgendaVerification.matched) commissionNotInDailyDocument++;

      // Preserve the pre-enrichment key exactly: calendar ids, times, detail fields, and
      // any future extra properties in the source payload must not create a new DB row.
      const fingerprint = exactFingerprint({
        fecha: r.fecha ?? null,
        descripcion: r.descripcion ?? null,
        tipo: r.tipo ?? null,
        nombreComision: r.nombreComision ?? null,
        periodoLegislativo: r.periodoLegislativo ?? null,
      });
      const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
      occurrences.set(fingerprint, occurrence);
      return {
        source: this.source,
        sourceEventId: activityId == null ? null : String(activityId),
        scope: "COMMITTEE",
        chamber: "DIPUTADOS",
        agendaUrl,
        preserveAgendaUrlOnNull: !dailyAgendaCatalogAvailable,
        date,
        time: exactReportedTime(calendarEvent?.start),
        location: detail?.ubicacion?.trim() || null,
        kind: r.tipo ?? null,
        body,
        description,
        initiativeCodes: extractCodes(r.descripcion),
        dedupeKey: `sil-com|${fingerprint}|${occurrence}`,
        raw: {
          payload: r,
          calendarEvent,
          activityDetail: detail,
          dailyAgendaDocument,
          dailyAgendaVerification,
          provenance: {
            endpoint: `${this.root}/comision/ordenes`,
            explicitDateField: "fecha",
            explicitKindField: "tipo",
            matchFields: ["fecha", "nombreComision", "tipo", "descripcion"],
            matchStatus: day && !day.available ? "SOURCE_UNAVAILABLE" : resolution.status,
            matchCandidateCount: resolution.candidateCount,
            activityId,
            calendarSourceUrl: day?.sourceUrl ?? null,
            calendarEventUrl,
            dailyAgendaPageSource: dailyAgendaDocument?.raw.provenance.pageSource ?? null,
            dailyAgendaMetadataUrl: dailyAgendaDocument?.raw.provenance.metadataUrl ?? null,
            dailyAgendaCategoryId: dailyAgendaDocument?.categoryId ?? null,
            dailyAgendaFileId: dailyAgendaDocument?.fileId ?? null,
            dailyAgendaDownloadUrl: dailyAgendaDocument?.downloadUrl ?? null,
            dailyAgendaPreviewUrl: dailyAgendaDocument?.previewUrl ?? null,
            agendaDestination: agendaUrl,
            officialLocation: detail?.ubicacion ?? null,
            officialCommissionId:
              typeof detail?.comisionId === "number" && Number.isSafeInteger(detail.comisionId)
                ? detail.comisionId
                : null,
          },
        },
      };
    });
    const resolutionGap =
      unresolved > 0
        ? `SIL · actividades exactas: ${unresolved} de ${rows.length} filas no tuvieron una coincidencia única en AgendaActividad${ambiguous > 0 ? ` (${ambiguous} ambiguas)` : ""}; su ID, hora y ubicación quedaron sin atribuir.`
        : undefined;
    const detailGap =
      detailFailures.length > 0
        ? `SIL · detalle de agendas: falló el enriquecimiento de ${detailFailures.length} actividad(es) (${detailFailures.sort((a, b) => a - b).join(", ")}); su ID y hora exactos se conservaron.`
        : undefined;
    const dailyDocumentGap =
      dailyDocumentMissing > 0 || commissionNotInDailyDocument > 0
        ? `Diputados · agenda PDF diaria: ${dailyDocumentMissing} de ${rows.length} filas no tuvieron un PDF único y verificable por fecha; ${commissionNotInDailyDocument} fila(s) no tuvieron evidencia literal suficiente de la comisión y su agenda dentro del PDF.`
        : undefined;
    return {
      events,
      gap:
        [gap, ...calendarGaps, ...dailyAgendas.gaps, resolutionGap, detailGap, dailyDocumentGap]
          .filter(Boolean)
          .join(" | ") || undefined,
    };
  }

  async plenaryOrders(): Promise<{ events: RawActivityEvent[]; gap?: string }> {
    const { rows, gap } = await this.fetchAll<SilSesionOrden>("sesion/ordenes", "pleno");
    const fallbackOccurrences = new Map<string, number>();
    const events = rows.map((r): RawActivityEvent => {
      const description = (r.descripcion ?? r.documento ?? "").replace(/\s+/g, " ").trim();
      // No `fecha` field exists here. Use only the session date explicitly named in
      // `documento`; `cargado` is an upload timestamp, not evidence of session date.
      const date = parseSpanishDate(r.documento);
      const fallbackFingerprint = exactFingerprint({
        documento: r.documento ?? null,
        descripcion: r.descripcion ?? null,
        cargado: r.cargado ?? null,
        tipoAgenda: r.tipoAgenda ?? null,
      });
      const fallbackOccurrence = (fallbackOccurrences.get(fallbackFingerprint) ?? 0) + 1;
      fallbackOccurrences.set(fallbackFingerprint, fallbackOccurrence);
      return {
        source: this.source,
        scope: "PLENARY",
        chamber: "DIPUTADOS",
        date,
        kind: "Orden del día",
        body: "Pleno",
        description,
        initiativeCodes: extractCodes(r.descripcion ?? r.documento),
        // `id` is stable + unique per order — kills the old constant `sil-ple|?|?|?`
        // key that made every plenary order overwrite the previous one.
        dedupeKey:
          r.id != null ? `sil-ple|${r.id}` : `sil-ple|${fallbackFingerprint}|${fallbackOccurrence}`,
        raw: {
          payload: r,
          provenance: {
            endpoint: `${this.root}/sesion/ordenes`,
            dateEvidence: date ? "documento" : null,
          },
        },
      };
    });
    return { events, gap };
  }

  /**
   * Collect Diputados COMMITTEE activity. Diputados PLENARY órdenes del día are deliberately
   * NOT emitted here — `dip-oficial` is the canonical, richer source for them (reading
   * statuses, initiative codes, full history). Emitting them from both feeds double-counts
   * the same session on "Hoy". We still PARSE the SIL plenary feed as a health canary: if it
   * goes silent while committees are active, that's surfaced as a gap (it does not affect
   * what's shown, since the pleno is sourced from dip-oficial).
   */
  async collect(): Promise<ActivityCollectResult> {
    const [com, ple] = await Promise.all([this.committeeOrders(), this.plenaryOrders()]);
    const gaps = [com.gap].filter(Boolean) as string[];
    if (ple.events.length === 0 && com.events.length > 0) {
      gaps.push(
        "sil-actividad: el feed SIL de órdenes de pleno está vacío mientras hay actividad de comisión — verificar la fuente (el pleno se publica vía dip-oficial).",
      );
    }
    return { events: com.events, gaps };
  }

  /** Generator interface (kept for callers that stream). */
  async *list(): AsyncIterable<RawActivityEvent> {
    const { events } = await this.collect();
    yield* events;
  }
}
