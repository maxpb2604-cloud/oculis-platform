import {
  beginInitiativeProponentReconciliationRun,
  finishInitiativeProponentReconciliationRun,
  listInitiativeProponentBackfillCandidates,
  listLegislators,
  replaceInitiativeProponents,
  resolveLegislatorProfileIds,
  type Database,
  type InitiativeProponentBackfillCandidate,
  type InitiativeProponentInput,
} from "@oculis/db";
import {
  resolveSenadoSilFichaProponents,
  REVIEWED_SENADO_SIL_PERSON_BRIDGE,
  SenadoSilAdapter,
  SENADO_SIL_PERSON_NAMESPACE,
  SENADO_SIL_PROPONENT_CATALOG_VERSION,
  senateSilExactNameKey,
  validateSenadoSilProponentCatalog,
  type SenadoSilProponentCatalog,
} from "@oculis/scrapers";

export const DIPUTADOS_SIL_PERSON_NAMESPACE = "sil-diputados-legislator" as const;
export const DIPUTADOS_PROPONENT_RESOLVER_VERSION = "sil-legislador-id-v1" as const;
export const SENATE_PROPONENT_RESOLVER_VERSION =
  `senado-selector-${SENADO_SIL_PROPONENT_CATALOG_VERSION}-reviewed-bridge-v1` as const;

type Log = (message: string) => void;

export interface ProponentSnapshot {
  /** False means the source collection was not observed; the prior DB snapshot must survive. */
  observed: boolean;
  rows: InitiativeProponentInput[];
}

interface SenadoLinkContext {
  catalog: SenadoSilProponentCatalog;
  profileIdByPersonSourceId: ReadonlyMap<string, number>;
}

export interface LinkSourceSummary {
  source: "sil-diputados" | "senado-sil";
  candidates: number;
  observed: number;
  replaced: number;
  skippedUnobserved: number;
  unresolved: number;
  failures: number;
  failureExamples: string[];
  /** Whether this run could certify a true zero; independent from successful link writes. */
  coverage: "not-requested" | "complete" | "incomplete";
  coverageReason: string | null;
}

export interface LinkInitiativeProponentsSummary {
  ok: boolean;
  diputados: LinkSourceSummary;
  senado: LinkSourceSummary;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function positiveSourceId(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
}

function publishedDiputadosName(row: Record<string, unknown>): string | null {
  const full = typeof row.nombreCompleto === "string" ? row.nombreCompleto : "";
  const first = typeof row.nombres === "string" ? row.nombres : "";
  const last = typeof row.apellidos === "string" ? row.apellidos : "";
  const value = full.trim() ? full : `${first} ${last}`;
  return value.normalize("NFC").replace(/\s+/g, " ").trim() || null;
}

function diputadosPublishedRows(raw: unknown): { observed: boolean; values: unknown[] } {
  const payload = record(record(raw)?.payload);
  if (!payload) return { observed: false, values: [] };
  const key = own(payload, "proponentes")
    ? "proponentes"
    : own(payload, "proponents")
      ? "proponents"
      : null;
  if (!key) return { observed: false, values: [] };
  const value = payload[key];
  if (!Array.isArray(value)) {
    throw new Error(`Diputados ${key} collection was observed with a non-array payload`);
  }
  return { observed: true, values: value };
}

/**
 * Build a complete authoritative Diputados snapshot from exact upstream legislator ids.
 * The profile map is keyed only by `roster-diputados.source_id`; names never resolve it.
 */
export function buildDiputadosProponentSnapshot(
  raw: unknown,
  profileIdBySourceId: ReadonlyMap<string, number | null> = new Map(),
): ProponentSnapshot {
  const published = diputadosPublishedRows(raw);
  if (!published.observed) return { observed: false, rows: [] };
  const rows = published.values.map((value, ordinal): InitiativeProponentInput => {
    const sourceRow = record(value);
    if (!sourceRow) throw new Error(`Diputados proponent ${ordinal} is not an object`);
    const publishedName = publishedDiputadosName(sourceRow);
    if (!publishedName) throw new Error(`Diputados proponent ${ordinal} has no published name`);
    const personSourceId = positiveSourceId(sourceRow.legisladorId);
    const legislatorId = personSourceId ? (profileIdBySourceId.get(personSourceId) ?? null) : null;
    return {
      legislatorId,
      personNamespace: DIPUTADOS_SIL_PERSON_NAMESPACE,
      personSourceId,
      publishedName,
      principal: typeof sourceRow.principal === "boolean" ? sourceRow.principal : null,
      ordinal,
      matchBasis: legislatorId === null ? "unresolved" : "official-id",
      evidence: {
        sourcePath: "raw.payload.proponentes",
        personNamespace: DIPUTADOS_SIL_PERSON_NAMESPACE,
        publishedRow: sourceRow,
      },
    };
  });
  return { observed: true, rows };
}

function senatePublishedLiteral(raw: unknown): { observed: boolean; literal: string | null } {
  const ficha = record(record(record(raw)?.payload)?.ficha);
  if (!ficha || !own(ficha, "proponents")) return { observed: false, literal: null };
  const value = ficha.proponents;
  if (value === null) return { observed: true, literal: null };
  if (typeof value !== "string") {
    throw new Error("Senate Ficha proponents field was observed with a non-string payload");
  }
  return { observed: true, literal: value };
}

/** Build one Senate snapshot from the exact catalog-name → Senate person-id bridge. */
export function buildSenateProponentSnapshot(
  raw: unknown,
  context: SenadoLinkContext,
): ProponentSnapshot {
  const published = senatePublishedLiteral(raw);
  if (!published.observed) return { observed: false, rows: [] };
  const resolutions = resolveSenadoSilFichaProponents(published.literal, context.catalog.people);
  return {
    observed: true,
    rows: resolutions.map((resolution, ordinal): InitiativeProponentInput => {
      const personSourceId = resolution.person?.sourceId ?? null;
      const legislatorId = personSourceId
        ? (context.profileIdByPersonSourceId.get(personSourceId) ?? null)
        : null;
      return {
        legislatorId,
        personNamespace: SENADO_SIL_PERSON_NAMESPACE,
        personSourceId,
        publishedName: resolution.publishedName,
        principal: null,
        ordinal,
        matchBasis: legislatorId === null ? "unresolved" : "official-selector-exact-name",
        evidence: {
          sourcePath: "raw.payload.ficha.proponents",
          controlId: "campos_nota_644",
          catalogVersion: SENADO_SIL_PROPONENT_CATALOG_VERSION,
          catalogSourceUrl: context.catalog.provenance.sourceUrl,
          literal: published.literal,
          segment: resolution.segment,
          resolution: resolution.resolution,
        },
      };
    }),
  };
}

async function prepareSenateContext(
  db: Database,
  catalog: SenadoSilProponentCatalog,
): Promise<SenadoLinkContext> {
  validateSenadoSilProponentCatalog(catalog);
  const activeSenateProfiles = (await listLegislators(db, { chamber: "SENADO" })).filter(
    (profile) => profile.source === "roster-senado",
  );
  if (activeSenateProfiles.length !== 32) {
    throw new Error(
      `Active Senate roster drift: expected 32 roster-senado profiles, observed ${activeSenateProfiles.length}`,
    );
  }
  const profilesBySlug = new Map(
    activeSenateProfiles.map((profile) => [profile.sourceId, profile]),
  );
  if (profilesBySlug.size !== 32) throw new Error("Active Senate roster contains duplicate slugs");
  for (const reviewed of REVIEWED_SENADO_SIL_PERSON_BRIDGE) {
    const profile = profilesBySlug.get(reviewed.rosterSourceId);
    if (
      !profile ||
      senateSilExactNameKey(profile.fullName) !== senateSilExactNameKey(reviewed.rosterOfficialName)
    ) {
      throw new Error(
        `Active Senate roster drift for ${reviewed.rosterSourceId}: expected ${reviewed.rosterOfficialName}, observed ${profile?.fullName ?? "missing"}`,
      );
    }
  }

  const profileIds = await resolveLegislatorProfileIds(
    db,
    REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((reviewed) => ({
      source: "roster-senado",
      sourceId: reviewed.rosterSourceId,
      chamber: "SENADO",
    })),
  );
  if (profileIds.some((profileId) => profileId === null)) {
    throw new Error("Reviewed Senate bridge did not resolve all 32 active profiles by source id");
  }
  if (new Set(profileIds).size !== 32) {
    throw new Error("Reviewed Senate bridge did not resolve to 32 unique active profiles");
  }
  return {
    catalog,
    profileIdByPersonSourceId: new Map(
      REVIEWED_SENADO_SIL_PERSON_BRIDGE.map((reviewed, index) => [
        reviewed.personSourceId,
        profileIds[index]!,
      ]),
    ),
  };
}

function emptySummary(source: LinkSourceSummary["source"]): LinkSourceSummary {
  return {
    source,
    candidates: 0,
    observed: 0,
    replaced: 0,
    skippedUnobserved: 0,
    unresolved: 0,
    failures: 0,
    failureExamples: [],
    coverage: "not-requested",
    coverageReason: null,
  };
}

function sourceSetupFailure(
  source: LinkSourceSummary["source"],
  error: unknown,
  log: Log,
): LinkSourceSummary {
  const summary = emptySummary(source);
  summary.failures = 1;
  const message = `source setup: ${(error as Error)?.message ?? String(error)}`;
  summary.failureExamples.push(message);
  log(`    ⚠ ${source} preserved every prior link after ${message}`);
  return summary;
}

type ReconciliationRunHandle = Awaited<
  ReturnType<typeof beginInitiativeProponentReconciliationRun>
>;

async function beginFullCoverage(
  db: Database,
  source: LinkSourceSummary["source"],
): Promise<ReconciliationRunHandle> {
  return beginInitiativeProponentReconciliationRun(
    db,
    source === "sil-diputados"
      ? {
          initiativeSource: source,
          personNamespace: DIPUTADOS_SIL_PERSON_NAMESPACE,
          rosterSource: "roster-diputados",
          chamber: "DIPUTADOS",
          resolverVersion: DIPUTADOS_PROPONENT_RESOLVER_VERSION,
        }
      : {
          initiativeSource: source,
          personNamespace: SENADO_SIL_PERSON_NAMESPACE,
          rosterSource: "roster-senado",
          chamber: "SENADO",
          resolverVersion: SENATE_PROPONENT_RESOLVER_VERSION,
        },
  );
}

async function finishFullCoverage(
  db: Database,
  run: ReconciliationRunHandle,
  summary: LinkSourceSummary,
  log: Log,
): Promise<void> {
  try {
    const result = await finishInitiativeProponentReconciliationRun(db, run.runId, {
      candidates: summary.candidates,
      observed: summary.observed,
      replaced: summary.replaced,
      skippedUnobserved: summary.skippedUnobserved,
      unresolved: summary.unresolved,
      failures: summary.failures,
    });
    if (result.status === "failed") {
      const message = `full coverage not declared: ${result.reason ?? "unspecified incompatibility"}`;
      summary.coverage = "incomplete";
      summary.coverageReason = result.reason ?? "unspecified incompatibility";
      log(`    ⚠ ${summary.source} ${message}`);
    } else {
      summary.coverage = "complete";
      summary.coverageReason = null;
    }
  } catch (error) {
    const message = `coverage finalization: ${(error as Error)?.message ?? String(error)}`;
    summary.coverage = "incomplete";
    summary.coverageReason = message;
    summary.failures++;
    if (summary.failureExamples.length < 20) summary.failureExamples.push(message);
    log(`    ⚠ ${summary.source} ${message}`);
  }
}

function retainFailure(
  summary: LinkSourceSummary,
  candidate: InitiativeProponentBackfillCandidate,
  error: unknown,
  log: Log,
): void {
  summary.failures++;
  const message = `${candidate.id}/${candidate.sourceId}: ${(error as Error)?.message ?? String(error)}`;
  if (summary.failureExamples.length < 20) summary.failureExamples.push(message);
  log(`    ⚠ ${summary.source} preserved prior links after failure ${message}`);
}

async function sourceBatches(
  db: Database,
  source: LinkSourceSummary["source"],
  opts: { batchSize: number; limit?: number },
  visit: (batch: InitiativeProponentBackfillCandidate[]) => Promise<void>,
): Promise<void> {
  let afterId = 0;
  let processed = 0;
  for (;;) {
    const remaining = opts.limit === undefined ? opts.batchSize : opts.limit - processed;
    if (remaining <= 0) return;
    const batch = await listInitiativeProponentBackfillCandidates(db, {
      source,
      afterId,
      limit: Math.min(opts.batchSize, remaining),
    });
    if (batch.length === 0) return;
    await visit(batch);
    processed += batch.length;
    afterId = batch[batch.length - 1]!.id;
    if (batch.length < Math.min(opts.batchSize, remaining)) return;
  }
}

async function linkDiputados(
  db: Database,
  opts: { batchSize: number; limit?: number; log: Log },
): Promise<LinkSourceSummary> {
  const summary = emptySummary("sil-diputados");
  await sourceBatches(db, summary.source, opts, async (batch) => {
    const drafts = batch.map((candidate) => {
      try {
        return buildDiputadosProponentSnapshot(candidate.raw);
      } catch (error) {
        retainFailure(summary, candidate, error, opts.log);
        return null;
      }
    });
    const sourceIds = [
      ...new Set(
        drafts.flatMap((draft) =>
          (draft?.rows ?? [])
            .map((row) => row.personSourceId)
            .filter((sourceId): sourceId is string => Boolean(sourceId)),
        ),
      ),
    ];
    // Reconciliation is historical: an exact official identity remains valid after
    // the person leaves office. Public profile lists stay active-only, but the
    // persisted relationship must not be degraded merely because the roster rolled.
    const profileIds = await resolveLegislatorProfileIds(
      db,
      sourceIds.map((sourceId) => ({
        source: "roster-diputados",
        sourceId,
        chamber: "DIPUTADOS",
      })),
    );
    const profileIdBySourceId = new Map(
      sourceIds.map((sourceId, index) => [sourceId, profileIds[index] ?? null] as const),
    );

    for (const [index, candidate] of batch.entries()) {
      summary.candidates++;
      if (drafts[index] === null) continue;
      try {
        const snapshot = buildDiputadosProponentSnapshot(candidate.raw, profileIdBySourceId);
        if (!snapshot.observed) {
          summary.skippedUnobserved++;
          continue;
        }
        summary.observed++;
        summary.unresolved += snapshot.rows.filter((row) => row.matchBasis === "unresolved").length;
        await replaceInitiativeProponents(db, candidate.id, candidate.source, snapshot.rows);
        summary.replaced++;
      } catch (error) {
        retainFailure(summary, candidate, error, opts.log);
      }
    }
  });
  return summary;
}

async function linkSenate(
  db: Database,
  context: SenadoLinkContext,
  opts: { batchSize: number; limit?: number; log: Log },
): Promise<LinkSourceSummary> {
  const summary = emptySummary("senado-sil");
  await sourceBatches(db, summary.source, opts, async (batch) => {
    for (const candidate of batch) {
      summary.candidates++;
      try {
        const snapshot = buildSenateProponentSnapshot(candidate.raw, context);
        if (!snapshot.observed) {
          summary.skippedUnobserved++;
          continue;
        }
        summary.observed++;
        summary.unresolved += snapshot.rows.filter((row) => row.matchBasis === "unresolved").length;
        await replaceInitiativeProponents(db, candidate.id, candidate.source, snapshot.rows);
        summary.replaced++;
      } catch (error) {
        retainFailure(summary, candidate, error, opts.log);
      }
    }
  });
  return summary;
}

/**
 * Reconcile normalized proponent relations for both chambers. Diputados is completed
 * without depending on Senate network/catalog availability. The complete Senate
 * catalog and active-roster bridge are validated before the first Senate write; a
 * setup/drift failure is isolated to the Senate summary and preserves its prior rows.
 * A candidate whose source collection was not observed is never passed to `replace`.
 */
export async function linkInitiativeProponents(
  db: Database,
  opts: {
    limit?: number;
    batchSize?: number;
    log?: Log;
    /** Test/replay hook; production callers omit it and fetch the official catalog. */
    senateCatalog?: SenadoSilProponentCatalog;
    senateAdapter?: Pick<SenadoSilAdapter, "fetchProponentCatalog">;
    /** Only an unlimited historical CLI/catch-up run may publish durable coverage. */
    recordCoverage?: boolean;
  } = {},
): Promise<LinkInitiativeProponentsSummary> {
  const log = opts.log ?? (() => {});
  const batchSize = Math.min(1_000, Math.max(1, opts.batchSize ?? 250));
  if (opts.limit !== undefined && (!Number.isSafeInteger(opts.limit) || opts.limit < 1)) {
    throw new Error("initiative proponent link limit must be a positive safe integer");
  }
  const publishCoverage = opts.recordCoverage === true && opts.limit === undefined;

  let diputadosCoverage: ReconciliationRunHandle | null = null;
  if (publishCoverage) diputadosCoverage = await beginFullCoverage(db, "sil-diputados");
  log("  linking Cámara de Diputados proponents by exact official legisladorId");
  let diputados: LinkSourceSummary;
  try {
    diputados = await linkDiputados(db, {
      batchSize,
      limit: opts.limit,
      log,
    });
  } catch (error) {
    diputados = sourceSetupFailure("sil-diputados", error, log);
  }
  if (diputadosCoverage) {
    await finishFullCoverage(db, diputadosCoverage, diputados, log);
  }

  let senado: LinkSourceSummary;
  let senateCoverage: ReconciliationRunHandle | null = null;
  try {
    if (publishCoverage) senateCoverage = await beginFullCoverage(db, "senado-sil");
    const adapter = opts.senateAdapter ?? new SenadoSilAdapter();
    const catalog = validateSenadoSilProponentCatalog(
      opts.senateCatalog ?? (await adapter.fetchProponentCatalog()),
    );
    // Drift aborts before `linkSenate` begins, preserving every prior Senate relation.
    const senateContext = await prepareSenateContext(db, catalog);
    log("  linking Senate proponents through the reviewed official selector identity bridge");
    senado = await linkSenate(db, senateContext, {
      batchSize,
      limit: opts.limit,
      log,
    });
  } catch (error) {
    senado = sourceSetupFailure("senado-sil", error, log);
  }
  if (senateCoverage) {
    await finishFullCoverage(db, senateCoverage, senado, log);
  }
  return {
    ok: diputados.failures === 0 && senado.failures === 0,
    diputados,
    senado,
  };
}
