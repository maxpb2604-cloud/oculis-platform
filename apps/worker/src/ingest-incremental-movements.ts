/**
 * Daily, source-isolated refresh of initiative histories that changed outside the
 * recent-deposit window.
 *
 * The complete official indexes are inexpensive compared with one detail request per
 * initiative. They are used only as change detectors. Status events are still written
 * exclusively from the Cámara `historicos` endpoint or a fully parsed Senate Ficha.
 */
import {
  beginIngestionRun,
  listInitiativeMovementCheckpoints,
  recordIngestionRun,
  reconcileStatusHistorySnapshot,
  upsertInitiative,
  type Database,
} from "@oculis/db";
import {
  dominicanTodayISO,
  extractLeadingISODate,
  silCatalogSerialOmissions,
  SilDiputadosAdapter,
  SenadoSilAdapter,
  type RawInitiative,
  type SilDiputadosCatalogDiagnostics,
  type SenadoExpediente,
  type SenadoFichaBatchInput,
  type SenadoFichaBatchResult,
  type SilHistorico,
} from "@oculis/scrapers";
import { senateInitiativeRecord } from "./ingest-deposits.js";
import { catalogCoverageNotes, mergeObservedSourceRaw, toInitiativeRow } from "./ingest.js";

export const DIPUTADOS_INCREMENTAL_MOVEMENTS_SOURCE = "sil-movements-incremental";
export const SENADO_INCREMENTAL_MOVEMENTS_SOURCE = "senado-sil-movements-incremental";

const DIPUTADOS_INITIATIVE_SOURCE = "sil-diputados";
const SENADO_INITIATIVE_SOURCE = "senado-sil";

interface StoredIndexSnapshot {
  id: number;
  sourceId: string;
  raw: unknown;
}

interface DiputadosIndexSignal {
  status: string;
  changedAt: string;
  changedDate: string;
}

interface SenadoIndexSignal {
  status: string;
}

export interface IncrementalMovementSourceSummary {
  source: string;
  initiativeSource: string;
  runDate: string;
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  indexed: number;
  validSignals: number;
  unchanged: number;
  changed: number;
  baselined: number;
  checked: number;
  verified: number;
  statusEventsSeen: number;
  statusEventsInserted: number;
  statusEventsReactivated: number;
  statusEventsRetired: number;
  duplicateRows: number;
  conflictingDuplicateIds: number;
  invalidSignals: number;
  unverifiedHistories: number;
  failures: number;
  gaps: string[];
  catalogTotal?: number;
  serialHighWatermark?: number;
  upstreamCatalogOmissions?: number[];
  coverageNotes?: string[];
  error?: string;
}

export interface IncrementalMovementsSummary {
  runDate: string;
  ok: boolean;
  diputados: IncrementalMovementSourceSummary;
  senado: IncrementalMovementSourceSummary;
}

/** Scheduled monitoring treats factual coverage gaps as an operational alert. */
export function assertIncrementalMovementsComplete(summary: IncrementalMovementsSummary): void {
  const incomplete = [summary.diputados, summary.senado].filter(
    (source) => source.outcome !== "COMPLETE",
  );
  if (incomplete.length === 0) return;
  throw new Error(
    `Incremental movement coverage incomplete: ${incomplete
      .map((source) => `${source.initiativeSource}=${source.outcome}`)
      .join(", ")}`,
  );
}

export interface DiputadosIncrementalAdapter {
  readonly source: string;
  count(): Promise<number>;
  serialHighWatermark?(): Promise<number>;
  catalogDiagnostics?(): Promise<SilDiputadosCatalogDiagnostics>;
  list(options?: { maxPagesPerSlice?: number }): AsyncIterable<RawInitiative>;
  historicos(id: string | number): Promise<SilHistorico[]>;
}

export interface SenadoIncrementalAdapter {
  readonly source: string;
  listDeposits(): Promise<SenadoExpediente[]>;
  fetchFichaFactsBatch(
    rows: readonly SenadoFichaBatchInput[],
    opts?: { delayMs?: number; totalTimeoutMs?: number },
  ): Promise<SenadoFichaBatchResult>;
}

interface SharedIncrementalOptions {
  now?: Date;
  log?: (message: string) => void;
}

export interface DiputadosIncrementalOptions extends SharedIncrementalOptions {
  adapter?: DiputadosIncrementalAdapter;
  concurrency?: number;
  delayMs?: number;
}

export interface SenadoIncrementalOptions extends SharedIncrementalOptions {
  adapter?: SenadoIncrementalAdapter;
  fichaBatchSize?: number;
  fichaDelayMs?: number;
  fichaBatchTimeoutMs?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sourcePayload(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const payload = (raw as { payload?: unknown }).payload;
  return payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/** The fresh mapped Cámara row stores the literal list record directly in payload. */
function freshDiputadosListPayload(raw: unknown): Record<string, unknown> | null {
  const payload = sourcePayload(raw);
  if (!payload) return null;
  const nested = payload.list;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? (nested as Record<string, unknown>)
    : payload;
}

/** Persisted enriched records store the exact index row under payload.list. */
function storedListPayload(raw: unknown): Record<string, unknown> | null {
  const payload = sourcePayload(raw);
  if (!payload) return null;
  const list = payload.list;
  return list && typeof list === "object" && !Array.isArray(list)
    ? (list as Record<string, unknown>)
    : null;
}

function normalizedLiteral(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function statusKey(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-DO");
}

function diputadosSignal(raw: unknown, expectedSourceId: string): DiputadosIndexSignal | null {
  const row = freshDiputadosListPayload(raw);
  if (!row || String(row.id ?? "").trim() !== expectedSourceId) return null;
  const status = normalizedLiteral(row.estado);
  const changedAt = normalizedLiteral(row.fechaUltimoCambioPrincipal);
  const changedDate = extractLeadingISODate(changedAt);
  return status && changedAt && changedDate ? { status, changedAt, changedDate } : null;
}

function storedDiputadosSignal(
  raw: unknown,
  expectedSourceId: string,
): DiputadosIndexSignal | null {
  const row = storedListPayload(raw);
  if (!row || String(row.id ?? "").trim() !== expectedSourceId) return null;
  const status = normalizedLiteral(row.estado);
  const changedAt = normalizedLiteral(row.fechaUltimoCambioPrincipal);
  const changedDate = extractLeadingISODate(changedAt);
  return status && changedAt && changedDate ? { status, changedAt, changedDate } : null;
}

function senadoSignal(row: SenadoExpediente): SenadoIndexSignal | null {
  const sourceId = row.idExpediente?.trim();
  const code = row.code.trim();
  const status = normalizedLiteral(row.status);
  return sourceId && code && status ? { status } : null;
}

function storedSenadoSignal(raw: unknown, expectedSourceId: string): SenadoIndexSignal | null {
  const payload = sourcePayload(raw);
  const row = storedListPayload(raw);
  if (!row || String(row.idExpediente ?? "").trim() !== expectedSourceId) return null;
  const ficha =
    payload?.ficha && typeof payload.ficha === "object" && !Array.isArray(payload.ficha)
      ? (payload.ficha as Record<string, unknown>)
      : null;
  // A list refresh can advance `payload.list.status` even when the authenticated
  // Ficha request failed. Keep comparing against the last verified Ficha status so
  // the next incremental cycle retries instead of accepting an unverified baseline.
  const status = normalizedLiteral(ficha?.currentStatus) ?? normalizedLiteral(row.status);
  return status ? { status } : null;
}

function sameDiputadosSignal(a: DiputadosIndexSignal, b: DiputadosIndexSignal): boolean {
  return a.status === b.status && a.changedAt === b.changedAt;
}

function sameSenadoSignal(a: SenadoIndexSignal, b: SenadoIndexSignal): boolean {
  return a.status === b.status;
}

interface DeduplicatedIndex<T> {
  rows: T[];
  /** Extra rows beyond the first observation of a source id. */
  duplicateRows: number;
  /** Source ids whose duplicate signal or code disagreed; all such rows are excluded. */
  conflictingIds: Set<string>;
  uniqueCount: number;
}

function deduplicateIndex<T>(
  rows: readonly T[],
  identity: (row: T) => string | null,
  signature: (row: T) => string,
): DeduplicatedIndex<T> {
  const firstById = new Map<string, { row: T; signature: string }>();
  const unkeyed: T[] = [];
  const conflictingIds = new Set<string>();
  let duplicateRows = 0;
  for (const row of rows) {
    const sourceId = identity(row)?.trim() || null;
    if (!sourceId) {
      unkeyed.push(row);
      continue;
    }
    const currentSignature = signature(row);
    const first = firstById.get(sourceId);
    if (!first) {
      firstById.set(sourceId, { row, signature: currentSignature });
      continue;
    }
    duplicateRows++;
    if (first.signature !== currentSignature) conflictingIds.add(sourceId);
  }
  return {
    rows: [
      ...[...firstById]
        .filter(([sourceId]) => !conflictingIds.has(sourceId))
        .map(([, value]) => value.row),
      ...unkeyed,
    ],
    duplicateRows,
    conflictingIds,
    uniqueCount: firstById.size + unkeyed.length,
  };
}

async function storedSnapshots(
  db: Database,
  source: string,
): Promise<Map<string, StoredIndexSnapshot>> {
  const snapshots = new Map<string, StoredIndexSnapshot>();
  let afterId = 0;
  for (;;) {
    const rows = await listInitiativeMovementCheckpoints(db, {
      source,
      afterId,
      limit: 1_000,
    });
    for (const row of rows) {
      snapshots.set(row.sourceId, { id: row.id, sourceId: row.sourceId, raw: row.raw });
    }
    if (rows.length < 1_000) return snapshots;
    afterId = rows[rows.length - 1]!.id;
  }
}

function currentDiputadosRaw(base: RawInitiative): Record<string, unknown> {
  const list = freshDiputadosListPayload(base.raw);
  if (!list) throw new Error(`Cámara list payload missing for ${base.sourceId}`);
  return {
    payload: { list },
    provenance: {
      sourceUrl: base.sourceUrl,
      endpoints: ["iniciativa/iniciativas"],
      observedCollections: ["list"],
      incrementalChangeSignal: ["estado", "fechaUltimoCambioPrincipal"],
    },
  };
}

async function checkpointDiputadosList(
  db: Database,
  base: RawInitiative,
  priorRaw: unknown,
  history?: readonly SilHistorico[],
): Promise<void> {
  const observation = currentDiputadosRaw(base);
  if (history) {
    (observation.payload as Record<string, unknown>).historicos = history;
    (
      observation.provenance as { endpoints: string[]; observedCollections: string[] }
    ).endpoints.push("iniciativa/historicos");
    (
      observation.provenance as { endpoints: string[]; observedCollections: string[] }
    ).observedCollections.push("historicos");
  }
  const raw = mergeObservedSourceRaw(priorRaw, observation);
  const record = toInitiativeRow(
    { ...base, raw },
    { preserveDetailFields: true, rawObserved: true },
  );
  // This timestamp is an explicit index field, even though the list-only mapper keeps
  // other detail-only columns protected through `preserveDetailFields`.
  record.officialStatusChangedAt = base.officialStatusChangedAt;
  await upsertInitiative(db, record, { recordObservedStatusChange: false });
}

function gapMessages(input: {
  invalidSignals: number;
  baselined: number;
  unverifiedHistories: number;
  duplicateRows?: number;
  conflictingDuplicateIds?: number;
  counterUnavailable?: boolean;
  countMismatch?: string | null;
}): string[] {
  const gaps: string[] = [];
  if (input.invalidSignals) {
    gaps.push(
      `${input.invalidSignals} fila(s) del índice carecieron de una señal oficial válida; no se consultó ni creó historial para ellas.`,
    );
  }
  if (input.baselined) {
    gaps.push(
      `${input.baselined} fila(s) no tenían una señal previa comparable; se guardó una línea base sin inventar eventos y el barrido semanal conserva la reconciliación histórica.`,
    );
  }
  if (input.unverifiedHistories) {
    gaps.push(
      `${input.unverifiedHistories} candidato(s) cambiado(s) no pudieron vincularse inequívocamente con un historial oficial verificado.`,
    );
  }
  if (input.duplicateRows) {
    gaps.push(
      `${input.duplicateRows} fila(s) duplicadas del índice se contaron una sola vez por sourceId.`,
    );
  }
  if (input.conflictingDuplicateIds) {
    gaps.push(
      `${input.conflictingDuplicateIds} sourceId(s) tuvieron código o señal contradictoria; se excluyeron sin checkpoint ni eventos.`,
    );
  }
  if (input.counterUnavailable) {
    gaps.push(
      "El total del catálogo global de la Cámara no estuvo disponible; el índice no se declara completo.",
    );
  }
  if (input.countMismatch) gaps.push(input.countMismatch);
  return gaps;
}

function failedSourceSummary(
  source: string,
  initiativeSource: string,
  runDate: string,
  error: string,
): IncrementalMovementSourceSummary {
  return {
    source,
    initiativeSource,
    runDate,
    ok: false,
    outcome: "FAILED",
    indexed: 0,
    validSignals: 0,
    unchanged: 0,
    changed: 0,
    baselined: 0,
    checked: 0,
    verified: 0,
    statusEventsSeen: 0,
    statusEventsInserted: 0,
    statusEventsReactivated: 0,
    statusEventsRetired: 0,
    duplicateRows: 0,
    conflictingDuplicateIds: 0,
    invalidSignals: 0,
    unverifiedHistories: 0,
    failures: 1,
    gaps: [],
    error,
  };
}

async function runPool<T>(
  rows: readonly T[],
  concurrency: number,
  work: (row: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const row = rows[cursor++];
      if (row === undefined) return;
      await work(row);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, rows.length || 1)) }, () => worker()),
  );
}

export async function ingestIncrementalDiputadosMovements(
  db: Database,
  opts: DiputadosIncrementalOptions = {},
): Promise<IncrementalMovementSourceSummary> {
  const source = DIPUTADOS_INCREMENTAL_MOVEMENTS_SOURCE;
  const runDate = dominicanTodayISO(opts.now);
  const adapter = opts.adapter ?? new SilDiputadosAdapter();
  const log = opts.log ?? (() => {});
  const concurrency = opts.concurrency ?? 4;
  const delayMs = opts.delayMs ?? 75;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
    throw new Error("concurrency must be an integer between 1 and 20");
  }
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 10_000) {
    throw new Error("delayMs must be an integer between 0 and 10000");
  }
  const runId = await beginIngestionRun(db, source, {
    runDate,
    mode: "FULL_INDEX_CHANGED_HISTORIES_ONLY",
    initiativeSource: DIPUTADOS_INITIATIVE_SOURCE,
  });
  try {
    log(`\n▶ ${source} — índice completo + historiales cambiados (${runDate})`);
    const snapshots = await storedSnapshots(db, DIPUTADOS_INITIATIVE_SOURCE);
    let officialCount: number | null = null;
    let counterUnavailable = false;
    try {
      officialCount = await adapter.count();
    } catch (error) {
      counterUnavailable = true;
      log(`    ⚠ contador oficial no disponible: ${errorMessage(error)}`);
    }
    const observedIndexRows: RawInitiative[] = [];
    for await (const row of adapter.list()) observedIndexRows.push(row);
    if (observedIndexRows.length === 0) {
      throw new Error("Cámara complete index returned zero initiatives");
    }
    let serialHighWatermark: number | null = null;
    let upstreamCatalogOmissions: number[] = [];
    if (adapter.catalogDiagnostics) {
      const diagnostics = await adapter.catalogDiagnostics();
      officialCount = diagnostics.catalogTotal;
      serialHighWatermark = diagnostics.serialHighWatermark;
      upstreamCatalogOmissions = diagnostics.upstreamCatalogOmissions;
      counterUnavailable = false;
    } else if (adapter.serialHighWatermark) {
      serialHighWatermark = await adapter.serialHighWatermark();
      if (officialCount !== null && serialHighWatermark < officialCount) {
        throw new Error(
          `SIL serial high-water mark ${serialHighWatermark} is below catalogue total ${officialCount}`,
        );
      }
      upstreamCatalogOmissions = silCatalogSerialOmissions(
        observedIndexRows.map((row) => row.code),
        serialHighWatermark,
      );
    }
    const dedupedIndex = deduplicateIndex(
      observedIndexRows,
      (row) => row.sourceId,
      (row) =>
        JSON.stringify({
          code: row.code?.trim() || null,
          signal: diputadosSignal(row.raw, row.sourceId),
        }),
    );
    const indexRows = dedupedIndex.rows;

    let validSignals = 0;
    let unchanged = 0;
    let baselined = 0;
    let invalidSignals = dedupedIndex.conflictingIds.size;
    let baselineFailures = 0;
    const failureExamples: string[] = [];
    const changedRows: Array<{
      base: RawInitiative;
      signal: DiputadosIndexSignal;
      prior: StoredIndexSnapshot;
    }> = [];
    for (const base of indexRows) {
      if (base.source !== DIPUTADOS_INITIATIVE_SOURCE) {
        invalidSignals++;
        continue;
      }
      const signal = diputadosSignal(base.raw, base.sourceId);
      if (!signal) {
        invalidSignals++;
        continue;
      }
      validSignals++;
      const prior = snapshots.get(base.sourceId);
      const previousSignal = prior ? storedDiputadosSignal(prior.raw, base.sourceId) : null;
      if (!prior || !previousSignal) {
        try {
          await checkpointDiputadosList(db, base, prior?.raw);
          baselined++;
        } catch (error) {
          baselineFailures++;
          if (failureExamples.length < 12) {
            failureExamples.push(`${base.sourceId}/baseline: ${errorMessage(error)}`);
          }
        }
      } else if (sameDiputadosSignal(signal, previousSignal)) {
        unchanged++;
      } else {
        changedRows.push({ base, signal, prior });
      }
    }

    let checked = 0;
    let verified = 0;
    let statusEventsSeen = 0;
    let statusEventsInserted = 0;
    let statusEventsReactivated = 0;
    let statusEventsRetired = 0;
    let unverifiedHistories = 0;
    let requestFailures = 0;
    await runPool(changedRows, concurrency, async ({ base, signal, prior }) => {
      checked++;
      try {
        const history = await adapter.historicos(base.sourceId);
        const events = history.map((item) => {
          const status = normalizedLiteral(item?.estado);
          if (!status) throw new Error("history row has no literal estado");
          return {
            sourceEventId:
              item.id == null || String(item.id).trim() === "" ? null : String(item.id).trim(),
            status,
            date: extractLeadingISODate(item.inicio),
            endDate: extractLeadingISODate(item.fin),
            note: null,
            source: DIPUTADOS_INITIATIVE_SOURCE,
            sourceUrl: base.sourceUrl,
            evidenceType: "SOURCE_HISTORY" as const,
            raw: item,
          };
        });
        if (!events.some((event) => statusKey(event.status) === statusKey(signal.status))) {
          unverifiedHistories++;
          return;
        }
        statusEventsSeen += events.length;
        const reconciled = await reconcileStatusHistorySnapshot(
          db,
          prior.id,
          DIPUTADOS_INITIATIVE_SOURCE,
          events,
          { complete: true },
        );
        statusEventsInserted += reconciled.inserted;
        statusEventsReactivated += reconciled.reactivated;
        statusEventsRetired += reconciled.retired;
        await checkpointDiputadosList(db, base, prior.raw, history);
        verified++;
      } catch (error) {
        requestFailures++;
        if (failureExamples.length < 12) {
          failureExamples.push(`${base.sourceId}/historicos: ${errorMessage(error)}`);
        }
      } finally {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    });

    const countMismatch =
      officialCount !== null && officialCount !== dedupedIndex.uniqueCount
        ? `El catálogo global reportó ${officialCount}, pero el índice enumeró ${dedupedIndex.uniqueCount} iniciativa(s) únicas.`
        : null;
    const gaps = gapMessages({
      invalidSignals,
      baselined,
      unverifiedHistories,
      duplicateRows: dedupedIndex.duplicateRows,
      conflictingDuplicateIds: dedupedIndex.conflictingIds.size,
      counterUnavailable,
      countMismatch,
    });
    const failures = baselineFailures + requestFailures;
    const outcome = failures || gaps.length ? "PARTIAL" : "COMPLETE";
    const error = failures ? `${failures} incremental Cámara operation(s) failed` : undefined;
    const coverageNotes = catalogCoverageNotes(upstreamCatalogOmissions);
    const summary: IncrementalMovementSourceSummary = {
      source,
      initiativeSource: DIPUTADOS_INITIATIVE_SOURCE,
      runDate,
      ok: failures === 0,
      outcome,
      indexed: dedupedIndex.uniqueCount,
      validSignals,
      unchanged,
      changed: changedRows.length,
      baselined,
      checked,
      verified,
      statusEventsSeen,
      statusEventsInserted,
      statusEventsReactivated,
      statusEventsRetired,
      duplicateRows: dedupedIndex.duplicateRows,
      conflictingDuplicateIds: dedupedIndex.conflictingIds.size,
      invalidSignals,
      unverifiedHistories,
      failures,
      gaps,
      ...(officialCount === null ? {} : { catalogTotal: officialCount }),
      ...(serialHighWatermark === null ? {} : { serialHighWatermark }),
      upstreamCatalogOmissions,
      coverageNotes,
      ...(error ? { error } : {}),
    };
    await recordIngestionRun(db, {
      source,
      runId,
      seen: dedupedIndex.uniqueCount,
      updated: verified + baselined,
      statusChanges: statusEventsInserted,
      ok: summary.ok,
      outcome,
      error,
      details: {
        indexSignal: ["estado", "fechaUltimoCambioPrincipal"],
        catalogTotal: officialCount,
        serialHighWatermark,
        upstreamCatalogOmissions,
        coverageNotes,
        ...summary,
        failureExamples,
      },
    });
    gaps.forEach((gap) => log(`    ⚠ ${gap}`));
    coverageNotes.forEach((note) => log(`    ℹ ${note}`));
    return summary;
  } catch (error) {
    const message = errorMessage(error);
    await recordIngestionRun(db, {
      source,
      runId,
      ok: false,
      outcome: "FAILED",
      error: message,
      details: { runDate, initiativeSource: DIPUTADOS_INITIATIVE_SOURCE },
    });
    return failedSourceSummary(source, DIPUTADOS_INITIATIVE_SOURCE, runDate, message);
  }
}

function batchesOf<T>(rows: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    batches.push(rows.slice(offset, offset + size));
  }
  return batches;
}

export async function ingestIncrementalSenadoMovements(
  db: Database,
  opts: SenadoIncrementalOptions = {},
): Promise<IncrementalMovementSourceSummary> {
  const source = SENADO_INCREMENTAL_MOVEMENTS_SOURCE;
  const runDate = dominicanTodayISO(opts.now);
  const adapter = opts.adapter ?? new SenadoSilAdapter();
  const log = opts.log ?? (() => {});
  const fichaBatchSize = opts.fichaBatchSize ?? 50;
  const fichaDelayMs = opts.fichaDelayMs ?? 150;
  const fichaBatchTimeoutMs = opts.fichaBatchTimeoutMs ?? 10 * 60_000;
  if (!Number.isInteger(fichaBatchSize) || fichaBatchSize < 1 || fichaBatchSize > 100) {
    throw new Error("fichaBatchSize must be an integer between 1 and 100");
  }
  const runId = await beginIngestionRun(db, source, {
    runDate,
    mode: "FULL_INDEX_CHANGED_FICHAS_ONLY",
    initiativeSource: SENADO_INITIATIVE_SOURCE,
  });
  try {
    log(`\n▶ ${source} — índice completo + Fichas cambiadas (${runDate})`);
    const snapshots = await storedSnapshots(db, SENADO_INITIATIVE_SOURCE);
    const observedIndexRows = await adapter.listDeposits();
    if (observedIndexRows.length === 0) {
      throw new Error("Senate complete index returned zero initiatives");
    }
    const dedupedIndex = deduplicateIndex(
      observedIndexRows,
      (row) => row.idExpediente,
      (row) =>
        JSON.stringify({
          code: row.code.trim(),
          signal: senadoSignal(row),
        }),
    );
    const indexRows = dedupedIndex.rows;

    let validSignals = 0;
    let unchanged = 0;
    let baselined = 0;
    let invalidSignals = dedupedIndex.conflictingIds.size;
    let baselineFailures = 0;
    const failureExamples: string[] = [];
    const changedRows: Array<{
      row: SenadoExpediente;
      signal: SenadoIndexSignal;
      prior: StoredIndexSnapshot;
    }> = [];
    for (const row of indexRows) {
      const signal = senadoSignal(row);
      const sourceId = row.idExpediente?.trim();
      if (!signal || !sourceId) {
        invalidSignals++;
        continue;
      }
      validSignals++;
      const prior = snapshots.get(sourceId);
      const previousSignal = prior ? storedSenadoSignal(prior.raw, sourceId) : null;
      if (!prior || !previousSignal) {
        try {
          await upsertInitiative(db, senateInitiativeRecord(row), {
            preserveVerifiedSenateFicha: true,
            recordObservedStatusChange: false,
          });
          baselined++;
        } catch (error) {
          baselineFailures++;
          if (failureExamples.length < 12) {
            failureExamples.push(`${sourceId}/baseline: ${errorMessage(error)}`);
          }
        }
      } else if (sameSenadoSignal(signal, previousSignal)) {
        unchanged++;
      } else {
        changedRows.push({ row, signal, prior });
      }
    }

    let checked = 0;
    let verified = 0;
    let statusEventsSeen = 0;
    let statusEventsInserted = 0;
    let statusEventsReactivated = 0;
    let statusEventsRetired = 0;
    let unverifiedHistories = 0;
    let requestFailures = 0;
    const identityMismatchExamples: string[] = [];
    for (const batch of batchesOf(changedRows, fichaBatchSize)) {
      checked += batch.length;
      let fetched: SenadoFichaBatchResult;
      try {
        fetched = await adapter.fetchFichaFactsBatch(
          batch.map(({ row }) => ({
            idExpediente: row.idExpediente!,
            expectedCode: row.code,
          })),
          { delayMs: fichaDelayMs, totalTimeoutMs: fichaBatchTimeoutMs },
        );
      } catch (error) {
        requestFailures += batch.length;
        if (failureExamples.length < 12) {
          failureExamples.push(`Ficha batch: ${errorMessage(error)}`);
        }
        continue;
      }
      const factsById = new Map(
        fetched.records.map((record) => [record.idExpediente, record.facts] as const),
      );
      const failedIds = new Set(fetched.failures.map((failure) => failure.idExpediente));
      for (const failure of fetched.failures) {
        if (failure.classification === "SOURCE_IDENTITY_MISMATCH") {
          unverifiedHistories++;
          if (identityMismatchExamples.length < 12) {
            identityMismatchExamples.push(
              `${failure.idExpediente}: lista ${failure.expectedCode}; Ficha ${failure.observedCode}`,
            );
          }
        } else {
          requestFailures++;
          if (failureExamples.length < 12) {
            failureExamples.push(`${failure.idExpediente}/Ficha: ${failure.error}`);
          }
        }
      }
      for (const { row, signal, prior } of batch) {
        const sourceId = row.idExpediente!;
        const facts = factsById.get(sourceId);
        if (!facts) {
          if (!failedIds.has(sourceId)) unverifiedHistories++;
          continue;
        }
        const currentStatusMatches = statusKey(facts.currentStatus) === statusKey(signal.status);
        const historyHasCurrentStatus = facts.history.some(
          (event) => statusKey(event.status) === statusKey(facts.currentStatus),
        );
        if (
          facts.initiativeCode.trim() !== row.code.trim() ||
          !facts.historyParseComplete ||
          !currentStatusMatches ||
          !historyHasCurrentStatus
        ) {
          unverifiedHistories++;
          continue;
        }
        const events = facts.history.map((event) => ({
          sourceEventId: null,
          status: event.status,
          date: event.date,
          endDate: null,
          note: null,
          source: SENADO_INITIATIVE_SOURCE,
          sourceUrl: row.sourceUrl,
          evidenceType: "SOURCE_HISTORY" as const,
          raw: {
            idExpediente: sourceId,
            controlId: "campos_nota_631",
            label: "Historial",
            literal: event.literal,
          },
        }));
        try {
          statusEventsSeen += events.length;
          const reconciled = await reconcileStatusHistorySnapshot(
            db,
            prior.id,
            SENADO_INITIATIVE_SOURCE,
            events,
            { complete: true },
          );
          statusEventsInserted += reconciled.inserted;
          statusEventsReactivated += reconciled.reactivated;
          statusEventsRetired += reconciled.retired;
          await upsertInitiative(db, senateInitiativeRecord(row, facts), {
            recordObservedStatusChange: false,
          });
          verified++;
        } catch (error) {
          requestFailures++;
          if (failureExamples.length < 12) {
            failureExamples.push(`${sourceId}/persist: ${errorMessage(error)}`);
          }
        }
      }
    }

    const gaps = gapMessages({
      invalidSignals,
      baselined,
      unverifiedHistories,
      duplicateRows: dedupedIndex.duplicateRows,
      conflictingDuplicateIds: dedupedIndex.conflictingIds.size,
    });
    const failures = baselineFailures + requestFailures;
    const outcome = failures || gaps.length ? "PARTIAL" : "COMPLETE";
    const error = failures ? `${failures} incremental Senate operation(s) failed` : undefined;
    const summary: IncrementalMovementSourceSummary = {
      source,
      initiativeSource: SENADO_INITIATIVE_SOURCE,
      runDate,
      ok: failures === 0,
      outcome,
      indexed: dedupedIndex.uniqueCount,
      validSignals,
      unchanged,
      changed: changedRows.length,
      baselined,
      checked,
      verified,
      statusEventsSeen,
      statusEventsInserted,
      statusEventsReactivated,
      statusEventsRetired,
      duplicateRows: dedupedIndex.duplicateRows,
      conflictingDuplicateIds: dedupedIndex.conflictingIds.size,
      invalidSignals,
      unverifiedHistories,
      failures,
      gaps,
      ...(error ? { error } : {}),
    };
    await recordIngestionRun(db, {
      source,
      runId,
      seen: dedupedIndex.uniqueCount,
      updated: verified + baselined,
      statusChanges: statusEventsInserted,
      ok: summary.ok,
      outcome,
      error,
      details: {
        indexSignal: ["lista_expedientes.status"],
        ...summary,
        failureExamples,
        identityMismatchExamples,
      },
    });
    gaps.forEach((gap) => log(`    ⚠ ${gap}`));
    return summary;
  } catch (error) {
    const message = errorMessage(error);
    await recordIngestionRun(db, {
      source,
      runId,
      ok: false,
      outcome: "FAILED",
      error: message,
      details: { runDate, initiativeSource: SENADO_INITIATIVE_SOURCE },
    });
    return failedSourceSummary(source, SENADO_INITIATIVE_SOURCE, runDate, message);
  }
}

/** Run both sources even if one fails; their health rows and checkpoints stay isolated. */
export async function ingestIncrementalMovements(
  db: Database,
  opts: SharedIncrementalOptions & {
    diputados?: Omit<DiputadosIncrementalOptions, keyof SharedIncrementalOptions>;
    senado?: Omit<SenadoIncrementalOptions, keyof SharedIncrementalOptions>;
  } = {},
): Promise<IncrementalMovementsSummary> {
  const runDate = dominicanTodayISO(opts.now);
  const diputados = await ingestIncrementalDiputadosMovements(db, {
    ...opts.diputados,
    now: opts.now,
    log: opts.log,
  });
  const senado = await ingestIncrementalSenadoMovements(db, {
    ...opts.senado,
    now: opts.now,
    log: opts.log,
  });
  return { runDate, ok: diputados.ok && senado.ok, diputados, senado };
}
