/**
 * Byte-only verification for deposited bill documents that have source metadata but
 * no fresh persisted PDF validation. This command never invokes a model.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import {
  beginOrResumeDocumentPdfVerificationCycle,
  checkpointDocumentPdfVerificationCycle,
  createDb,
  finishDocumentPdfVerificationCycle,
  listOfficialDepositedDocumentsForVerification,
  recordIngestionRun,
  storeDocumentContent,
  verifyAndStoreDocumentPdfReachability,
  DOCUMENT_PDF_VERIFICATION_RUN_SOURCE,
  type Database,
  type DocumentPdfVerificationCycle,
  type OfficialDocumentVerificationCandidate,
} from "@oculis/db";
import { numericArg } from "./cli.js";
import {
  extractOfficialPdfContent,
  OfficialDocumentPdfError,
  officialDocumentDomains,
  verifyOfficialPdfBinaryWithRetry,
  type PdfTextExtractor,
} from "./official-document-pdf.js";
import { loadEnv } from "./env.js";

export interface VerifyDocumentsBatchOptions {
  documentId?: number;
  initiativeId?: number;
  beforeDocumentId?: number;
  limit?: number;
  fetchImpl?: typeof fetch;
  extractor?: PdfTextExtractor;
  /** Optional/manual full download and text extraction; false keeps the fast prefix SLA. */
  extractText?: boolean;
  log?: (message: string) => void;
}

export interface VerifyDocumentsBatchResult {
  candidates: number;
  /** Binary-reachable official PDFs, irrespective of optional extraction outcome. */
  verified: number;
  newVersions: number;
  refreshed: number;
  extractionFailed: number;
  failed: number;
  operationalFailed: number;
  definitiveUnavailable: number;
  /** Reachability failures only; these make the public PDF unavailable. */
  failures: Array<{ documentId: number; error: string }>;
  /** Optional text-extraction failures; these never make the public PDF unavailable. */
  extractionFailures: Array<{ documentId: number; error: string }>;
  operationalFailures: Array<{ documentId: number; error: string }>;
  definitiveFailures: Array<{ documentId: number; error: string }>;
  /** Exclusive descending cursor for the next bounded page; null means this scan ended. */
  nextBeforeDocumentId: number | null;
}

interface VerifyDocumentDependencies {
  fetchImpl?: typeof fetch;
  extractor?: PdfTextExtractor;
  extractText?: boolean;
}

export type VerifyDocumentOutcome = "new-version" | "refreshed" | "extraction-failed";
export type VerifyDocumentFailureOutcome = "operational-failed" | "unavailable";

/**
 * Non-retryable source evidence that proves the published object cannot currently be
 * opened as an official PDF. Programming, configuration, persistence and checkpoint
 * errors deliberately stay outside this set and therefore remain operational failures.
 */
const DEFINITIVE_PDF_UNAVAILABLE_CODES = new Set([
  "INVALID_URL",
  "INVALID_URL_PROTOCOL",
  "INVALID_URL_CREDENTIALS",
  "UNOFFICIAL_DOCUMENT_HOST",
  "TOO_MANY_PDF_REDIRECTS",
  "INVALID_PDF_REDIRECT",
  "PDF_HTTP_ERROR",
  "INVALID_PDF_MIME",
  "PDF_TOO_LARGE",
  "PDF_TOO_SMALL",
  "INVALID_PDF_MAGIC",
  "PDF_EMPTY_BODY",
]);

function isDefinitivePdfUnavailable(error: unknown): error is OfficialDocumentPdfError {
  return (
    error instanceof OfficialDocumentPdfError &&
    !error.retryable &&
    DEFINITIVE_PDF_UNAVAILABLE_CODES.has(error.code)
  );
}

function classifyVerificationFailure(error: unknown): VerifyDocumentFailureOutcome {
  return isDefinitivePdfUnavailable(error) ? "unavailable" : "operational-failed";
}

async function verifyDocumentCandidate(
  db: Database,
  candidate: OfficialDocumentVerificationCandidate,
  opts: VerifyDocumentDependencies = {},
): Promise<{ outcome: VerifyDocumentOutcome; extractionError?: string }> {
  const binary = await verifyAndStoreDocumentPdfReachability(db, {
    documentId: candidate.documentId,
    sourceSnapshot: candidate.sourceSnapshot,
    verify: () =>
      verifyOfficialPdfBinaryWithRetry(candidate.url, {
        allowedDomains: officialDocumentDomains(candidate.source),
        fetchImpl: opts.fetchImpl,
        readMode: "prefix",
      }),
    // A transient/network or internal failure must never replace prior positive
    // evidence. Only an authenticated, definitive source response is fail-closed.
    persistFailure: isDefinitivePdfUnavailable,
  });
  if (!opts.extractText) {
    return { outcome: binary.verification.inserted ? "new-version" : "refreshed" };
  }
  try {
    const complete = await verifyOfficialPdfBinaryWithRetry(candidate.url, {
      allowedDomains: officialDocumentDomains(candidate.source),
      fetchImpl: opts.fetchImpl,
      readMode: "complete",
    });
    const prepared = await extractOfficialPdfContent(complete, {
      extractor: opts.extractor,
    });
    const content = await storeDocumentContent(db, {
      documentId: candidate.documentId,
      sourceSnapshot: candidate.sourceSnapshot,
      ...prepared,
    });
    return { outcome: content.inserted ? "new-version" : "refreshed" };
  } catch (cause) {
    return {
      outcome: "extraction-failed",
      extractionError: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/**
 * Verify a bounded descending page of official deposited texts without AI.
 *
 * Binary success is persisted for the exact snapshot before optional extraction. A
 * failed reachability probe atomically replaces prior availability; an extraction
 * failure remains separately visible without hiding a valid public PDF.
 */
export async function runVerifyDocumentsBatch(
  db: Database,
  opts: VerifyDocumentsBatchOptions = {},
): Promise<VerifyDocumentsBatchResult> {
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 100));
  const log = opts.log ?? (() => {});
  const page = await listOfficialDepositedDocumentsForVerification(db, {
    documentId: opts.documentId,
    initiativeId: opts.initiativeId,
    beforeDocumentId: opts.beforeDocumentId,
    limit,
    unverifiedOnly: opts.documentId === undefined,
  });
  const failures: Array<{ documentId: number; error: string }> = [];
  const extractionFailures: Array<{ documentId: number; error: string }> = [];
  const operationalFailures: Array<{ documentId: number; error: string }> = [];
  const definitiveFailures: Array<{ documentId: number; error: string }> = [];
  let verified = 0;
  let newVersions = 0;
  let refreshed = 0;
  let extractionFailed = 0;

  for (const candidate of page) {
    try {
      const result = await verifyDocumentCandidate(db, candidate, opts);
      verified++;
      if (result.outcome === "new-version") {
        newVersions++;
        log(`  ✔ documento ${candidate.documentId}: PDF accesible (texto extraído y guardado)`);
      } else if (result.outcome === "refreshed") {
        refreshed++;
        log(`  ✔ documento ${candidate.documentId}: PDF accesible (extracción renovada)`);
      } else {
        extractionFailed++;
        extractionFailures.push({
          documentId: candidate.documentId,
          error: result.extractionError ?? "Falló la extracción opcional.",
        });
        log(
          `  ✔ documento ${candidate.documentId}: PDF accesible` +
            ` (extracción opcional falló: ${result.extractionError})`,
        );
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      const failure = { documentId: candidate.documentId, error };
      failures.push(failure);
      if (classifyVerificationFailure(cause) === "unavailable") {
        definitiveFailures.push(failure);
      } else {
        operationalFailures.push(failure);
      }
      log(`  ✖ documento ${candidate.documentId}: ${error}`);
    }
  }

  const lastDocumentId = page.at(-1)?.documentId ?? null;
  return {
    candidates: page.length,
    verified,
    newVersions,
    refreshed,
    extractionFailed,
    failed: failures.length,
    operationalFailed: operationalFailures.length,
    definitiveUnavailable: definitiveFailures.length,
    failures,
    extractionFailures,
    operationalFailures,
    definitiveFailures,
    nextBeforeDocumentId:
      opts.documentId !== undefined || page.length < limit ? null : lastDocumentId,
  };
}

export const DOCUMENT_PDF_VERIFICATION_MAX_CYCLE_AGE_MS = 24 * 60 * 60 * 1_000;

export interface RunDocumentPdfVerificationCycleOptions extends VerifyDocumentDependencies {
  pageSize?: number;
  /** Parallel prefix probes; persistence remains exact-snapshot serialized per document. */
  concurrency?: number;
  /** Test/controlled-run boundary. Omit to exhaust exactly one durable cycle. */
  maxItems?: number;
  verifyItem?: (
    db: Database,
    item: OfficialDocumentVerificationCandidate,
  ) => Promise<
    VerifyDocumentOutcome | { outcome: VerifyDocumentOutcome; extractionError?: string }
  >;
  onCycle?: (cycle: DocumentPdfVerificationCycle & { resumed: boolean }) => void | Promise<void>;
  onResult?: (
    item: OfficialDocumentVerificationCandidate,
    result: VerifyDocumentOutcome | VerifyDocumentFailureOutcome,
    error?: string,
  ) => void | Promise<void>;
  now?: () => number;
}

export interface RunDocumentPdfVerificationCycleResult {
  cycle: DocumentPdfVerificationCycle;
  resumed: boolean;
  completed: boolean;
  invocationInspected: number;
  overdue: boolean;
  health: DocumentPdfVerificationHealth;
}

export interface DocumentPdfVerificationHealth {
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL";
  error: string | null;
  coverageNotes: string[];
}

/**
 * Definitive negative PDF evidence is a valid completed observation, not an outage.
 * It remains visible as coverage while only operational/incomplete work turns the
 * source-health meter amber and the command exit status nonzero.
 */
export function assessDocumentPdfVerificationHealth(
  cycle: DocumentPdfVerificationCycle,
  opts: { completed: boolean; overdue: boolean },
): DocumentPdfVerificationHealth {
  const problems = [
    !opts.completed ? "el recorrido no terminó" : "",
    cycle.operationalFailures
      ? `${cycle.operationalFailures} fallo(s) operacional(es) agotaron sus reintentos`
      : "",
    opts.overdue ? "el ciclo excedió 24 horas" : "",
  ].filter(Boolean);
  const ok = problems.length === 0;
  return {
    ok,
    outcome: ok ? "COMPLETE" : "PARTIAL",
    error: ok ? null : problems.join("; "),
    coverageNotes: cycle.definitiveUnavailable
      ? [
          `${cycle.definitiveUnavailable} PDF oficial(es) quedaron definitivamente no ` +
            "disponibles después de validar la respuesta, el MIME y la firma binaria; " +
            "permanecen no disponibles para el usuario.",
        ]
      : [],
  };
}

/** Process exit contract kept explicit and regression-testable. */
export function documentPdfVerificationExitCode(health: DocumentPdfVerificationHealth): 0 | 1 {
  return health.ok ? 0 : 1;
}

async function persistDocumentPdfVerificationHealth(
  db: Database,
  cycle: DocumentPdfVerificationCycle,
  health: DocumentPdfVerificationHealth,
): Promise<void> {
  await recordIngestionRun(db, {
    runId: cycle.runId,
    source: DOCUMENT_PDF_VERIFICATION_RUN_SOURCE,
    seen: cycle.inspected,
    inserted: cycle.newVersions,
    updated: cycle.refreshed,
    ok: health.ok,
    outcome: health.outcome,
    error: health.error,
    details: {
      kind: "DOCUMENT_PDF_BYTE_VERIFICATION",
      checkpointVersion: 3,
      checkpointLifecycle: "CHECKPOINTED_CYCLE",
      cycleStartedAtMs: cycle.cycleStartedAtMs,
      cycleMaxDocumentId: cycle.cycleMaxDocumentId,
      beforeDocumentId: cycle.beforeDocumentId,
      inspected: cycle.inspected,
      verified: cycle.verified,
      newVersions: cycle.newVersions,
      refreshed: cycle.refreshed,
      extractionFailed: cycle.extractionFailed,
      failed: cycle.failed,
      operationalFailures: cycle.operationalFailures,
      definitiveUnavailable: cycle.definitiveUnavailable,
      failureSamples: cycle.failureSamples,
      extractionFailureSamples: cycle.extractionFailureSamples,
      coverageNotes: health.coverageNotes,
    },
  });
}

function verificationCycleIsOverdue(cycle: DocumentPdfVerificationCycle, now: number): boolean {
  return now - cycle.cycleStartedAtMs >= DOCUMENT_PDF_VERIFICATION_MAX_CYCLE_AGE_MS;
}

/**
 * Exhaust or advance one durable, fixed high-water cycle of PDF checks due for renewal.
 * Every outcome checkpoints its document id, including permanent failures, so an
 * unavailable recent file can never prevent older candidates from being inspected.
 */
export async function runDocumentPdfVerificationCycle(
  db: Database,
  opts: RunDocumentPdfVerificationCycleOptions = {},
): Promise<RunDocumentPdfVerificationCycleResult> {
  const pageSize = opts.pageSize ?? 20;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new Error("pageSize must be an integer between 1 and 100");
  }
  if (opts.maxItems !== undefined && (!Number.isSafeInteger(opts.maxItems) || opts.maxItems < 1)) {
    throw new Error("maxItems must be a positive integer");
  }
  const concurrency = opts.concurrency ?? 3;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 4) {
    throw new Error("concurrency must be an integer between 1 and 4");
  }

  const started = await beginOrResumeDocumentPdfVerificationCycle(db);
  await opts.onCycle?.(started);
  let cycle: DocumentPdfVerificationCycle = started;
  let invocationInspected = 0;
  const verifyItem =
    opts.verifyItem ??
    ((database: Database, item: OfficialDocumentVerificationCandidate) =>
      verifyDocumentCandidate(database, item, opts));

  while (cycle.cycleMaxDocumentId !== null) {
    if (opts.maxItems !== undefined && invocationInspected >= opts.maxItems) {
      const overdue = verificationCycleIsOverdue(cycle, opts.now?.() ?? Date.now());
      return {
        cycle,
        resumed: started.resumed,
        completed: false,
        invocationInspected,
        overdue,
        health: assessDocumentPdfVerificationHealth(cycle, { completed: false, overdue }),
      };
    }
    const remaining =
      opts.maxItems === undefined
        ? pageSize
        : Math.min(pageSize, opts.maxItems - invocationInspected);
    const page = await listOfficialDepositedDocumentsForVerification(db, {
      limit: remaining,
      beforeDocumentId: cycle.beforeDocumentId ?? undefined,
      atOrBeforeDocumentId: cycle.cycleMaxDocumentId,
      verificationDueOnly: true,
    });
    if (page.length === 0) break;

    const outcomes = await concurrentMap(page, concurrency, async (item) => {
      try {
        const verifiedResult = await verifyItem(db, item);
        return typeof verifiedResult === "string"
          ? { result: verifiedResult }
          : { result: verifiedResult.outcome, error: verifiedResult.extractionError };
      } catch (cause) {
        return {
          result: classifyVerificationFailure(cause),
          error: cause instanceof Error ? cause.message : String(cause),
        };
      }
    });

    // Checkpoint in deterministic descending-id order after the parallel network phase.
    for (const [index, item] of page.entries()) {
      const { result, error } = outcomes[index]!;
      cycle = await checkpointDocumentPdfVerificationCycle(db, {
        runId: cycle.runId,
        expectedBeforeDocumentId: cycle.beforeDocumentId,
        nextBeforeDocumentId: item.documentId,
        result,
        error,
      });
      invocationInspected++;
      await opts.onResult?.(item, result, error);
    }
  }

  cycle = await finishDocumentPdfVerificationCycle(db, cycle.runId);
  const overdue = verificationCycleIsOverdue(cycle, opts.now?.() ?? Date.now());
  const health = assessDocumentPdfVerificationHealth(cycle, { completed: true, overdue });
  await persistDocumentPdfVerificationHealth(db, cycle, health);
  return {
    cycle,
    resumed: started.resumed,
    completed: true,
    invocationInspected,
    overdue,
    health,
  };
}

async function concurrentMap<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= values.length) return;
        results[index] = await map(values[index]!);
      }
    }),
  );
  return results;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function printUsage(): void {
  console.log(`Uso:
  npm run verify-documents -w @oculis/worker -- [opciones]

Opciones:
  --all                  Agota o reanuda un ciclo durable con checkpoint por documento
  --document-id N        Verifica un documento concreto, aunque tenga verificación reciente
  --initiative-id N      Verifica documentos no verificados de una iniciativa
  --before-document-id N Continúa por IDs menores al cursor del lote anterior
  --limit N              Lote o página del ciclo (20; máximo 100)
  --concurrency N        Probes binarios paralelos para --all (3; máximo 4)
  --extract-text         Descarga completa y extrae texto (manual; más lento)
  --help                 Muestra esta ayuda

Descarga y autentica los bytes de PDF oficiales depositados; luego intenta extraer su texto
como fase secundaria. No requiere credenciales de IA, no invoca ningún modelo y no genera
resúmenes. Solo un fallo binario marca el documento como no disponible; un PDF escaneado o
no extraíble sigue disponible. --all renueva desde las 12 horas, antes de la caducidad
pública de 24 horas, y reanuda automáticamente el mismo cursor si el proceso se interrumpe.`);
}

async function main(): Promise<void> {
  loadEnv();
  if (flag("help")) {
    printUsage();
    return;
  }
  const all = flag("all");
  const documentId = numericArg(process.argv, "document-id", { min: 1 });
  const initiativeId = numericArg(process.argv, "initiative-id", { min: 1 });
  const beforeDocumentId = numericArg(process.argv, "before-document-id", { min: 1 });
  const limit = numericArg(process.argv, "limit", { min: 1, max: 100 }) ?? 20;
  const concurrency = numericArg(process.argv, "concurrency", { min: 1, max: 4 }) ?? 3;
  const extractText = flag("extract-text");
  if (documentId !== undefined && initiativeId !== undefined) {
    throw new Error("Use --document-id or --initiative-id, not both");
  }
  if (
    all &&
    (documentId !== undefined || initiativeId !== undefined || beforeDocumentId !== undefined)
  ) {
    throw new Error(
      "--all usa un checkpoint durable automático y no acepta filtros ni --before-document-id",
    );
  }

  console.log("▶ Oculis · verificación factual de PDF oficiales (sin IA)");
  const handle = createDb();
  try {
    await handle.ensureSchema();
    if (all) {
      const result = await runDocumentPdfVerificationCycle(handle.db, {
        pageSize: limit,
        concurrency,
        extractText,
        onCycle(cycle) {
          const action = cycle.resumed ? "reanudando" : "iniciando";
          const ageMinutes = Math.max(
            0,
            Math.floor((Date.now() - cycle.cycleStartedAtMs) / 60_000),
          );
          console.log(
            `${action} ciclo ${cycle.runId} · máximo ${cycle.cycleMaxDocumentId ?? "ninguno"} · ` +
              `checkpoint ${cycle.beforeDocumentId ?? "inicio"} · edad ${ageMinutes} min`,
          );
          if (ageMinutes >= 24 * 60) {
            console.error(
              "  ✖ el ciclo ya excedió 24 horas; seguirá avanzando, pero el job quedará en fallo",
            );
            process.exitCode = 1;
          }
        },
        onResult(item, outcome, error) {
          if (outcome === "new-version") {
            console.log(`  ✔ documento ${item.documentId}: disponibilidad PDF guardada`);
          } else if (outcome === "refreshed") {
            console.log(`  ✔ documento ${item.documentId}: disponibilidad PDF renovada`);
          } else if (outcome === "extraction-failed") {
            console.log(
              `  ✔ documento ${item.documentId}: PDF accesible; extracción opcional falló (${error})`,
            );
          } else if (outcome === "operational-failed") {
            console.log(
              `  ⚠ documento ${item.documentId}: fallo operacional; se reintentará (${error})`,
            );
          } else {
            console.log(`  ℹ documento ${item.documentId}: PDF no disponible (${error})`);
          }
        },
      });
      const cycle = result.cycle;
      const health = result.health;
      const state = result.completed ? "completo" : "checkpoint guardado";
      console.log(
        `\n${health.ok ? "✔" : "⚠"} ciclo ${cycle.runId} ${state} · ` +
          `inspeccionados ${cycle.inspected} · verificados ${cycle.verified} · ` +
          `versiones nuevas ${cycle.newVersions} · renovados ${cycle.refreshed} · ` +
          `sin texto extraíble ${cycle.extractionFailed} · ` +
          `fallos operacionales ${cycle.operationalFailures} · ` +
          `no disponibles ${cycle.definitiveUnavailable} · fallidos ${cycle.failed}`,
      );
      health.coverageNotes.forEach((note) => console.log(`  ℹ ${note}`));
      if (result.overdue) {
        console.error("  ✖ el ciclo alcanzó 24 horas; revisar capacidad o fuentes oficiales");
      }
      if (documentPdfVerificationExitCode(health)) process.exitCode = 1;
      return;
    }

    const result = await runVerifyDocumentsBatch(handle.db, {
      documentId,
      initiativeId,
      beforeDocumentId,
      limit,
      extractText,
      log: (message) => console.log(message),
    });
    console.log(
      `\n${result.operationalFailed ? "⚠" : "✔"} candidatos ${result.candidates} · ` +
        `verificados ${result.verified} · versiones nuevas ${result.newVersions} · ` +
        `renovados ${result.refreshed} · sin texto extraíble ${result.extractionFailed} · ` +
        `fallos operacionales ${result.operationalFailed} · ` +
        `no disponibles ${result.definitiveUnavailable} · fallidos ${result.failed}`,
    );
    if (result.nextBeforeDocumentId !== null) {
      console.log(`  continuar: --before-document-id ${result.nextBeforeDocumentId}`);
    }
    if (result.operationalFailed) process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
