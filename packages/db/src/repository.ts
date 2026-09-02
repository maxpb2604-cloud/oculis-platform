/**
 * Persistence operations for ingestion: idempotent upsert of initiatives and
 * append-only status-event recording with change detection.
 */
import { and, eq, ilike, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { isDepositedBillDocumentType, officialDepositedBillPdfUrl } from "@oculis/core";
import type { Database } from "./client.js";
import {
  activityEvents,
  activityInitiatives,
  commissions,
  commissionMembers,
  documentContents,
  documentPdfVerifications,
  documents,
  feedAccounts,
  feedItemEntities,
  feedItems,
  inferenceAudit,
  ingestionRuns,
  initiativeCommissionAssignments,
  initiativeProponentReconciliationRuns,
  initiativeProponents,
  initiativeTitleTranslations,
  initiatives,
  legislators,
  regulations,
  statusEvents,
} from "./schema.js";
import type {
  FeedAccount,
  NewCommission,
  NewCommissionMember,
  NewDocument,
  NewFeedAccount,
  NewFeedItem,
  NewInitiative,
  NewInitiativeCommissionAssignment,
  NewLegislator,
  NewRegulation,
  DocumentSourceSnapshot,
  InitiativeTitleTranslation,
} from "./schema.js";

export interface UpsertResult {
  id: number;
  inserted: boolean;
  statusChanged: boolean;
}

export interface UpsertInitiativeOptions {
  /**
   * A Senado list row is only an index entry: its title can be blank or abbreviated and
   * it never contains the full Ficha payload. When this flag is set, an already verified
   * raw.payload.ficha remains authoritative for Ficha-only fields and provenance. The
   * current list snapshot is still refreshed inside the retained raw payload.
   */
  preserveVerifiedSenateFicha?: boolean;
  /**
   * Defaults to true. Set false only when the caller separately persists the same
   * change from a verified source-history collection; this prevents a second,
   * undated OBSERVED_CHANGE row from being manufactured from an index/detail value.
   */
  recordObservedStatusChange?: boolean;
}

export type InitiativeProponentMatchBasis =
  | "official-id"
  | "official-selector-exact-name"
  | "unresolved";

const POSTGRES_INTEGER_MAX = 2_147_483_647;

/** One source-published proponent occurrence in an observed initiative snapshot. */
export interface InitiativeProponentInput {
  /** Canonical internal `legislators.id`; null means the source person was unresolved. */
  legislatorId?: number | null;
  /** Source-specific person-id namespace; prevents numeric ids from different SILs colliding. */
  personNamespace: string;
  personSourceId?: string | null;
  publishedName: string;
  principal?: boolean | null;
  /** Zero-based source order within this initiative's published proponent collection. */
  ordinal: number;
  matchBasis: InitiativeProponentMatchBasis;
  /** Private audit evidence; never returned by the public list API. */
  evidence?: unknown;
}

function normalizedInitiativeProponentInput(
  row: InitiativeProponentInput,
): Required<Omit<InitiativeProponentInput, "evidence">> & { evidence: unknown | null } {
  const legislatorId = row.legislatorId ?? null;
  const personNamespace = row.personNamespace.trim();
  const personSourceId = row.personSourceId?.trim() || null;
  const publishedName = row.publishedName.replace(/\s+/g, " ").trim();
  if (!Number.isSafeInteger(row.ordinal) || row.ordinal < 0) {
    throw new Error("initiative proponent ordinal must be a non-negative safe integer");
  }
  if (!personNamespace) throw new Error("initiative proponent personNamespace is required");
  if (!publishedName) throw new Error("initiative proponent publishedName is required");
  if (
    legislatorId != null &&
    (!Number.isSafeInteger(legislatorId) || legislatorId < 1 || legislatorId > POSTGRES_INTEGER_MAX)
  ) {
    throw new Error("initiative proponent legislatorId must be a positive safe integer");
  }
  if (row.matchBasis === "unresolved" && legislatorId != null) {
    throw new Error("an unresolved initiative proponent cannot have a legislatorId");
  }
  if (row.matchBasis !== "unresolved" && legislatorId == null) {
    throw new Error("a resolved initiative proponent requires a legislatorId");
  }
  return {
    legislatorId,
    personNamespace,
    personSourceId,
    publishedName,
    principal: row.principal ?? null,
    ordinal: row.ordinal,
    matchBasis: row.matchBasis,
    evidence: row.evidence ?? null,
  };
}

/**
 * Atomically replace one initiative/source proponent snapshot.
 *
 * Callers deliberately do not invoke this function when the source collection failed;
 * therefore a failed observation preserves the last successful snapshot. Passing an
 * empty array means the source successfully published no proponents and clears it.
 */
export async function replaceInitiativeProponents(
  db: Database,
  initiativeId: number,
  initiativeSource: string,
  rows: readonly InitiativeProponentInput[],
): Promise<void> {
  if (!Number.isSafeInteger(initiativeId) || initiativeId < 1) {
    throw new Error("initiativeId must be a positive safe integer");
  }
  const normalizedSource = initiativeSource.trim();
  if (!normalizedSource) throw new Error("initiativeSource is required");
  const normalizedRows = rows.map(normalizedInitiativeProponentInput);
  if (new Set(normalizedRows.map((row) => row.ordinal)).size !== normalizedRows.length) {
    throw new Error("initiative proponent ordinals must be unique within a source snapshot");
  }

  await db.transaction(async (tx) => {
    const [initiative] = await tx
      .select({ source: initiatives.source })
      .from(initiatives)
      .where(eq(initiatives.id, initiativeId))
      .limit(1);
    if (!initiative) throw new Error(`initiative ${initiativeId} does not exist`);
    if (initiative.source !== normalizedSource) {
      throw new Error(
        `initiative ${initiativeId} belongs to ${initiative.source}, not ${normalizedSource}`,
      );
    }

    const snapshotWhere = and(
      eq(initiativeProponents.initiativeId, initiativeId),
      eq(initiativeProponents.initiativeSource, normalizedSource),
    );
    if (normalizedRows.length === 0) {
      await tx.delete(initiativeProponents).where(snapshotWhere);
      return;
    }

    await tx.delete(initiativeProponents).where(
      and(
        snapshotWhere,
        notInArray(
          initiativeProponents.ordinal,
          normalizedRows.map((row) => row.ordinal),
        ),
      ),
    );
    for (const row of normalizedRows) {
      await tx
        .insert(initiativeProponents)
        .values({
          initiativeId,
          initiativeSource: normalizedSource,
          ...row,
        })
        .onConflictDoUpdate({
          target: [
            initiativeProponents.initiativeId,
            initiativeProponents.initiativeSource,
            initiativeProponents.ordinal,
          ],
          set: {
            legislatorId: row.legislatorId,
            personNamespace: row.personNamespace,
            personSourceId: row.personSourceId,
            publishedName: row.publishedName,
            principal: row.principal,
            matchBasis: row.matchBasis,
            evidence: row.evidence,
            lastSeenAt: sql`now()`,
          },
        });
    }
  });
}

export interface InitiativeProponentBackfillCandidate {
  id: number;
  source: string;
  sourceId: string;
  code: string | null;
  filedAt: string | null;
  raw: unknown;
}

/**
 * Narrow, source-owned checkpoint reader for incremental congressional histories.
 *
 * The worker compares only literal official index fields retained in `raw`; this query
 * deliberately does not reuse a proponent-reconciliation contract or infer a signal
 * from generic `updated_at` timestamps.
 */
export interface InitiativeMovementCheckpoint {
  id: number;
  source: string;
  sourceId: string;
  status: string | null;
  officialStatusChangedAt: string | null;
  raw: unknown;
}

export async function listInitiativeMovementCheckpoints(
  db: Database,
  opts: { source: string; afterId?: number; limit?: number },
): Promise<InitiativeMovementCheckpoint[]> {
  const source = opts.source.trim();
  if (!source) throw new Error("initiative movement checkpoint source is required");
  const requestedLimit = Number.isSafeInteger(opts.limit) ? Math.trunc(opts.limit!) : 1_000;
  const limit = Math.min(1_000, Math.max(1, requestedLimit));
  const afterId = Number.isSafeInteger(opts.afterId) ? Math.max(0, Math.trunc(opts.afterId!)) : 0;
  return db
    .select({
      id: initiatives.id,
      source: initiatives.source,
      sourceId: initiatives.sourceId,
      status: initiatives.status,
      officialStatusChangedAt: initiatives.officialStatusChangedAt,
      raw: initiatives.raw,
    })
    .from(initiatives)
    .where(and(eq(initiatives.source, source), sql`${initiatives.id} > ${afterId}`))
    .orderBy(initiatives.id)
    .limit(limit);
}

/** Stable id-ordered batches for an idempotent relation backfill. */
export async function listInitiativeProponentBackfillCandidates(
  db: Database,
  opts: { source?: string; afterId?: number; limit?: number } = {},
): Promise<InitiativeProponentBackfillCandidate[]> {
  const requestedLimit = Number.isSafeInteger(opts.limit) ? Math.trunc(opts.limit!) : 500;
  const limit = Math.min(1_000, Math.max(1, requestedLimit));
  const afterId = Number.isSafeInteger(opts.afterId) ? Math.max(0, Math.trunc(opts.afterId!)) : 0;
  const conds = [sql`${initiatives.id} > ${afterId}`];
  if (opts.source?.trim()) conds.push(eq(initiatives.source, opts.source.trim()));
  return db
    .select({
      id: initiatives.id,
      source: initiatives.source,
      sourceId: initiatives.sourceId,
      code: initiatives.code,
      filedAt: initiatives.filedAt,
      raw: initiatives.raw,
    })
    .from(initiatives)
    .where(and(...conds))
    .orderBy(initiatives.id)
    .limit(limit);
}

export const INITIATIVE_PROPONENT_RECONCILIATION_COMPATIBILITY_VERSION = 1 as const;
/** Bump when the exact Diputados identity-resolution contract changes. */
export const DIPUTADOS_PROPONENT_RESOLVER_VERSION = "sil-legislador-id-v1" as const;
/** Reviewed MasterLex catalog + person-to-roster bridge version accepted by public stats. */
export const SENATE_PROPONENT_RESOLVER_VERSION =
  "senado-selector-2026-08-31-reviewed-bridge-v1" as const;

export interface InitiativeProponentReconciliationDescriptor {
  initiativeSource: string;
  personNamespace: string;
  rosterSource: string;
  chamber: "DIPUTADOS" | "SENADO";
  /** Source/reviewer implementation version retained for audit and incident review. */
  resolverVersion: string;
}

export interface InitiativeProponentReconciliationHandle {
  runId: number;
  candidateCount: number;
}

export interface InitiativeProponentReconciliationResult {
  candidates: number;
  observed: number;
  replaced: number;
  skippedUnobserved: number;
  unresolved: number;
  failures: number;
}

export interface FinishedInitiativeProponentReconciliationRun {
  status: "complete" | "failed";
  reason: string | null;
}

interface InitiativeSourceFingerprint {
  candidateCount: number;
  maxInitiativeId: number | null;
  fingerprint: string;
}

async function initiativeSourceFingerprint(
  db: Database,
  initiativeSource: string,
): Promise<InitiativeSourceFingerprint> {
  const [row] = await db
    .select({
      candidateCount: sql<number>`count(*)::int`,
      maxInitiativeId: sql<number | null>`max(${initiatives.id})::int`,
      // Only evidence that can change a normalized proponent snapshot belongs in the
      // fingerprint. Generic `updated_at`, titles, status and list metadata are updated
      // by routine ingestion and must not invalidate an otherwise complete identity run.
      // Presence bits distinguish an absent source field from a published JSON null.
      fingerprint: sql<string>`md5(coalesce(string_agg(
        jsonb_build_object(
          'id', ${initiatives.id},
          'sourceId', ${initiatives.sourceId},
          'proponentEvidence', case
            when ${initiatives.source} = 'sil-diputados' then jsonb_build_object(
              'proponentesPresent', coalesce(
                (${initiatives.raw} #> '{payload}') ? 'proponentes', false
              ),
              'proponentes', ${initiatives.raw} #> '{payload,proponentes}',
              'proponentsPresent', coalesce(
                (${initiatives.raw} #> '{payload}') ? 'proponents', false
              ),
              'proponents', ${initiatives.raw} #> '{payload,proponents}'
            )
            when ${initiatives.source} = 'senado-sil' then jsonb_build_object(
              'proponentsPresent', coalesce(
                (${initiatives.raw} #> '{payload,ficha}') ? 'proponents', false
              ),
              'proponents', ${initiatives.raw} #> '{payload,ficha,proponents}'
            )
            else jsonb_build_object('unsupportedSource', ${initiatives.source})
          end
        )::text,
        E'\n' order by ${initiatives.id}
      ), ''))`,
    })
    .from(initiatives)
    .where(eq(initiatives.source, initiativeSource));
  return {
    candidateCount: Number(row?.candidateCount ?? 0),
    maxInitiativeId: row?.maxInitiativeId == null ? null : Number(row.maxInitiativeId),
    fingerprint: row?.fingerprint ?? "d41d8cd98f00b204e9800998ecf8427e",
  };
}

function normalizedReconciliationDescriptor(
  descriptor: InitiativeProponentReconciliationDescriptor,
): InitiativeProponentReconciliationDescriptor {
  const normalized = {
    initiativeSource: descriptor.initiativeSource.trim(),
    personNamespace: descriptor.personNamespace.trim(),
    rosterSource: descriptor.rosterSource.trim(),
    chamber: descriptor.chamber,
    resolverVersion: descriptor.resolverVersion.trim(),
  };
  if (
    !normalized.initiativeSource ||
    !normalized.personNamespace ||
    !normalized.rosterSource ||
    !normalized.resolverVersion
  ) {
    throw new Error("initiative proponent reconciliation identity fields are required");
  }
  if (normalized.chamber !== "DIPUTADOS" && normalized.chamber !== "SENADO") {
    throw new Error("initiative proponent reconciliation chamber is invalid");
  }
  return normalized;
}

/**
 * Begin a full-corpus reconciliation by durably capturing its exact source snapshot.
 * Limited/recent-window jobs must not call this API because they cannot prove a zero.
 */
export async function beginInitiativeProponentReconciliationRun(
  db: Database,
  descriptor: InitiativeProponentReconciliationDescriptor,
): Promise<InitiativeProponentReconciliationHandle> {
  const normalized = normalizedReconciliationDescriptor(descriptor);
  const source = await initiativeSourceFingerprint(db, normalized.initiativeSource);
  const [run] = await db
    .insert(initiativeProponentReconciliationRuns)
    .values({
      ...normalized,
      compatibilityVersion: INITIATIVE_PROPONENT_RECONCILIATION_COMPATIBILITY_VERSION,
      status: "running",
      sourceCandidateCount: source.candidateCount,
      sourceMaxInitiativeId: source.maxInitiativeId,
      sourceFingerprint: source.fingerprint,
    })
    .returning({ id: initiativeProponentReconciliationRuns.id });
  if (!run) throw new Error("failed to begin initiative proponent reconciliation run");
  return { runId: run.id, candidateCount: source.candidateCount };
}

function reconciliationCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > POSTGRES_INTEGER_MAX) {
    throw new Error(`${field} must be a non-negative PostgreSQL integer`);
  }
  return value;
}

/**
 * Finish a previously captured full-corpus run. Any processing failure, incomplete
 * traversal or concurrent corpus mutation is recorded as `failed`, never as coverage.
 */
export async function finishInitiativeProponentReconciliationRun(
  db: Database,
  runId: number,
  result: InitiativeProponentReconciliationResult,
): Promise<FinishedInitiativeProponentReconciliationRun> {
  if (!Number.isSafeInteger(runId) || runId < 1 || runId > POSTGRES_INTEGER_MAX) {
    throw new Error("initiative proponent reconciliation run id is invalid");
  }
  const counts = {
    candidates: reconciliationCount(result.candidates, "candidates"),
    observed: reconciliationCount(result.observed, "observed"),
    replaced: reconciliationCount(result.replaced, "replaced"),
    skippedUnobserved: reconciliationCount(result.skippedUnobserved, "skippedUnobserved"),
    unresolved: reconciliationCount(result.unresolved, "unresolved"),
    failures: reconciliationCount(result.failures, "failures"),
  };

  return db.transaction(async (tx) => {
    const [run] = await tx
      .select()
      .from(initiativeProponentReconciliationRuns)
      .where(eq(initiativeProponentReconciliationRuns.id, runId))
      .limit(1);
    if (!run) throw new Error(`initiative proponent reconciliation run ${runId} does not exist`);
    if (run.status !== "running") {
      throw new Error(`initiative proponent reconciliation run ${runId} is already ${run.status}`);
    }
    const current = await initiativeSourceFingerprint(
      tx as unknown as Database,
      run.initiativeSource,
    );
    const reasons: string[] = [];
    if (counts.failures !== 0) reasons.push(`${counts.failures} candidate failures`);
    if (counts.candidates !== run.sourceCandidateCount) {
      reasons.push(
        `processed ${counts.candidates}/${run.sourceCandidateCount} captured candidates`,
      );
    }
    if (counts.observed !== counts.replaced) {
      reasons.push(`replaced ${counts.replaced}/${counts.observed} observed candidates`);
    }
    if (counts.replaced + counts.skippedUnobserved !== counts.candidates) {
      reasons.push("observed and unobserved candidate totals do not cover the traversal");
    }
    if (counts.skippedUnobserved !== 0) {
      reasons.push(`${counts.skippedUnobserved} candidates lacked an observed proponent snapshot`);
    }
    if (counts.unresolved !== 0) {
      reasons.push(`${counts.unresolved} published proponents remain unresolved`);
    }
    if (
      current.candidateCount !== run.sourceCandidateCount ||
      current.maxInitiativeId !== run.sourceMaxInitiativeId ||
      current.fingerprint !== run.sourceFingerprint
    ) {
      reasons.push("source corpus changed during reconciliation");
    }
    const status = reasons.length === 0 ? "complete" : "failed";
    const reason = reasons.length === 0 ? null : reasons.join("; ");
    await tx
      .update(initiativeProponentReconciliationRuns)
      .set({
        status,
        processedCandidateCount: counts.candidates,
        observedCandidateCount: counts.observed,
        replacedCandidateCount: counts.replaced,
        skippedUnobservedCount: counts.skippedUnobserved,
        unresolvedProponentCount: counts.unresolved,
        failureCount: counts.failures,
        failureReason: reason,
        completedAt: sql`now()`,
      })
      .where(eq(initiativeProponentReconciliationRuns.id, runId));
    return { status, reason };
  });
}

export interface InitiativeProponentProfileSummary {
  profileId: number;
  fullName: string;
  chamber: string;
  role: string | null;
  party: string | null;
  province: string | null;
}

export interface InitiativeProponentListItem {
  publishedName: string;
  principal: boolean | null;
  ordinal: number;
  /** Canonical internal profile id; null for a source-published unresolved person. */
  legislatorId: number | null;
  profile: InitiativeProponentProfileSummary | null;
}

/** Public-safe proponent rows: audit evidence and raw source payloads stay private. */
export async function listInitiativeProponents(
  db: Database,
  initiativeId: number,
): Promise<InitiativeProponentListItem[]> {
  if (!Number.isSafeInteger(initiativeId) || initiativeId < 1) return [];
  const rows = await db
    .select({
      publishedName: initiativeProponents.publishedName,
      principal: initiativeProponents.principal,
      ordinal: initiativeProponents.ordinal,
      legislatorId: initiativeProponents.legislatorId,
      profileId: legislators.id,
      profileFullName: legislators.fullName,
      profileChamber: legislators.chamber,
      profileRole: legislators.role,
      profileParty: sql<string | null>`coalesce(${legislators.partyShort}, ${legislators.party})`,
      profileProvince: legislators.province,
    })
    .from(initiativeProponents)
    .leftJoin(legislators, eq(legislators.id, initiativeProponents.legislatorId))
    .where(eq(initiativeProponents.initiativeId, initiativeId))
    .orderBy(initiativeProponents.ordinal, initiativeProponents.id);
  return rows.map((row) => ({
    publishedName: row.publishedName,
    principal: row.principal,
    ordinal: row.ordinal,
    legislatorId: row.legislatorId,
    profile:
      row.profileId == null || row.profileFullName == null || row.profileChamber == null
        ? null
        : {
            profileId: row.profileId,
            fullName: row.profileFullName,
            chamber: row.profileChamber,
            role: row.profileRole,
            party: row.profileParty,
            province: row.profileProvince,
          },
  }));
}

/**
 * Insert or update an initiative keyed by (source, source_id). Returns whether it was
 * newly inserted and whether its current status changed since last seen.
 */
export async function upsertInitiative(
  db: Database,
  data: NewInitiative,
  opts: UpsertInitiativeOptions = {},
): Promise<UpsertResult> {
  const existing = await db
    .select({ id: initiatives.id, status: initiatives.status, raw: initiatives.raw })
    .from(initiatives)
    .where(and(eq(initiatives.source, data.source), eq(initiatives.sourceId, data.sourceId)))
    .limit(1);
  const prev = existing[0];
  // `undefined` means this collection path did not observe the field (for example, a
  // detail endpoint failed while the list endpoint still succeeded). In that case the
  // existing fact must survive. `null` remains an explicit empty value from the source.
  const incompleteListStatus =
    opts.preserveVerifiedSenateFicha === true &&
    hasVerifiedSenateFicha(prev?.raw) &&
    (data.status == null || !data.status.trim());
  const statusChanged =
    prev && data.status !== undefined && !incompleteListStatus
      ? (data.status ?? null) !== (prev.status ?? null)
      : false;
  const rejected = {
    category: data.category ?? null,
    categoryConfidence: data.categoryConfidence ?? null,
    riskLevel: data.riskLevel ?? null,
    approvalProbability: data.approvalProbability ?? null,
    approvalScore: data.approvalScore ?? null,
    needsReview: data.needsReview ?? null,
    published: data.published ?? null,
  };
  const hasRejected = Object.values(rejected).some((value) => value != null && value !== false);
  const safeData: NewInitiative = {
    ...data,
    category: null,
    categoryConfidence: null,
    riskLevel: null,
    approvalProbability: null,
    approvalScore: null,
    needsReview: false,
    published: false,
  };
  const protectSenateFicha = opts.preserveVerifiedSenateFicha === true;
  const hasStoredSenateFicha = sql`jsonb_typeof(${initiatives.raw} #> '{payload,ficha}') = 'object'`;
  const protectedTitle = protectSenateFicha
    ? sql<string>`case when ${hasStoredSenateFicha} then ${initiatives.title} else ${data.title} end`
    : data.title;
  const protectedType =
    protectSenateFicha && data.type !== undefined
      ? sql<
          string | null
        >`case when ${hasStoredSenateFicha} then ${initiatives.type} else ${data.type} end`
      : data.type;
  const protectedStatus =
    protectSenateFicha && (data.status == null || !data.status.trim())
      ? sql<
          string | null
        >`case when ${hasStoredSenateFicha} then ${initiatives.status} else ${data.status} end`
      : data.status;
  const incomingRawJson = data.raw === undefined ? null : JSON.stringify(data.raw);
  const protectedRaw =
    protectSenateFicha && incomingRawJson !== null
      ? sql<object | null>`case
          when ${hasStoredSenateFicha} then
            case
              when ${incomingRawJson}::jsonb #> '{payload,list}' is not null
                then jsonb_set(
                  jsonb_set(
                    ${initiatives.raw},
                    '{payload,list}',
                    ${incomingRawJson}::jsonb #> '{payload,list}',
                    true
                  ),
                  '{provenance}',
                  coalesce(${incomingRawJson}::jsonb -> 'provenance', '{}'::jsonb) ||
                    jsonb_build_object(
                      'retainedCollections', jsonb_build_array('ficha'),
                      'retainedFichaProvenance', coalesce(
                        ${initiatives.raw} #> '{provenance,retainedFichaProvenance}',
                        ${initiatives.raw} -> 'provenance',
                        'null'::jsonb
                      )
                    ),
                  true
                )
              else ${initiatives.raw}
            end
          else ${incomingRawJson}::jsonb
        end`
      : data.raw;

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(initiatives)
      .values(safeData)
      .onConflictDoUpdate({
        target: [initiatives.source, initiatives.sourceId],
        set: {
          ...(data.code !== undefined ? { code: data.code } : {}),
          kind: data.kind,
          title: protectedTitle,
          ...(data.purpose !== undefined ? { purpose: data.purpose } : {}),
          ...(data.status !== undefined ? { status: protectedStatus } : {}),
          ...(data.type !== undefined ? { type: protectedType } : {}),
          ...(data.chamber !== undefined ? { chamber: data.chamber } : {}),
          ...(data.sourceChamber !== undefined ? { sourceChamber: data.sourceChamber } : {}),
          ...(data.originChamber !== undefined ? { originChamber: data.originChamber } : {}),
          ...(data.currentChamber !== undefined ? { currentChamber: data.currentChamber } : {}),
          ...(data.currentBody !== undefined ? { currentBody: data.currentBody } : {}),
          ...(data.condition !== undefined ? { condition: data.condition } : {}),
          ...(data.sourceCategory !== undefined ? { sourceCategory: data.sourceCategory } : {}),
          ...(data.subjectMatter !== undefined ? { subjectMatter: data.subjectMatter } : {}),
          ...(data.sponsor !== undefined ? { sponsor: data.sponsor } : {}),
          ...(data.sponsorRole !== undefined ? { sponsorRole: data.sponsorRole } : {}),
          ...(data.sponsorCount !== undefined ? { sponsorCount: data.sponsorCount } : {}),
          ...(data.party !== undefined ? { party: data.party } : {}),
          ...(data.province !== undefined ? { province: data.province } : {}),
          ...(data.committee !== undefined ? { committee: data.committee } : {}),
          ...(data.filedAt !== undefined ? { filedAt: data.filedAt } : {}),
          ...(data.expiresAt !== undefined ? { expiresAt: data.expiresAt } : {}),
          ...(data.initiated !== undefined ? { initiated: data.initiated } : {}),
          ...(data.initiatedAt !== undefined ? { initiatedAt: data.initiatedAt } : {}),
          ...(data.legislature !== undefined ? { legislature: data.legislature } : {}),
          ...(data.registrationPeriod !== undefined
            ? { registrationPeriod: data.registrationPeriod }
            : {}),
          ...(data.officialStatusChangedAt !== undefined
            ? { officialStatusChangedAt: data.officialStatusChangedAt }
            : {}),
          ...(data.promulgationNumber !== undefined
            ? { promulgationNumber: data.promulgationNumber }
            : {}),
          ...(data.promulgatedAt !== undefined ? { promulgatedAt: data.promulgatedAt } : {}),
          ...(data.sourceUrl !== undefined ? { sourceUrl: data.sourceUrl } : {}),
          ...(data.raw !== undefined ? { raw: protectedRaw } : {}),
          category: null,
          categoryConfidence: null,
          riskLevel: null,
          approvalProbability: null,
          approvalScore: null,
          needsReview: false,
          published: false,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: initiatives.id });
    const id = row!.id;
    if (hasRejected) {
      await tx
        .insert(inferenceAudit)
        .values({
          entityType: "initiative",
          entityId: id,
          inferenceKind: "blocked_inference",
          value: rejected,
          provenance: {
            source: data.source,
            sourceCategory: data.sourceCategory ?? null,
            sourceUrl: data.sourceUrl ?? null,
          },
        })
        .onConflictDoUpdate({
          target: [
            inferenceAudit.entityType,
            inferenceAudit.entityId,
            inferenceAudit.inferenceKind,
          ],
          set: {
            value: rejected,
            provenance: {
              source: data.source,
              sourceCategory: data.sourceCategory ?? null,
              sourceUrl: data.sourceUrl ?? null,
            },
            archivedAt: sql`now()`,
          },
        });
    }
    if (
      opts.recordObservedStatusChange !== false &&
      statusChanged &&
      typeof data.status === "string" &&
      data.status.trim()
    ) {
      await tx
        .insert(statusEvents)
        .values({
          initiativeId: id,
          status: data.status,
          eventDate: null,
          eventEndDate: null,
          sourceEventId: null,
          note: null,
          source: data.source,
          sourceUrl: data.sourceUrl ?? null,
          evidenceType: "OBSERVED_CHANGE",
          raw: (data.raw ?? null) as object | null,
        })
        .onConflictDoNothing();
    }
    return { id, inserted: !prev, statusChanged };
  });
}

function hasVerifiedSenateFicha(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const payload = (raw as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const ficha = (payload as { ficha?: unknown }).ficha;
  return Boolean(ficha && typeof ficha === "object" && !Array.isArray(ficha));
}

/**
 * Record source history or an observed change, preserving its evidence type and
 * provenance. A missing source event date stays null; observedAt records only when
 * Oculis saw the value. Returns the number of newly inserted observations.
 */
export async function recordStatusEvents(
  db: Database,
  initiativeId: number,
  events: StatusEventInput[],
): Promise<number> {
  if (events.length === 0) return 0;
  const [parent] = await db
    .select({ source: initiatives.source, sourceUrl: initiatives.sourceUrl })
    .from(initiatives)
    .where(eq(initiatives.id, initiativeId))
    .limit(1);
  if (!parent) throw new Error(`Initiative ${initiativeId} does not exist`);
  const rows = events.map((e) => {
    const source = e.source ?? parent.source;
    const evidenceType = e.evidenceType ?? "SOURCE_HISTORY";
    const silHistory = evidenceType === "SOURCE_HISTORY" && source === "sil-diputados";
    return {
      initiativeId,
      sourceEventId:
        cleanOptionalText(e.sourceEventId) ?? (silHistory ? explicitRawText(e.raw, "id") : null),
      status: e.status,
      eventDate: e.date,
      eventEndDate: e.endDate ?? (silHistory ? explicitRawIsoDate(e.raw, "fin") : null),
      note: e.note,
      source,
      sourceUrl: e.sourceUrl ?? parent.sourceUrl,
      evidenceType,
      raw: (e.raw ?? null) as object | null,
      observedAt: e.observedAt,
      lastSeenAt: e.observedAt,
    };
  });
  const inserted = await db
    .insert(statusEvents)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: statusEvents.id });
  return inserted.length;
}

export interface StatusEventInput {
  sourceEventId?: string | null;
  status: string;
  date: string | null;
  endDate?: string | null;
  note: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  evidenceType?: "SOURCE_HISTORY" | "OBSERVED_CHANGE" | "LEGACY_UNATTRIBUTED";
  raw?: unknown;
  observedAt?: Date;
}

export interface StatusHistorySnapshotReconciliation {
  inserted: number;
  reactivated: number;
  retired: number;
  unchanged: number;
  active: number;
  observedAt: Date;
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function postgresJsonValue(value: unknown): object | null {
  if (value === null || value === undefined) return null;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) return null;
  return JSON.parse(encoded) as object;
}

function statusHistoryVersionKey(row: {
  sourceEventId: string | null;
  status: string;
  eventDate: string | null;
  eventEndDate: string | null;
  note: string | null;
  sourceUrl: string | null;
  raw: unknown;
}): string {
  return canonicalJson([
    row.sourceEventId,
    row.status,
    row.eventDate,
    row.eventEndDate,
    row.note,
    row.sourceUrl,
    row.raw ?? null,
  ]);
}

/**
 * Reconcile one complete, identity-verified official history snapshot.
 *
 * This is intentionally stricter than `recordStatusEvents`: callers must explicitly
 * attest that the collection is complete. Exact versions are reactivated, corrected
 * versions are appended, and only active SOURCE_HISTORY rows for this same
 * initiative/source are soft-retired. Observed changes and independent sources are
 * never touched.
 */
export async function reconcileStatusHistorySnapshot(
  db: Database,
  initiativeId: number,
  source: string,
  events: StatusEventInput[],
  opts: { complete: true; observedAt?: Date },
): Promise<StatusHistorySnapshotReconciliation> {
  const normalizedSource = source.trim();
  if (!normalizedSource) throw new Error("Status-history snapshot source is required");
  if (opts.complete !== true) {
    throw new Error("A partial status-history observation cannot retire source history");
  }
  const observedAt = opts.observedAt ?? new Date();
  if (!Number.isFinite(observedAt.getTime())) {
    throw new Error("Status-history snapshot observedAt must be a valid date");
  }

  return db.transaction(async (tx) => {
    // Serialize snapshots for this initiative so two workers cannot alternately retire
    // each other's versions. The parent row also proves the requested identity exists.
    const locked = await tx.execute(
      sql`select id, source, source_url from ${initiatives} where id = ${initiativeId} for update`,
    );
    const parent = (
      locked as unknown as {
        rows: Array<{ id: number; source: string; source_url: string | null }>;
      }
    ).rows[0];
    if (!parent) throw new Error(`Initiative ${initiativeId} does not exist`);

    const uniqueRows = new Map<
      string,
      {
        initiativeId: number;
        sourceEventId: string | null;
        status: string;
        eventDate: string | null;
        eventEndDate: string | null;
        note: string | null;
        source: string;
        sourceUrl: string | null;
        evidenceType: "SOURCE_HISTORY";
        raw: object | null;
        observedAt: Date;
        lastSeenAt: Date;
        retiredAt: null;
      }
    >();
    const versionByOfficialId = new Map<string, string>();
    for (const event of events) {
      if (event.evidenceType && event.evidenceType !== "SOURCE_HISTORY") {
        throw new Error("A status-history snapshot may contain only SOURCE_HISTORY evidence");
      }
      const eventSource = cleanOptionalText(event.source);
      if (eventSource && eventSource !== normalizedSource) {
        throw new Error(
          `Status-history source mismatch: expected ${normalizedSource}, received ${eventSource}`,
        );
      }
      if (!event.status.trim()) throw new Error("Status-history snapshot contains a blank status");
      const silHistory = normalizedSource === "sil-diputados";
      const row = {
        initiativeId,
        sourceEventId:
          cleanOptionalText(event.sourceEventId) ??
          (silHistory ? explicitRawText(event.raw, "id") : null),
        status: event.status,
        eventDate: event.date,
        eventEndDate: event.endDate ?? (silHistory ? explicitRawIsoDate(event.raw, "fin") : null),
        note: event.note,
        source: normalizedSource,
        sourceUrl: event.sourceUrl ?? parent.source_url,
        evidenceType: "SOURCE_HISTORY" as const,
        // Match PostgreSQL jsonb serialization before calculating the immutable
        // version key (notably, nested `undefined` object fields are omitted).
        raw: postgresJsonValue(event.raw),
        observedAt,
        lastSeenAt: observedAt,
        retiredAt: null,
      };
      const versionKey = statusHistoryVersionKey(row);
      if (row.sourceEventId) {
        const priorVersion = versionByOfficialId.get(row.sourceEventId);
        if (priorVersion && priorVersion !== versionKey) {
          throw new Error(
            `Status-history snapshot contains conflicting versions of source event ${row.sourceEventId}`,
          );
        }
        versionByOfficialId.set(row.sourceEventId, versionKey);
      }
      uniqueRows.set(versionKey, row);
    }

    const inserted =
      uniqueRows.size === 0
        ? []
        : await tx
            .insert(statusEvents)
            .values([...uniqueRows.values()])
            .onConflictDoNothing()
            .returning({ id: statusEvents.id });

    const stored = await tx
      .select({
        id: statusEvents.id,
        sourceEventId: statusEvents.sourceEventId,
        status: statusEvents.status,
        eventDate: statusEvents.eventDate,
        eventEndDate: statusEvents.eventEndDate,
        note: statusEvents.note,
        sourceUrl: statusEvents.sourceUrl,
        raw: statusEvents.raw,
        retiredAt: statusEvents.retiredAt,
      })
      .from(statusEvents)
      .where(
        and(
          eq(statusEvents.initiativeId, initiativeId),
          eq(statusEvents.evidenceType, "SOURCE_HISTORY"),
          eq(statusEvents.source, normalizedSource),
        ),
      );
    const snapshotKeys = new Set(uniqueRows.keys());
    const seenIds: number[] = [];
    const retireIds: number[] = [];
    let reactivated = 0;
    let unchanged = 0;
    for (const row of stored) {
      if (snapshotKeys.has(statusHistoryVersionKey(row))) {
        seenIds.push(row.id);
        if (row.retiredAt) reactivated++;
        else if (!inserted.some((candidate) => candidate.id === row.id)) unchanged++;
      } else if (!row.retiredAt) {
        retireIds.push(row.id);
      }
    }
    if (seenIds.length > 0) {
      await tx
        .update(statusEvents)
        .set({ lastSeenAt: observedAt, retiredAt: null })
        .where(inArray(statusEvents.id, seenIds));
    }
    if (retireIds.length > 0) {
      await tx
        .update(statusEvents)
        .set({ retiredAt: observedAt })
        .where(inArray(statusEvents.id, retireIds));
    }
    return {
      inserted: inserted.length,
      reactivated,
      retired: retireIds.length,
      unchanged,
      active: uniqueRows.size,
      observedAt,
    };
  });
}

export interface InitiativeCommissionAssignmentInput {
  sourceAssignmentId: string | null;
  sourceTypeId: string | null;
  name: string | null;
  type: string | null;
  startDate: string | null;
  endDate: string | null;
  raw: unknown;
}

/** Append-safe upsert of every commission-assignment row explicitly published by a source. */
export async function upsertInitiativeCommissionAssignments(
  db: Database,
  initiativeId: number,
  source: string,
  assignments: InitiativeCommissionAssignmentInput[],
): Promise<number> {
  if (assignments.length === 0) return 0;
  if (!source.trim()) throw new Error("Commission assignment source is required");
  return db.transaction(async (tx) => {
    let insertedCount = 0;
    for (const assignment of assignments) {
      const sourceAssignmentId = cleanOptionalText(assignment.sourceAssignmentId);
      const raw = (assignment.raw ?? null) as object | null;
      const value: NewInitiativeCommissionAssignment = {
        initiativeId,
        source,
        sourceAssignmentId,
        sourceTypeId: cleanOptionalText(assignment.sourceTypeId),
        name: cleanOptionalText(assignment.name),
        type: cleanOptionalText(assignment.type),
        startDate: assignment.startDate,
        endDate: assignment.endDate,
        raw,
      };
      const inserted = await tx
        .insert(initiativeCommissionAssignments)
        .values(value)
        .onConflictDoNothing()
        .returning({ id: initiativeCommissionAssignments.id });
      if (inserted[0]) {
        insertedCount++;
        continue;
      }

      if (sourceAssignmentId) {
        await tx
          .update(initiativeCommissionAssignments)
          .set({
            sourceTypeId: value.sourceTypeId,
            name: value.name,
            type: value.type,
            startDate: value.startDate,
            endDate: value.endDate,
            raw,
            lastSeenAt: sql`now()`,
          })
          .where(
            and(
              eq(initiativeCommissionAssignments.initiativeId, initiativeId),
              eq(initiativeCommissionAssignments.source, source),
              eq(initiativeCommissionAssignments.sourceAssignmentId, sourceAssignmentId),
            ),
          );
        continue;
      }

      const rawJson = raw == null ? null : JSON.stringify(raw);
      await tx
        .update(initiativeCommissionAssignments)
        .set({ lastSeenAt: sql`now()` })
        .where(
          and(
            eq(initiativeCommissionAssignments.initiativeId, initiativeId),
            eq(initiativeCommissionAssignments.source, source),
            isNull(initiativeCommissionAssignments.sourceAssignmentId),
            sql`${initiativeCommissionAssignments.sourceTypeId} is not distinct from ${value.sourceTypeId}`,
            sql`${initiativeCommissionAssignments.name} is not distinct from ${value.name}`,
            sql`${initiativeCommissionAssignments.type} is not distinct from ${value.type}`,
            sql`${initiativeCommissionAssignments.startDate} is not distinct from ${value.startDate}`,
            sql`${initiativeCommissionAssignments.endDate} is not distinct from ${value.endDate}`,
            sql`md5(coalesce(${initiativeCommissionAssignments.raw}::text, '')) = md5(coalesce(${rawJson}::jsonb::text, ''))`,
          ),
        );
    }
    return insertedCount;
  });
}

function cleanOptionalText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

function explicitRawText(raw: unknown, key: string): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" || typeof value === "number"
    ? cleanOptionalText(String(value))
    : null;
}

function explicitRawIsoDate(raw: unknown, key: string): string | null {
  const value = explicitRawText(raw, key);
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?=$|[T\s])/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${match[1]}-${match[2]}-${match[3]}`
    : null;
}

export async function countInitiatives(db: Database): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(initiatives);
  return row?.n ?? 0;
}

// ---------------------------------------------------------------------------
// Exact-source initiative title translations
// ---------------------------------------------------------------------------

const CURRENT_INITIATIVE_TRANSLATION_LOCALE = "en";
/** Only editorially reviewed title translations may reach customer-facing queries. */
export const REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX = "oculis-editorial-reviewed-en/";

function assertSupportedInitiativeTranslationLocale(targetLocale: string): void {
  if (targetLocale !== CURRENT_INITIATIVE_TRANSLATION_LOCALE) {
    throw new Error(`targetLocale must be ${CURRENT_INITIATIVE_TRANSLATION_LOCALE}`);
  }
}

function initiativeSourceTitleHash(sourceTitle: string): string {
  return createHash("sha256").update(sourceTitle, "utf8").digest("hex");
}

function currentEnglishInitiativeTitleSql() {
  return sql<string | null>`(
    select title_translation.translated_title
    from initiative_title_translations title_translation
    where title_translation.initiative_id = "initiatives"."id"
      and title_translation.target_locale = 'en'
      and title_translation.source_title = "initiatives"."title"
      and title_translation.withdrawn_at is null
      and title_translation.model like ${`${REVIEWED_INITIATIVE_TITLE_MODEL_PREFIX}%`}
    order by title_translation.created_at desc, title_translation.id desc
    limit 1
  )`;
}

export interface InitiativeTitleTranslationCandidate {
  initiativeId: number;
  targetLocale: string;
  sourceTitle: string;
  sourceTitleHash: string;
  model: string;
}

export interface ListInitiativeTitleTranslationCandidatesOptions {
  model: string;
  targetLocale?: string;
  /** Restrict a manual/retry run to these exact initiatives. */
  initiativeIds?: readonly number[];
  /** Descending keyset cursor: only initiative ids strictly below this value. */
  beforeId?: number;
  limit?: number;
}

/**
 * Official titles that do not yet have output for this exact title/locale/model.
 * Old translations deliberately remain in the table but no longer suppress a
 * candidate after the source changes `initiatives.title`.
 */
export async function listInitiativeTitleTranslationCandidates(
  db: Database,
  opts: ListInitiativeTitleTranslationCandidatesOptions,
): Promise<InitiativeTitleTranslationCandidate[]> {
  const model = opts.model.trim();
  if (!model) throw new Error("model is required");
  const targetLocale = opts.targetLocale ?? CURRENT_INITIATIVE_TRANSLATION_LOCALE;
  assertSupportedInitiativeTranslationLocale(targetLocale);

  if (opts.limit !== undefined && !Number.isFinite(opts.limit)) {
    throw new Error("limit must be a finite number");
  }
  const limit = Math.max(1, Math.min(Math.trunc(opts.limit ?? 25), 100));
  const conditions = [
    sql`length(trim(${initiatives.title})) > 0`,
    // Senate list rows can carry visibly truncated titles before the exact Ficha
    // payload is available. Keep the official text unchanged, but do not translate it.
    sql`right(trim(${initiatives.title}), 3) <> '...'`,
    sql`right(trim(${initiatives.title}), 1) <> '…'`,
    sql`not exists (
      select 1
      from ${initiativeTitleTranslations}
      where ${initiativeTitleTranslations.initiativeId} = ${initiatives.id}
        and ${initiativeTitleTranslations.targetLocale} = ${targetLocale}
        and ${initiativeTitleTranslations.model} = ${model}
        and ${initiativeTitleTranslations.sourceTitle} = ${initiatives.title}
        and ${initiativeTitleTranslations.withdrawnAt} is null
    )`,
  ];

  if (opts.beforeId !== undefined) {
    if (!Number.isSafeInteger(opts.beforeId) || opts.beforeId <= 0) {
      throw new Error("beforeId must be a positive integer");
    }
    conditions.push(sql`${initiatives.id} < ${opts.beforeId}`);
  }

  if (opts.initiativeIds !== undefined) {
    const initiativeIds = [...new Set(opts.initiativeIds)];
    if (
      initiativeIds.some((initiativeId) => !Number.isSafeInteger(initiativeId) || initiativeId <= 0)
    ) {
      throw new Error("initiativeIds must contain only positive integers");
    }
    if (initiativeIds.length === 0) return [];
    conditions.push(inArray(initiatives.id, initiativeIds));
  }

  const rows = await db
    .select({ initiativeId: initiatives.id, sourceTitle: initiatives.title })
    .from(initiatives)
    .where(and(...conditions))
    .orderBy(sql`${initiatives.id} desc`)
    .limit(limit);

  return rows.map((row) => ({
    initiativeId: row.initiativeId,
    targetLocale,
    sourceTitle: row.sourceTitle,
    sourceTitleHash: initiativeSourceTitleHash(row.sourceTitle),
    model,
  }));
}

export interface StoreInitiativeTitleTranslationInput {
  initiativeId: number;
  targetLocale?: string;
  sourceTitle: string;
  sourceTitleHash: string;
  translatedTitle: string;
  model: string;
}

export interface StoreInitiativeTitleTranslationResult {
  row: InitiativeTitleTranslation;
  inserted: boolean;
}

/**
 * Store a translation only while its exact official source title is still current.
 * Returning `null` is a safe stale/missing-initiative refusal. The initiative row lock
 * serializes this check with ingestion updates; identical retries return the first row.
 */
export async function storeInitiativeTitleTranslation(
  db: Database,
  input: StoreInitiativeTitleTranslationInput,
): Promise<StoreInitiativeTitleTranslationResult | null> {
  if (!Number.isSafeInteger(input.initiativeId) || input.initiativeId <= 0) {
    throw new Error("initiativeId must be a positive integer");
  }
  if (!input.sourceTitle.trim()) throw new Error("sourceTitle is required");
  if (!/^[a-f0-9]{64}$/.test(input.sourceTitleHash)) {
    throw new Error("sourceTitleHash must be a lowercase SHA-256 digest");
  }
  if (initiativeSourceTitleHash(input.sourceTitle) !== input.sourceTitleHash) {
    throw new Error("sourceTitleHash does not match sourceTitle");
  }
  const translatedTitle = input.translatedTitle.trim();
  const model = input.model.trim();
  if (!translatedTitle || !model) throw new Error("translatedTitle and model are required");
  const targetLocale = input.targetLocale ?? CURRENT_INITIATIVE_TRANSLATION_LOCALE;
  assertSupportedInitiativeTranslationLocale(targetLocale);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ title: initiatives.title })
      .from(initiatives)
      .where(eq(initiatives.id, input.initiativeId))
      .limit(1)
      .for("update");
    if (!current || current.title !== input.sourceTitle) return null;

    const value = {
      initiativeId: input.initiativeId,
      targetLocale,
      sourceTitle: input.sourceTitle,
      sourceTitleHash: input.sourceTitleHash,
      translatedTitle,
      model,
    };
    const [inserted] = await tx
      .insert(initiativeTitleTranslations)
      .values(value)
      .onConflictDoNothing()
      .returning();
    if (inserted) return { row: inserted, inserted: true };

    const [existing] = await tx
      .select()
      .from(initiativeTitleTranslations)
      .where(
        and(
          eq(initiativeTitleTranslations.initiativeId, input.initiativeId),
          eq(initiativeTitleTranslations.targetLocale, targetLocale),
          eq(initiativeTitleTranslations.sourceTitle, input.sourceTitle),
          eq(initiativeTitleTranslations.sourceTitleHash, input.sourceTitleHash),
          eq(initiativeTitleTranslations.model, model),
        ),
      )
      .limit(1)
      .for("update");
    if (!existing) throw new Error("initiative title translation key conflict");
    if (existing.withdrawnAt !== null) {
      const [reactivated] = await tx
        .update(initiativeTitleTranslations)
        .set({ translatedTitle, createdAt: sql`now()`, withdrawnAt: null })
        .where(
          and(
            eq(initiativeTitleTranslations.id, existing.id),
            isNotNull(initiativeTitleTranslations.withdrawnAt),
          ),
        )
        .returning();
      if (!reactivated) throw new Error("withdrawn initiative title translation changed");
      return { row: reactivated, inserted: false };
    }
    return { row: existing, inserted: false };
  });
}

export interface WithdrawInitiativeTitleTranslationsByModelOptions {
  /** Exact stored model/provenance string; never interpreted as a pattern. */
  model: string;
  /** One transaction withdraws at most 1,000 rows. Call again until it returns zero. */
  limit?: number;
}

/**
 * Withdraw one bounded batch produced by an exact model/provenance string.
 * Row locks plus the final `withdrawn_at is null` predicate make concurrent retries
 * safe: each active translation is counted at most once.
 */
export async function withdrawInitiativeTitleTranslationsByModel(
  db: Database,
  opts: WithdrawInitiativeTitleTranslationsByModelOptions,
): Promise<number> {
  const model = opts.model.trim();
  if (!model) throw new Error("model is required");
  if (opts.limit !== undefined && !Number.isFinite(opts.limit)) {
    throw new Error("limit must be a finite number");
  }
  const limit = Math.max(1, Math.min(Math.trunc(opts.limit ?? 250), 1_000));

  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: initiativeTitleTranslations.id })
      .from(initiativeTitleTranslations)
      .where(
        and(
          eq(initiativeTitleTranslations.model, model),
          isNull(initiativeTitleTranslations.withdrawnAt),
        ),
      )
      .orderBy(sql`${initiativeTitleTranslations.id} asc`)
      .limit(limit)
      .for("update");
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return 0;

    const withdrawn = await tx
      .update(initiativeTitleTranslations)
      .set({ withdrawnAt: sql`now()` })
      .where(
        and(
          inArray(initiativeTitleTranslations.id, ids),
          eq(initiativeTitleTranslations.model, model),
          isNull(initiativeTitleTranslations.withdrawnAt),
        ),
      )
      .returning({ id: initiativeTitleTranslations.id });
    return withdrawn.length;
  });
}

// ---------------------------------------------------------------------------
// Dashboard aggregations
// ---------------------------------------------------------------------------

export interface Bucket {
  key: string;
  count: number;
}

/** Generic grouped count over a single column, newest values first by count. */
async function countBy(db: Database, column: ReturnType<typeof sql>): Promise<Bucket[]> {
  const rows = await db
    .select({
      key: sql<string>`coalesce(${column}::text, 'N/D')`,
      count: sql<number>`count(*)::int`,
    })
    .from(initiatives)
    .groupBy(sql`1`)
    .orderBy(sql`2 desc`);
  return rows.map((r) => ({ key: r.key, count: r.count }));
}

export const countByCategory = (db: Database) => countBy(db, sql`source_category`);
export const countByStatus = (db: Database) => countBy(db, sql`status`);
export const countByChamber = (db: Database) => countBy(db, sql`chamber`);
export const countByProvince = (db: Database) => countBy(db, sql`province`);

export interface ProvinceInitiativeCountsRow {
  /** Province name exactly as published by the source. */
  province: string;
  total: number;
  /** Initiatives whose source condition is literally `VIGENTE` after trim/case normalization. */
  active: number;
}

/**
 * Factual initiative totals by source-literal province for the HOME map.
 *
 * `active` deliberately uses only the source's `condition` field. Procedural `status`
 * is not consulted and no legislative state is inferred.
 */
export async function countInitiativesByProvinceWithActive(
  db: Database,
): Promise<ProvinceInitiativeCountsRow[]> {
  const rows = await db
    .select({
      province: initiatives.province,
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (
        where upper(trim(${initiatives.condition})) = 'VIGENTE'
      )::int`,
    })
    .from(initiatives)
    .where(isNotNull(initiatives.province))
    .groupBy(initiatives.province)
    .orderBy(initiatives.province);

  return rows.filter((row): row is ProvinceInitiativeCountsRow => row.province !== null);
}

export interface ProvinceDepositedInitiativeCountRow {
  /** Province name exactly as published by the source. */
  province: string;
  /** Initiatives whose source status is literally `DEPOSITADO` after trim/case normalization. */
  total: number;
}

/**
 * Factual deposited-initiative totals by source-literal province for the HOME explorer.
 *
 * This deliberately reads only the source's current `status` field and requires an exact
 * normalized `DEPOSITADO` value. It does not infer a deposited state from documents,
 * history, condition or any other field.
 */
export async function countDepositedInitiativesByProvince(
  db: Database,
): Promise<ProvinceDepositedInitiativeCountRow[]> {
  const rows = await db
    .select({
      province: initiatives.province,
      total: sql<number>`count(*)::int`,
    })
    .from(initiatives)
    .where(
      and(isNotNull(initiatives.province), sql`upper(trim(${initiatives.status})) = 'DEPOSITADO'`),
    )
    .groupBy(initiatives.province)
    .orderBy(initiatives.province);

  return rows.filter((row): row is ProvinceDepositedInitiativeCountRow => row.province !== null);
}

export interface ProvinceInitiativeRow {
  id: number;
  code: string | null;
  title: string;
  /** Latest English display translation for this exact current official title. */
  titleEn: string | null;
  status: string | null;
  chamber: string | null;
  province: string;
  filedAt: string | null;
}

/**
 * A bounded factual sample for the HOME province explorer.
 *
 * `province` is the represented province explicitly published for the principal
 * proponent. The query deliberately ranks within each source-literal province so the
 * browser never receives the full initiative corpus; aliases are reconciled by the
 * web data layer before its final per-province limit is applied.
 */
export async function listRecentInitiativesByProvince(
  db: Database,
  perProvince = 6,
): Promise<ProvinceInitiativeRow[]> {
  const bounded = Math.min(Math.max(Math.trunc(perProvince), 1), 12);
  const ranked = db.$with("ranked_province_initiatives").as(
    db
      .select({
        id: initiatives.id,
        code: initiatives.code,
        title: initiatives.title,
        titleEn: currentEnglishInitiativeTitleSql().as("title_en"),
        status: initiatives.status,
        chamber: initiatives.chamber,
        province: initiatives.province,
        filedAt: initiatives.filedAt,
        provinceRank: sql<number>`row_number() over (
            partition by ${initiatives.province}
            order by ${initiatives.filedAt} desc nulls last, ${initiatives.id} desc
          )`.as("province_rank"),
      })
      .from(initiatives)
      .where(isNotNull(initiatives.province)),
  );

  const rows = await db
    .with(ranked)
    .select({
      id: ranked.id,
      code: ranked.code,
      title: ranked.title,
      titleEn: ranked.titleEn,
      status: ranked.status,
      chamber: ranked.chamber,
      province: ranked.province,
      filedAt: ranked.filedAt,
    })
    .from(ranked)
    .where(sql`${ranked.provinceRank} <= ${bounded}`)
    .orderBy(sql`${ranked.filedAt} desc nulls last, ${ranked.id} desc`);

  return rows.filter((row): row is ProvinceInitiativeRow => Boolean(row.province));
}

/**
 * Latest source-reported deposited initiatives for every source-literal province.
 *
 * Only the current source `status` is consulted, using the same exact normalized
 * `DEPOSITADO` contract as {@link countDepositedInitiativesByProvince}. Rows with no
 * source-reported province are excluded. Aliases remain a presentation-layer concern.
 */
export async function listRecentDepositedInitiativesByProvince(
  db: Database,
  perProvince = 5,
): Promise<ProvinceInitiativeRow[]> {
  const bounded = Math.min(Math.max(Math.trunc(perProvince), 1), 12);
  const ranked = db.$with("ranked_deposited_province_initiatives").as(
    db
      .select({
        id: initiatives.id,
        code: initiatives.code,
        title: initiatives.title,
        titleEn: currentEnglishInitiativeTitleSql().as("title_en"),
        status: initiatives.status,
        chamber: initiatives.chamber,
        province: initiatives.province,
        filedAt: initiatives.filedAt,
        provinceRank: sql<number>`row_number() over (
            partition by ${initiatives.province}
            order by ${initiatives.filedAt} desc nulls last, ${initiatives.id} desc
          )`.as("province_rank"),
      })
      .from(initiatives)
      .where(
        and(
          isNotNull(initiatives.province),
          sql`upper(trim(${initiatives.status})) = 'DEPOSITADO'`,
        ),
      ),
  );

  const rows = await db
    .with(ranked)
    .select({
      id: ranked.id,
      code: ranked.code,
      title: ranked.title,
      titleEn: ranked.titleEn,
      status: ranked.status,
      chamber: ranked.chamber,
      province: ranked.province,
      filedAt: ranked.filedAt,
    })
    .from(ranked)
    .where(sql`${ranked.provinceRank} <= ${bounded}`)
    .orderBy(sql`${ranked.filedAt} desc nulls last, ${ranked.id} desc`);

  return rows.filter((row): row is ProvinceInitiativeRow => Boolean(row.province));
}

export interface LegislatorRow {
  province: string;
  chamber: string | null;
  sponsor: string;
  role: string | null;
  party: string | null;
}

/**
 * Distinct legislators (sponsors of initiatives) grouped by province — used by the map's
 * click panel. Only people who have appeared as a proponent are known here; it is not a
 * full elected-roster source.
 */
export async function legislatorsByProvince(db: Database): Promise<LegislatorRow[]> {
  const rows = await db
    .selectDistinct({
      province: initiatives.province,
      chamber: initiatives.chamber,
      sponsor: initiatives.sponsor,
      role: initiatives.sponsorRole,
      party: initiatives.party,
    })
    .from(initiatives)
    .where(and(sql`${initiatives.sponsor} is not null`, sql`${initiatives.province} is not null`));
  return rows
    .filter((r): r is LegislatorRow => !!r.province && !!r.sponsor)
    .sort((a, b) => a.sponsor.localeCompare(b.sponsor));
}

export interface DashboardKpis {
  total: number;
  /** Initiatives with at least one attributable document row. */
  published: number;
}

export async function dashboardKpis(db: Database): Promise<DashboardKpis> {
  const [row] = await db
    .select({
      total: sql<number>`count(distinct ${initiatives.id})::int`,
      published: sql<number>`count(distinct ${documents.initiativeId})::int`,
    })
    .from(initiatives)
    .leftJoin(documents, eq(documents.initiativeId, initiatives.id));
  return {
    total: row?.total ?? 0,
    published: row?.published ?? 0,
  };
}

export interface InitiativeListItem {
  id: number;
  source: string;
  sourceId: string;
  code: string | null;
  title: string;
  /** Latest reviewed English display translation for this exact current official title. */
  titleEn: string | null;
  sourceCategory: string | null;
  status: string | null;
  chamber: string | null;
  sponsor: string | null;
  sponsorRole: string | null;
  /** Exact source person id on the normalized principal/first published proponent row. */
  sponsorLegislatorSourceId: string | null;
  /** Active elected-roster profile resolved by the normalized source identity relation. */
  sponsorProfileId: number | null;
  /** Role of the profile used to filter this page; absent when no profile filter is active. */
  filteredProponentRelationship: "principal" | "coproponent" | "published" | null;
  party: string | null;
  province: string | null;
  filedAt: string | null;
  sourceUrl: string | null;
  /** Latest official deposited bill-text PDF, never an agenda/report attachment. */
  preferredDocumentId: number | null;
  preferredDocumentUrl: string | null;
  /** True only while the exact current metadata snapshot has a recent persisted PDF check. */
  preferredDocumentAvailable: boolean;
}

type InitiativeListBase = Omit<
  InitiativeListItem,
  "preferredDocumentId" | "preferredDocumentUrl" | "preferredDocumentAvailable"
>;

async function attachInitiativeSponsorProfiles<
  T extends {
    id: number;
    raw: unknown;
    sponsor: string | null;
    sponsorRole: string | null;
  },
>(
  db: Database,
  rows: T[],
): Promise<
  Array<
    Omit<T, "raw"> & {
      sponsorLegislatorSourceId: string | null;
      sponsorProfileId: number | null;
    }
  >
> {
  if (rows.length === 0) return [];
  const published = await db
    .select({
      initiativeId: initiativeProponents.initiativeId,
      personSourceId: initiativeProponents.personSourceId,
      publishedName: initiativeProponents.publishedName,
      principal: initiativeProponents.principal,
      ordinal: initiativeProponents.ordinal,
      legislatorId: initiativeProponents.legislatorId,
      profileRole: legislators.role,
    })
    .from(initiativeProponents)
    .leftJoin(legislators, eq(legislators.id, initiativeProponents.legislatorId))
    .where(
      inArray(
        initiativeProponents.initiativeId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(
      initiativeProponents.initiativeId,
      initiativeProponents.ordinal,
      initiativeProponents.id,
    );
  const selected = new Map<number, (typeof published)[number]>();
  for (const candidate of published) {
    const current = selected.get(candidate.initiativeId);
    if (!current || (candidate.principal === true && current.principal !== true)) {
      selected.set(candidate.initiativeId, candidate);
    }
  }
  return rows.map((row) => {
    const { raw: _raw, ...publicRow } = row;
    const sponsor = selected.get(row.id);
    return {
      ...publicRow,
      // The Senate scalar may contain several names. Only one normalized occurrence
      // is allowed to become the visible/clickable person on a list row.
      sponsor: sponsor?.publishedName ?? publicRow.sponsor,
      sponsorRole: sponsor?.profileRole ?? publicRow.sponsorRole,
      sponsorLegislatorSourceId: sponsor?.personSourceId ?? null,
      sponsorProfileId: sponsor?.legislatorId ?? null,
    };
  });
}

/**
 * Persisted availability for the exact current document metadata snapshot.
 *
 * A row in `documents` proves only that the public catalog registered metadata. It
 * does not prove that the source actually serves PDF bytes (the SIL frequently returns
 * a successful HTML response saying that the file does not exist). Reachability is
 * therefore persisted independently from optional text extraction. Keeping this
 * contract in the repository prevents every UI surface from independently guessing
 * availability or hiding a valid large/scanned PDF.
 */
function exactCurrentDocumentPdfVerificationExists(freshness: "availability" | "renewal") {
  const interval =
    freshness === "availability" ? sql`interval '24 hours'` : sql`interval '12 hours'`;
  return sql<boolean>`exists (
    select 1
      from ${documentPdfVerifications} verified_document
     where verified_document.document_id = documents.id
       and verified_document.reachable = true
       and verified_document.verified_at >= now() - ${interval}
       and verified_document.source_snapshot ->> 'initiativeId'
         is not distinct from documents.initiative_id::text
       and verified_document.source_snapshot ->> 'source' = documents.source
       and verified_document.source_snapshot ->> 'sourceDocId'
         is not distinct from documents.source_doc_id
       and verified_document.source_snapshot ->> 'url'
         is not distinct from documents.url
       and verified_document.source_snapshot ->> 'docType'
         is not distinct from documents.doc_type
       and verified_document.source_snapshot ->> 'uploadedAt'
         is not distinct from documents.uploaded_at
       and verified_document.source_snapshot ->> 'modifiedAt'
         is not distinct from documents.modified_at
  )`;
}

function currentDocumentPdfAvailable() {
  return exactCurrentDocumentPdfVerificationExists("availability");
}

/**
 * Renew halfway through the public 24-hour availability window. Three scheduled
 * passes per day then leave at least one further attempt before a healthy link expires.
 */
function currentDocumentPdfVerificationDue() {
  return sql<boolean>`not (${exactCurrentDocumentPdfVerificationExists("renewal")})`;
}

async function attachPreferredDepositedDocuments<T extends InitiativeListBase>(
  db: Database,
  rows: T[],
): Promise<
  Array<
    T & {
      preferredDocumentId: number | null;
      preferredDocumentUrl: string | null;
      preferredDocumentAvailable: boolean;
    }
  >
> {
  if (rows.length === 0) return [];
  const candidates = await db
    .select({
      id: documents.id,
      initiativeId: documents.initiativeId,
      source: documents.source,
      docType: documents.docType,
      url: documents.url,
      pdfAvailable: currentDocumentPdfAvailable(),
    })
    .from(documents)
    .where(
      and(
        inArray(
          documents.initiativeId,
          rows.map((row) => row.id),
        ),
        eq(documents.source, "sil-diputados"),
        isNotNull(documents.url),
        sql`lower(trim(coalesce(${documents.docType}, ''))) in ('proyecto depositado', 'p depositado')`,
        or(
          sql`lower(trim(coalesce(${documents.extension}, ''))) = 'pdf'`,
          sql`${documents.url} ~* '\\.pdf(?:$|[?#])'`,
          sql`${documents.url} ~* '^https://([a-z0-9-]+\\.)*(diputadosrd\\.gob\\.do|camaradediputados\\.gob\\.do)(:[0-9]+)?/ReportesGenerales/VerDocumento\\?[^#]*documentoId=[0-9]+(?:[&#]|$)'`,
        ),
      ),
    )
    .orderBy(
      documents.initiativeId,
      sql`${documents.uploadedAt} desc nulls last`,
      sql`${documents.id} desc`,
    );
  const byInitiative = new Map<number, { id: number; url: string; pdfAvailable: boolean }>();
  for (const candidate of candidates) {
    const canonicalUrl = officialDepositedBillPdfUrl(candidate);
    if (
      candidate.initiativeId != null &&
      canonicalUrl &&
      !byInitiative.has(candidate.initiativeId)
    ) {
      byInitiative.set(candidate.initiativeId, {
        id: candidate.id,
        url: canonicalUrl,
        pdfAvailable: candidate.pdfAvailable,
      });
    }
  }
  return rows.map((row) => ({
    ...row,
    preferredDocumentId: byInitiative.get(row.id)?.id ?? null,
    preferredDocumentUrl: byInitiative.get(row.id)?.url ?? null,
    preferredDocumentAvailable: byInitiative.get(row.id)?.pdfAvailable ?? false,
  }));
}

export interface InitiativeFilters {
  search?: string;
  party?: string;
  status?: string;
  chamber?: string;
  /**
   * Exact Cámara SIL `legisladorId` archived on an official proponent row. Includes
   * principal and co-proponents; names never participate in this association.
   */
  proponentLegislatorSourceId?: string;
  /** Canonical internal profile id resolved by the server; exact normalized relation only. */
  proponentLegislatorProfileId?: number;
  /** Source-literal province values accepted for this view; alias expansion is web-owned. */
  provinceValues?: string[];
  page?: number;
  pageSize?: number;
}

function normalizedProponentProfileFilterId(
  value: InitiativeFilters["proponentLegislatorProfileId"],
): number | null | undefined {
  if (value === undefined) return undefined;
  return Number.isSafeInteger(value) && value > 0 && value <= POSTGRES_INTEGER_MAX ? value : null;
}

async function attachFilteredProponentRelationship<T extends { id: number }>(
  db: Database,
  rows: T[],
  profileId: number | null | undefined,
): Promise<
  Array<
    T & {
      filteredProponentRelationship: "principal" | "coproponent" | "published" | null;
    }
  >
> {
  if (rows.length === 0 || profileId == null) {
    return rows.map((row) => ({ ...row, filteredProponentRelationship: null }));
  }
  const relationships = await db
    .select({
      initiativeId: initiativeProponents.initiativeId,
      principal: initiativeProponents.principal,
    })
    .from(initiativeProponents)
    .where(
      and(
        eq(initiativeProponents.legislatorId, profileId),
        inArray(
          initiativeProponents.initiativeId,
          rows.map((row) => row.id),
        ),
      ),
    );
  const byInitiative = new Map<number, "principal" | "coproponent" | "published">();
  for (const relationship of relationships) {
    const next =
      relationship.principal === true
        ? "principal"
        : relationship.principal === false
          ? "coproponent"
          : "published";
    const current = byInitiative.get(relationship.initiativeId);
    if (
      current == null ||
      next === "principal" ||
      (next === "coproponent" && current === "published")
    ) {
      byInitiative.set(relationship.initiativeId, next);
    }
  }
  return rows.map((row) => ({
    ...row,
    filteredProponentRelationship: byInitiative.get(row.id) ?? null,
  }));
}

export interface InitiativePage {
  rows: InitiativeListItem[];
  total: number;
  page: number;
  pageSize: number;
}

function filterConds(f: InitiativeFilters) {
  const conds = [];
  if (f.party) conds.push(eq(initiatives.party, f.party));
  if (f.status?.trim()) {
    conds.push(sql`upper(trim(${initiatives.status})) = upper(trim(${f.status}))`);
  }
  if (f.chamber) conds.push(eq(initiatives.chamber, f.chamber));
  if (f.proponentLegislatorSourceId !== undefined) {
    const sourceId = f.proponentLegislatorSourceId.trim();
    if (!sourceId) {
      // A present but empty identity must fail closed instead of dropping the filter.
      conds.push(sql`false`);
    } else {
      conds.push(eq(initiatives.source, "sil-diputados"));
      conds.push(eq(initiatives.kind, "LEGISLATIVE"));
      conds.push(sql`nullif(trim(${initiatives.filedAt}), '') is not null`);
      conds.push(sql`exists (
        select 1
        from jsonb_array_elements(
          case
            when jsonb_typeof(${initiatives.raw} #> '{payload,proponentes}') = 'array'
              then ${initiatives.raw} #> '{payload,proponentes}'
            when jsonb_typeof(${initiatives.raw} #> '{payload,proponents}') = 'array'
              then ${initiatives.raw} #> '{payload,proponents}'
            else '[]'::jsonb
          end
        ) as published_proponent(value)
        where published_proponent.value ->> 'legisladorId' = ${sourceId}
      )`);
    }
  }
  const profileId = normalizedProponentProfileFilterId(f.proponentLegislatorProfileId);
  if (profileId !== undefined) {
    if (profileId == null) {
      conds.push(sql`false`);
    } else {
      conds.push(sql`nullif(trim(${initiatives.filedAt}), '') is not null`);
      conds.push(sql`exists (
        select 1
          from ${initiativeProponents}
         where ${initiativeProponents.initiativeId} = ${initiatives.id}
           and ${initiativeProponents.legislatorId} = ${profileId}
      )`);
    }
  }
  const normalizedProvinceValues = [
    ...new Set(
      (f.provinceValues ?? [])
        .map((value) => value.trim().toUpperCase())
        .filter((value) => value.length > 0),
    ),
  ];
  if (normalizedProvinceValues.length > 0) {
    conds.push(
      inArray(sql<string>`upper(trim(${initiatives.province}))`, normalizedProvinceValues),
    );
  }
  if (f.search?.trim()) {
    const q = `%${f.search.trim()}%`;
    conds.push(
      sql`(${initiatives.title} ilike ${q}
        or ${initiatives.code} ilike ${q}
        or ${currentEnglishInitiativeTitleSql()} ilike ${q})`,
    );
  }
  return conds;
}

/** Paginated, filterable, searchable initiative list with total count. */
export async function listInitiatives(
  db: Database,
  f: InitiativeFilters = {},
): Promise<InitiativePage> {
  const page = Math.max(1, f.page ?? 1);
  const pageSize = Math.min(Math.max(1, f.pageSize ?? 50), 200);
  const filteredProfileId = normalizedProponentProfileFilterId(f.proponentLegislatorProfileId);
  const conds = filterConds(f);
  const where = conds.length ? and(...conds) : undefined;

  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(initiatives)
    .where(where);
  const total = totalRow?.total ?? 0;

  const baseRows = await db
    .select({
      id: initiatives.id,
      source: initiatives.source,
      sourceId: initiatives.sourceId,
      code: initiatives.code,
      title: initiatives.title,
      titleEn: currentEnglishInitiativeTitleSql().as("title_en"),
      sourceCategory: initiatives.sourceCategory,
      status: initiatives.status,
      chamber: initiatives.chamber,
      sponsor: initiatives.sponsor,
      sponsorRole: initiatives.sponsorRole,
      party: initiatives.party,
      province: initiatives.province,
      filedAt: initiatives.filedAt,
      sourceUrl: initiatives.sourceUrl,
      raw: initiatives.raw,
    })
    .from(initiatives)
    .where(where)
    .orderBy(sql`${initiatives.filedAt} desc nulls last, ${initiatives.id} desc`)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const rows = await attachPreferredDepositedDocuments(
    db,
    await attachInitiativeSponsorProfiles(
      db,
      await attachFilteredProponentRelationship(db, baseRows, filteredProfileId),
    ),
  );

  return { rows, total: total ?? 0, page, pageSize };
}

/** Full factual detail for one initiative and its source-attributed status timeline. */
export async function getInitiativeById(db: Database, id: number) {
  const [row] = await db
    .select({
      id: initiatives.id,
      source: initiatives.source,
      sourceId: initiatives.sourceId,
      kind: initiatives.kind,
      code: initiatives.code,
      title: initiatives.title,
      /** Reviewed display translation for this exact current official title only. */
      titleEn: currentEnglishInitiativeTitleSql().as("title_en"),
      purpose: initiatives.purpose,
      type: initiatives.type,
      status: initiatives.status,
      chamber: initiatives.chamber,
      sourceChamber: initiatives.sourceChamber,
      originChamber: initiatives.originChamber,
      currentChamber: initiatives.currentChamber,
      currentBody: initiatives.currentBody,
      condition: initiatives.condition,
      sourceCategory: initiatives.sourceCategory,
      subjectMatter: initiatives.subjectMatter,
      sponsor: initiatives.sponsor,
      sponsorRole: initiatives.sponsorRole,
      sponsorCount: initiatives.sponsorCount,
      party: initiatives.party,
      province: initiatives.province,
      committee: initiatives.committee,
      filedAt: initiatives.filedAt,
      expiresAt: initiatives.expiresAt,
      initiated: initiatives.initiated,
      initiatedAt: initiatives.initiatedAt,
      legislature: initiatives.legislature,
      registrationPeriod: initiatives.registrationPeriod,
      officialStatusChangedAt: initiatives.officialStatusChangedAt,
      promulgationNumber: initiatives.promulgationNumber,
      promulgatedAt: initiatives.promulgatedAt,
      sourceUrl: initiatives.sourceUrl,
      raw: initiatives.raw,
      firstSeenAt: initiatives.firstSeenAt,
      lastSeenAt: initiatives.lastSeenAt,
      updatedAt: initiatives.updatedAt,
    })
    .from(initiatives)
    .where(eq(initiatives.id, id))
    .limit(1);
  if (!row) return null;
  const [events, commissionAssignments] = await Promise.all([
    db
      .select({
        id: statusEvents.id,
        initiativeId: statusEvents.initiativeId,
        sourceEventId: statusEvents.sourceEventId,
        status: statusEvents.status,
        eventDate: statusEvents.eventDate,
        eventEndDate: statusEvents.eventEndDate,
        note: statusEvents.note,
        source: statusEvents.source,
        sourceUrl: statusEvents.sourceUrl,
        evidenceType: statusEvents.evidenceType,
        raw: statusEvents.raw,
        observedAt: statusEvents.observedAt,
      })
      .from(statusEvents)
      .where(and(eq(statusEvents.initiativeId, id), isNull(statusEvents.retiredAt)))
      .orderBy(sql`case
        when ${statusEvents.evidenceType} = 'SOURCE_HISTORY'
          and case
            when ${statusEvents.eventDate} ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
              then to_char(
                make_date(
                  substring(${statusEvents.eventDate} from 1 for 4)::int,
                  substring(${statusEvents.eventDate} from 6 for 2)::int,
                  1
                ) + (substring(${statusEvents.eventDate} from 9 for 2)::int - 1),
                'YYYY-MM-DD'
              ) = ${statusEvents.eventDate}
            else false
          end
          then ${statusEvents.eventDate}::date::timestamp
        else ${statusEvents.observedAt}
      end asc`),
    db
      .select({
        id: initiativeCommissionAssignments.id,
        initiativeId: initiativeCommissionAssignments.initiativeId,
        source: initiativeCommissionAssignments.source,
        sourceAssignmentId: initiativeCommissionAssignments.sourceAssignmentId,
        sourceTypeId: initiativeCommissionAssignments.sourceTypeId,
        name: initiativeCommissionAssignments.name,
        type: initiativeCommissionAssignments.type,
        startDate: initiativeCommissionAssignments.startDate,
        endDate: initiativeCommissionAssignments.endDate,
        raw: initiativeCommissionAssignments.raw,
        firstSeenAt: initiativeCommissionAssignments.firstSeenAt,
        lastSeenAt: initiativeCommissionAssignments.lastSeenAt,
      })
      .from(initiativeCommissionAssignments)
      .where(eq(initiativeCommissionAssignments.initiativeId, id))
      .orderBy(
        sql`${initiativeCommissionAssignments.startDate} asc nulls last, ${initiativeCommissionAssignments.id} asc`,
      ),
  ]);
  return { ...row, events, commissionAssignments };
}

/** Read only the retained source snapshot for safe per-collection ingestion merges. */
export async function getInitiativeRawBySourceId(
  db: Database,
  source: string,
  sourceId: string,
): Promise<unknown | undefined> {
  const [row] = await db
    .select({ raw: initiatives.raw })
    .from(initiatives)
    .where(and(eq(initiatives.source, source), eq(initiatives.sourceId, sourceId)))
    .limit(1);
  return row?.raw;
}

/** Distinct values to populate filter dropdowns. */
export async function facets(db: Database) {
  const distinct = async (col: ReturnType<typeof sql>) => {
    const rows = await db
      .select({ v: sql<string>`${col}` })
      .from(initiatives)
      .where(sql`${col} is not null`)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return rows.map((r) => r.v).filter(Boolean);
  };
  const [parties, statuses] = await Promise.all([distinct(sql`party`), distinct(sql`status`)]);
  return { parties, statuses };
}

// ---------------------------------------------------------------------------
// Committee / plenary activity (SIL "actividad" subsystem) — segmented from bills
// ---------------------------------------------------------------------------

export interface ActivityInput {
  source: string;
  sourceEventId?: string | null;
  scope: "COMMITTEE" | "PLENARY" | "ASAMBLEA";
  chamber?: "DIPUTADOS" | "SENADO" | null;
  date: string | null;
  time?: string | null;
  location?: string | null;
  kind: string | null;
  body: string | null;
  description: string;
  agendaUrl?: string | null;
  /** Preserve the previous verified URL only when its entire upstream catalog was
   * unavailable. Omit/false for an observed absence, mismatch, or ambiguity. */
  preserveAgendaUrlOnNull?: boolean;
  statuses?: string[];
  initiativeCodes: string[];
  dedupeKey: string;
  raw: unknown;
}

export interface ActivityUpsertResult {
  id: number;
  inserted: boolean;
}

/** Resolve an official code only when it identifies exactly one candidate in scope. */
function uniqueInitiativeIdsByCode(
  rows: Array<{ id: number; code: string | null; chamber: string | null }>,
  chamber: string | null | undefined,
): Map<string, number> {
  const candidates = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.code || (chamber && row.chamber !== chamber)) continue;
    const ids = candidates.get(row.code) ?? [];
    ids.push(row.id);
    candidates.set(row.code, ids);
  }
  return new Map(
    [...candidates].flatMap(([code, ids]) => (ids.length === 1 ? [[code, ids[0]!] as const] : [])),
  );
}

/**
 * Idempotent upsert of one agenda/activity event keyed by (source, dedupe_key), plus
 * its referenced-initiative links. Each link is resolved to an initiatives.id when that
 * bill already exists in the corpus (so the UI can join activity ↔ source bill record).
 *
 * Because the dedupeKey is identity-based (scope|date|body|kind, not a content hash),
 * an EDITED agenda updates the same row instead of spawning a duplicate — so all
 * mutable fields (description, statuses, codes, …) are refreshed on the existing path.
 */
export async function upsertActivityEvent(
  db: Database,
  a: ActivityInput,
): Promise<ActivityUpsertResult> {
  const exactExisting = a.sourceEventId
    ? await db
        .select({
          id: activityEvents.id,
          sourceEventId: activityEvents.sourceEventId,
          eventTime: activityEvents.eventTime,
          location: activityEvents.location,
          agendaUrl: activityEvents.agendaUrl,
        })
        .from(activityEvents)
        .where(
          and(
            eq(activityEvents.source, a.source),
            eq(activityEvents.sourceEventId, a.sourceEventId),
          ),
        )
        .limit(1)
    : [];
  const existing = exactExisting.length
    ? exactExisting
    : await db
        .select({
          id: activityEvents.id,
          sourceEventId: activityEvents.sourceEventId,
          eventTime: activityEvents.eventTime,
          location: activityEvents.location,
          agendaUrl: activityEvents.agendaUrl,
        })
        .from(activityEvents)
        .where(and(eq(activityEvents.source, a.source), eq(activityEvents.dedupeKey, a.dedupeKey)))
        .limit(1);
  return db.transaction(async (tx) => {
    const fields = {
      // Calendar endpoints can remove a past meeting from their date response even
      // though the committee-order row remains published. Null in that later snapshot
      // is not evidence that the previously observed official ID/time/location ceased
      // to be true, so retain those exact facts unless the source supplies replacements.
      sourceEventId: a.sourceEventId ?? existing[0]?.sourceEventId ?? null,
      scope: a.scope,
      chamber: a.chamber ?? null,
      eventDate: a.date,
      eventTime: a.time ?? existing[0]?.eventTime ?? null,
      location: a.location ?? existing[0]?.location ?? null,
      kind: a.kind,
      body: a.body,
      description: a.description,
      agendaUrl:
        a.agendaUrl ?? (a.preserveAgendaUrlOnNull ? (existing[0]?.agendaUrl ?? null) : null),
      statuses: (a.statuses ?? null) as object | null,
      raw: a.raw as object,
      lastSeenAt: sql`now()`,
    };
    const [row] = existing[0]
      ? await tx
          .update(activityEvents)
          .set(fields)
          .where(eq(activityEvents.id, existing[0].id))
          .returning({ id: activityEvents.id })
      : await tx
          .insert(activityEvents)
          .values({ source: a.source, dedupeKey: a.dedupeKey, ...fields })
          .onConflictDoUpdate({
            target: [activityEvents.source, activityEvents.dedupeKey],
            set: fields,
          })
          .returning({ id: activityEvents.id });
    const id = row!.id;

    // Treat links as a source snapshot: an edited agenda must remove stale bill codes.
    await tx.delete(activityInitiatives).where(eq(activityInitiatives.activityId, id));
    const uniqueCodes = [...new Set(a.initiativeCodes.filter(Boolean))];
    if (uniqueCodes.length) {
      const matched = await tx
        .select({ id: initiatives.id, code: initiatives.code, chamber: initiatives.chamber })
        .from(initiatives)
        .where(inArray(initiatives.code, uniqueCodes));
      const byCode = uniqueInitiativeIdsByCode(matched, a.chamber);
      await tx.insert(activityInitiatives).values(
        uniqueCodes.map((code) => ({
          activityId: id,
          initiativeCode: code,
          initiativeId: byCode.get(code) ?? null,
        })),
      );
    }
    return { id, inserted: existing.length === 0 };
  });
}

/**
 * Backfill activity↔initiative links for bills ingested after their agenda activity.
 * Run after a corpus ingest so existing NULL links resolve. Returns rows updated.
 */
export async function backfillActivityInitiativeIds(db: Database): Promise<number> {
  const res = await db.execute(sql`
    with unique_matches as (
      select ai.id as link_id, min(i.id)::int as initiative_id
      from activity_initiatives ai
      join activity_events ae on ae.id = ai.activity_id
      join initiatives i
        on i.code = ai.initiative_code
       and (ae.chamber is null or i.chamber = ae.chamber)
      where ai.initiative_id is null
      group by ai.id
      having count(*) = 1
    )
    update activity_initiatives ai
    set initiative_id = matches.initiative_id
    from unique_matches matches
    where ai.id = matches.link_id
  `);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

export interface ActivityListItem {
  id: number;
  source: string;
  sourceEventId: string | null;
  scope: string;
  chamber: string | null;
  eventDate: string | null;
  eventTime: string | null;
  location: string | null;
  kind: string | null;
  body: string | null;
  description: string;
  agendaUrl: string | null;
  statuses: string[] | null;
  initiativeCount: number;
  initiatives: Array<{
    code: string;
    initiativeId: number | null;
    title: string | null;
    sourceUrl: string | null;
  }>;
}

/**
 * Activity rows, newest first, with linked-bill counts. Filter by exact `date`, an
 * inclusive `[dateFrom, dateTo]` window (used to widen the Senate's "today" view since
 * its session dates can lag), scope, and/or chamber.
 */
export async function listActivity(
  db: Database,
  opts: {
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    scope?: string;
    chamber?: string;
    limit?: number;
  } = {},
): Promise<ActivityListItem[]> {
  const { date, dateFrom, dateTo, scope, chamber, limit = 200 } = opts;
  const conds = [];
  if (date) conds.push(eq(activityEvents.eventDate, date));
  if (dateFrom) conds.push(sql`${activityEvents.eventDate} >= ${dateFrom}`);
  if (dateTo) conds.push(sql`${activityEvents.eventDate} <= ${dateTo}`);
  if (scope) conds.push(eq(activityEvents.scope, scope));
  if (chamber) conds.push(eq(activityEvents.chamber, chamber));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select({
      id: activityEvents.id,
      source: activityEvents.source,
      sourceEventId: activityEvents.sourceEventId,
      scope: activityEvents.scope,
      chamber: activityEvents.chamber,
      eventDate: activityEvents.eventDate,
      eventTime: activityEvents.eventTime,
      location: activityEvents.location,
      kind: activityEvents.kind,
      body: activityEvents.body,
      description: activityEvents.description,
      agendaUrl: activityEvents.agendaUrl,
      statuses: sql<string[] | null>`${activityEvents.statuses}`,
      initiativeCount: sql<number>`count(${activityInitiatives.id})::int`,
    })
    .from(activityEvents)
    .leftJoin(activityInitiatives, eq(activityInitiatives.activityId, activityEvents.id))
    .where(where)
    .groupBy(activityEvents.id)
    .orderBy(sql`${activityEvents.eventDate} desc nulls last`, activityEvents.body)
    .limit(limit);
  const ids = rows.map((row) => row.id);
  const links = ids.length
    ? await db
        .select({
          activityId: activityInitiatives.activityId,
          code: activityInitiatives.initiativeCode,
          initiativeId: activityInitiatives.initiativeId,
          title: initiatives.title,
          sourceUrl: initiatives.sourceUrl,
        })
        .from(activityInitiatives)
        .leftJoin(initiatives, eq(activityInitiatives.initiativeId, initiatives.id))
        .where(inArray(activityInitiatives.activityId, ids))
        .orderBy(activityInitiatives.activityId, activityInitiatives.id)
    : [];
  const linksByActivity = new Map<number, ActivityListItem["initiatives"]>();
  for (const link of links) {
    const current = linksByActivity.get(link.activityId) ?? [];
    current.push({
      code: link.code,
      initiativeId: link.initiativeId,
      title: link.title ?? null,
      sourceUrl: link.sourceUrl ?? null,
    });
    linksByActivity.set(link.activityId, current);
  }
  return rows.map((row) => ({
    ...row,
    initiatives: linksByActivity.get(row.id) ?? [],
  }));
}

export interface ActivityDetailItem extends ActivityListItem {
  raw: unknown;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** One durable agenda/activity record for the shareable detail page. */
export async function getActivityById(
  db: Database,
  id: number,
): Promise<ActivityDetailItem | null> {
  const [row] = await db
    .select({
      id: activityEvents.id,
      source: activityEvents.source,
      sourceEventId: activityEvents.sourceEventId,
      scope: activityEvents.scope,
      chamber: activityEvents.chamber,
      eventDate: activityEvents.eventDate,
      eventTime: activityEvents.eventTime,
      location: activityEvents.location,
      kind: activityEvents.kind,
      body: activityEvents.body,
      description: activityEvents.description,
      agendaUrl: activityEvents.agendaUrl,
      statuses: sql<string[] | null>`${activityEvents.statuses}`,
      raw: activityEvents.raw,
      firstSeenAt: activityEvents.firstSeenAt,
      lastSeenAt: activityEvents.lastSeenAt,
    })
    .from(activityEvents)
    .where(eq(activityEvents.id, id))
    .limit(1);
  if (!row) return null;

  const initiativesForActivity = await db
    .select({
      code: activityInitiatives.initiativeCode,
      initiativeId: activityInitiatives.initiativeId,
      title: initiatives.title,
      sourceUrl: initiatives.sourceUrl,
    })
    .from(activityInitiatives)
    .leftJoin(initiatives, eq(activityInitiatives.initiativeId, initiatives.id))
    .where(eq(activityInitiatives.activityId, id))
    .orderBy(activityInitiatives.id);

  return {
    ...row,
    initiativeCount: initiativesForActivity.length,
    initiatives: initiativesForActivity.map((initiative) => ({
      code: initiative.code,
      initiativeId: initiative.initiativeId,
      title: initiative.title ?? null,
      sourceUrl: initiative.sourceUrl ?? null,
    })),
  };
}

/** Daily activity counts (for the dashboard "activity per day" view). ASAMBLEA is
 *  folded into the plenary bucket so the calendar agrees with the /hoy aggregation. */
export async function activityCountsByDate(
  db: Database,
  opts: { since?: string } = {},
): Promise<Array<{ date: string; committee: number; plenary: number }>> {
  const where = opts.since ? sql`where event_date >= ${opts.since}` : sql``;
  const rows = await db.execute(sql`
    select event_date as date,
           count(*) filter (where scope = 'COMMITTEE')::int as committee,
           count(*) filter (where scope in ('PLENARY','ASAMBLEA'))::int as plenary
    from activity_events ${where}
    group by event_date
    order by event_date desc nulls last
  `);
  return (rows as unknown as { rows: Array<{ date: string; committee: number; plenary: number }> })
    .rows;
}

// ---------------------------------------------------------------------------
// Regulatory instruments (regulatory monitoring twin of initiatives)
// ---------------------------------------------------------------------------

export interface RegulationUpsertResult {
  id: number;
  inserted: boolean;
}

/** Idempotent upsert of a regulation keyed by (source, source_id). */
export async function upsertRegulation(
  db: Database,
  r: NewRegulation,
): Promise<RegulationUpsertResult> {
  const existing = await db
    .select({ id: regulations.id })
    .from(regulations)
    .where(and(eq(regulations.source, r.source), eq(regulations.sourceId, r.sourceId)))
    .limit(1);
  const rejected = {
    interventionLevel: r.interventionLevel ?? null,
    category: r.category ?? null,
    needsReview: r.needsReview ?? null,
  };
  const hasRejected = Object.values(rejected).some((value) => value != null && value !== false);
  const safeRegulation: NewRegulation = {
    ...r,
    sourceCategory: r.sourceCategory ?? null,
    isConsulta: r.isConsulta ?? null,
    interventionLevel: null,
    category: null,
    needsReview: false,
  };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(regulations)
      .values(safeRegulation)
      .onConflictDoUpdate({
        target: [regulations.source, regulations.sourceId],
        set: {
          title: r.title,
          institution: r.institution,
          regType: r.regType,
          purpose: r.purpose,
          status: r.status,
          sourceCategory: r.sourceCategory ?? null,
          interventionLevel: null,
          category: null,
          province: r.province,
          isConsulta: r.isConsulta ?? null,
          publishedAt: r.publishedAt,
          deadline: r.deadline,
          url: r.url,
          needsReview: false,
          raw: r.raw,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: regulations.id });
    const id = row!.id;
    if (hasRejected) {
      await tx
        .insert(inferenceAudit)
        .values({
          entityType: "regulation",
          entityId: id,
          inferenceKind: "blocked_inference",
          value: rejected,
          provenance: {
            source: r.source,
            sourceCategory: r.sourceCategory ?? null,
            sourceUrl: r.url ?? null,
          },
        })
        .onConflictDoUpdate({
          target: [
            inferenceAudit.entityType,
            inferenceAudit.entityId,
            inferenceAudit.inferenceKind,
          ],
          set: {
            value: rejected,
            provenance: {
              source: r.source,
              sourceCategory: r.sourceCategory ?? null,
              sourceUrl: r.url ?? null,
            },
            archivedAt: sql`now()`,
          },
        });
    }
    return { id, inserted: existing.length === 0 };
  });
}

export interface RegulationListItem {
  id: number;
  institution: string;
  regType: string | null;
  title: string;
  status: string | null;
  sourceCategory: string | null;
  isConsulta: boolean | null;
  publishedAt: string | null;
  deadline: string | null;
  url: string | null;
}

export async function listRegulations(
  db: Database,
  opts: { institution?: string; consultaOnly?: boolean; limit?: number } = {},
): Promise<RegulationListItem[]> {
  const conds = [];
  if (opts.institution) conds.push(eq(regulations.institution, opts.institution));
  if (opts.consultaOnly) conds.push(eq(regulations.isConsulta, true));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select({
      id: regulations.id,
      institution: regulations.institution,
      regType: regulations.regType,
      title: regulations.title,
      status: regulations.status,
      sourceCategory: regulations.sourceCategory,
      isConsulta: regulations.isConsulta,
      publishedAt: regulations.publishedAt,
      deadline: regulations.deadline,
      url: regulations.url,
    })
    .from(regulations)
    .where(where)
    .orderBy(sql`${regulations.publishedAt} desc nulls last`)
    .limit(opts.limit ?? 200);
  return rows;
}

export interface RegulatoryKpis {
  total: number;
  consultas: number;
  institutions: number;
}

export async function regulatoryKpis(db: Database): Promise<RegulatoryKpis> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      consultas: sql<number>`count(*) filter (where ${regulations.isConsulta})::int`,
      institutions: sql<number>`count(distinct ${regulations.institution})::int`,
    })
    .from(regulations);
  return {
    total: row?.total ?? 0,
    consultas: row?.consultas ?? 0,
    institutions: row?.institutions ?? 0,
  };
}

export async function regulationsByInstitution(db: Database): Promise<Bucket[]> {
  const rows = await db
    .select({ key: regulations.institution, count: sql<number>`count(*)::int` })
    .from(regulations)
    .groupBy(regulations.institution)
    .orderBy(sql`2 desc`);
  return rows.map((r) => ({ key: r.key ?? "N/D", count: r.count }));
}

// ---------------------------------------------------------------------------
// Commissions, documents, health — Phase 1 segmented sources
// ---------------------------------------------------------------------------

/** Upsert a committee (by source+chamber+name); refreshes president. */
export async function upsertCommission(db: Database, c: NewCommission): Promise<void> {
  await db
    .insert(commissions)
    .values(c)
    .onConflictDoUpdate({
      target: [commissions.source, commissions.chamber, commissions.name],
      set: { president: c.president, sourceUrl: c.sourceUrl, updatedAt: sql`now()` },
    });
}

export async function listCommissions(
  db: Database,
  opts: { chamber?: string } = {},
): Promise<
  Array<{ chamber: string; name: string; president: string | null; sourceUrl: string | null }>
> {
  const where = opts.chamber ? eq(commissions.chamber, opts.chamber) : undefined;
  return db
    .select({
      chamber: commissions.chamber,
      name: commissions.name,
      president: commissions.president,
      sourceUrl: commissions.sourceUrl,
    })
    .from(commissions)
    .where(where)
    .orderBy(commissions.chamber, commissions.name);
}

/** Upsert a document (by source+source_doc_id); resolves initiativeId by code. */
export async function upsertDocument(db: Database, d: NewDocument): Promise<boolean> {
  let initiativeId = d.initiativeId ?? null;
  if (!initiativeId && d.initiativeCode) {
    const matches = await db
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(eq(initiatives.code, d.initiativeCode))
      .limit(2);
    initiativeId = matches.length === 1 ? matches[0]!.id : null;
  }
  const sourceDocId =
    d.sourceDocId ??
    [d.initiativeCode ?? "unknown", d.docType ?? "document", d.uploadedAt ?? "undated", d.url ?? ""]
      .join("|")
      .slice(0, 500);
  const existing = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.source, d.source), eq(documents.sourceDocId, sourceDocId)))
    .limit(1);
  await db
    .insert(documents)
    .values({ ...d, sourceDocId, initiativeId })
    .onConflictDoUpdate({
      target: [documents.source, documents.sourceDocId],
      set: {
        initiativeId,
        initiativeCode: d.initiativeCode,
        docType: d.docType,
        extension: d.extension,
        url: d.url,
        uploadedAt: d.uploadedAt,
        modifiedAt: d.modifiedAt ?? sql`${documents.modifiedAt}`,
        sourceCategory: d.sourceCategory ?? sql`${documents.sourceCategory}`,
        sourceFragment: d.sourceFragment ?? sql`${documents.sourceFragment}`,
        raw: d.raw ?? sql`${documents.raw}`,
        lastSeenAt: sql`now()`,
      },
    });
  return existing.length === 0;
}

/** Initiatives that still need a document sweep (source id + code to query/link). */
export async function listInitiativesForDocuments(
  db: Database,
  opts: { source?: string; limit?: number; missingDepositedOnly?: boolean } = {},
): Promise<Array<{ id: number; sourceId: string; code: string | null }>> {
  const conditions = [eq(initiatives.kind, "LEGISLATIVE")];
  if (opts.source) conditions.push(eq(initiatives.source, opts.source));
  if (opts.missingDepositedOnly) {
    // An initiative remains eligible until the Cámara's own document collection has
    // published one of the two exact deposited-bill labels. Filing date is deliberately
    // absent: a PDF uploaded weeks later must still be discovered on the next sweep.
    conditions.push(sql<boolean>`not exists (
      select 1
        from ${documents} candidate_document
       where candidate_document.initiative_id = ${initiatives.id}
         and candidate_document.source = ${initiatives.source}
         and candidate_document.source_doc_id is not null
         and candidate_document.url is not null
         and lower(trim(coalesce(candidate_document.doc_type, '')))
               in ('proyecto depositado', 'p depositado')
    )`);
  }
  const q = db
    .select({ id: initiatives.id, sourceId: initiatives.sourceId, code: initiatives.code })
    .from(initiatives)
    .where(and(...conditions))
    .orderBy(sql`${initiatives.id} desc`);
  return opts.limit ? q.limit(opts.limit) : q;
}

/** Senate source IDs whose raw payload contains a successfully verified Ficha. */
export async function listVerifiedSenateFichaSourceIds(db: Database): Promise<string[]> {
  const rows = await db
    .select({ sourceId: initiatives.sourceId })
    .from(initiatives)
    .where(
      and(eq(initiatives.source, "senado-sil"), sql`${initiatives.raw} -> 'payload' ? 'ficha'`),
    );
  return rows.map((row) => row.sourceId);
}

/** Documents pending a local/remote file fetch (have a URL, no stored path yet). */
export async function listDocumentsToFetch(
  db: Database,
  opts: { limit?: number } = {},
): Promise<
  Array<{
    id: number;
    sourceDocId: string | null;
    initiativeCode: string | null;
    url: string | null;
    docType: string | null;
  }>
> {
  const q = db
    .select({
      id: documents.id,
      sourceDocId: documents.sourceDocId,
      initiativeCode: documents.initiativeCode,
      url: documents.url,
      docType: documents.docType,
    })
    .from(documents)
    .where(sql`${documents.url} is not null`)
    .orderBy(sql`${documents.id} desc`);
  return opts.limit ? q.limit(opts.limit) : q;
}

/** Documents for one initiative (by id), newest upload first. */
export async function listDocuments(
  db: Database,
  initiativeId: number,
): Promise<
  Array<{
    id: number;
    source: string;
    sourceDocId: string | null;
    docType: string | null;
    extension: string | null;
    url: string | null;
    uploadedAt: string | null;
    modifiedAt: string | null;
    sourceCategory: string | null;
    sourceFragment: string | null;
    raw: unknown;
    firstSeenAt: string;
    lastSeenAt: string;
    /** Recent persisted validation of the exact current official PDF metadata snapshot. */
    pdfAvailable: boolean;
  }>
> {
  return db
    .select({
      id: documents.id,
      source: documents.source,
      sourceDocId: documents.sourceDocId,
      docType: documents.docType,
      extension: documents.extension,
      url: documents.url,
      uploadedAt: documents.uploadedAt,
      modifiedAt: documents.modifiedAt,
      sourceCategory: documents.sourceCategory,
      sourceFragment: documents.sourceFragment,
      raw: documents.raw,
      firstSeenAt: sql<string>`${documents.firstSeenAt}::text`,
      lastSeenAt: sql<string>`${documents.lastSeenAt}::text`,
      pdfAvailable: currentDocumentPdfAvailable(),
    })
    .from(documents)
    .where(eq(documents.initiativeId, initiativeId))
    .orderBy(sql`${documents.uploadedAt} desc nulls last`, sql`${documents.id} desc`);
}

export interface OfficialDepositedDocument {
  id: number;
  initiativeId: number;
  initiativeSourceId: string;
  initiativeCode: string | null;
  initiativeTitle: string;
  source: string;
  sourceDocId: string | null;
  docType: string | null;
  url: string;
  uploadedAt: string | null;
  modifiedAt: string | null;
  pdfAvailable: boolean;
}

/**
 * Resolve one current deposited-document row by its server-owned id and include the
 * separate persisted full-file availability decision. Background availability labels
 * must require `pdfAvailable`; an explicit user open may instead perform a fresh,
 * fail-closed live probe against this server-owned metadata before redirecting.
 */
export async function getOfficialDepositedDocumentById(
  db: Database,
  documentId: number,
  initiativeId: number,
): Promise<OfficialDepositedDocument | null> {
  if (
    !Number.isSafeInteger(documentId) ||
    documentId <= 0 ||
    !Number.isSafeInteger(initiativeId) ||
    initiativeId <= 0
  ) {
    return null;
  }
  const [row] = await db
    .select({
      id: documents.id,
      initiativeId: documents.initiativeId,
      initiativeSourceId: initiatives.sourceId,
      initiativeCode: initiatives.code,
      initiativeTitle: initiatives.title,
      source: documents.source,
      sourceDocId: documents.sourceDocId,
      docType: documents.docType,
      url: documents.url,
      uploadedAt: documents.uploadedAt,
      modifiedAt: documents.modifiedAt,
      pdfAvailable: currentDocumentPdfAvailable(),
    })
    .from(documents)
    .innerJoin(initiatives, eq(documents.initiativeId, initiatives.id))
    .where(and(eq(documents.id, documentId), eq(documents.initiativeId, initiativeId)))
    .limit(1);
  if (row?.initiativeId == null || typeof row.url !== "string") return null;
  const canonicalUrl = officialDepositedBillPdfUrl(row);
  return canonicalUrl ? { ...row, initiativeId: row.initiativeId, url: canonicalUrl } : null;
}

// ---------------------------------------------------------------------------
// Explicit, isolated official-PDF verification
// ---------------------------------------------------------------------------

export interface OfficialDocumentVerificationCandidate {
  documentId: number;
  source: string;
  sourceDocId: string | null;
  url: string;
  initiativeId: number;
  sourceSnapshot: DocumentSourceSnapshot;
}

/**
 * Linked official PDFs eligible for byte-level verification. This query returns only
 * the metadata needed to validate one deposited bill document and its exact snapshot.
 */
export async function listOfficialDepositedDocumentsForVerification(
  db: Database,
  opts: {
    documentId?: number;
    initiativeId?: number;
    beforeDocumentId?: number;
    /** Fixed inclusive high-water mark for a resumable descending cycle. */
    atOrBeforeDocumentId?: number;
    limit?: number;
    /** Restrict to metadata snapshots without a fresh persisted PDF verification. */
    unverifiedOnly?: boolean;
    /** Restrict to snapshots whose byte check is missing or at least 12 hours old. */
    verificationDueOnly?: boolean;
  } = {},
): Promise<OfficialDocumentVerificationCandidate[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));
  const conditions = [
    isNotNull(documents.initiativeId),
    isNotNull(documents.url),
    // Only the one-PDL deposited bill text is eligible. Committee reports, agendas,
    // gazettes, and multi-initiative publications are contextual evidence and must not
    // be presented as the deposited text of a single PDL.
    eq(documents.source, "sil-diputados"),
    sql`lower(trim(coalesce(${documents.docType}, ''))) in ('proyecto depositado', 'p depositado')`,
    // Keep LIMIT behind the same fail-closed URL contract used by worker and UI.
    // A final URL() parse below remains a second line of defense.
    sql`${documents.url} ~* '^https://([a-z0-9-]+\\.)*(diputadosrd\\.gob\\.do|camaradediputados\\.gob\\.do)(:[0-9]+)?/'`,
    or(
      sql`${documents.url} ~* '^https://([a-z0-9-]+\\.)*(diputadosrd\\.gob\\.do|camaradediputados\\.gob\\.do)(:[0-9]+)?/[^?#]*\\.pdf(?:[?#]|$)'`,
      sql`${documents.url} ~* '^https://([a-z0-9-]+\\.)*(diputadosrd\\.gob\\.do|camaradediputados\\.gob\\.do)(:[0-9]+)?/ReportesGenerales/VerDocumento\\?[^#]*documentoId=[0-9]+(?:[&#]|$)'`,
    )!,
  ];
  if (opts.documentId !== undefined) conditions.push(eq(documents.id, opts.documentId));
  if (opts.initiativeId !== undefined) {
    conditions.push(eq(documents.initiativeId, opts.initiativeId));
  }
  if (opts.beforeDocumentId !== undefined) {
    conditions.push(sql`${documents.id} < ${opts.beforeDocumentId}`);
  }
  if (opts.atOrBeforeDocumentId !== undefined) {
    conditions.push(sql`${documents.id} <= ${opts.atOrBeforeDocumentId}`);
  }
  if (opts.unverifiedOnly) conditions.push(sql`not (${currentDocumentPdfAvailable()})`);
  if (opts.verificationDueOnly) conditions.push(currentDocumentPdfVerificationDue());
  const rows = await db
    .select({
      documentId: documents.id,
      source: documents.source,
      sourceDocId: documents.sourceDocId,
      url: documents.url,
      initiativeId: initiatives.id,
      docType: documents.docType,
      uploadedAt: documents.uploadedAt,
      modifiedAt: documents.modifiedAt,
    })
    .from(documents)
    .innerJoin(initiatives, eq(initiatives.id, documents.initiativeId))
    .where(and(...conditions))
    .orderBy(sql`${documents.id} desc`)
    .limit(limit);
  return rows.flatMap((row): OfficialDocumentVerificationCandidate[] => {
    if (typeof row.url !== "string") return [];
    const canonicalUrl = officialDepositedBillPdfUrl(row);
    if (!canonicalUrl) return [];
    return [
      {
        documentId: row.documentId,
        source: row.source,
        sourceDocId: row.sourceDocId,
        url: canonicalUrl,
        initiativeId: row.initiativeId,
        sourceSnapshot: {
          initiativeId: row.initiativeId,
          source: row.source,
          sourceDocId: row.sourceDocId,
          url: row.url,
          docType: row.docType,
          uploadedAt: row.uploadedAt,
          modifiedAt: row.modifiedAt,
        },
      },
    ];
  });
}

export interface StoreDocumentContentInput {
  documentId: number;
  contentHash: string;
  contentText: string;
  mimeType: string;
  byteSize: number;
  pageCount: number;
  characterCount: number;
  sourceSnapshot: DocumentSourceSnapshot;
}

export type PreparedDocumentContent = Omit<
  StoreDocumentContentInput,
  "documentId" | "sourceSnapshot"
>;

export interface StoreDocumentPdfVerificationInput {
  documentId: number;
  sourceSnapshot: DocumentSourceSnapshot;
  reachable: boolean;
  httpStatus: number | null;
  mimeType: string | null;
  byteSize: number | null;
  finalUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

/** Successful byte-level result before it is associated with a database document. */
export type PreparedDocumentPdfVerification = Omit<
  StoreDocumentPdfVerificationInput,
  "documentId" | "sourceSnapshot" | "reachable" | "errorCode" | "errorMessage"
> & {
  httpStatus: 200 | 206;
  mimeType: "application/pdf" | "application/octet-stream";
  /** Exact total size only when observed reliably; null for a prefix-only probe. */
  byteSize: number | null;
  finalUrl: string;
};

type RepositoryTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function sameDocumentSourceSnapshot(
  left: DocumentSourceSnapshot,
  right: DocumentSourceSnapshot,
): boolean {
  return (
    left.initiativeId === right.initiativeId &&
    left.source === right.source &&
    left.sourceDocId === right.sourceDocId &&
    left.url === right.url &&
    left.docType === right.docType &&
    left.uploadedAt === right.uploadedAt &&
    left.modifiedAt === right.modifiedAt
  );
}

function validateDocumentPdfVerificationInput(input: StoreDocumentPdfVerificationInput): void {
  if (!Number.isSafeInteger(input.documentId) || input.documentId <= 0) {
    throw new Error("documentId must be a positive integer");
  }
  if (!input.sourceSnapshot.source.trim()) throw new Error("sourceSnapshot.source is required");
  if (input.reachable) {
    if (input.httpStatus !== 200 && input.httpStatus !== 206) {
      throw new Error("reachable PDF verification requires HTTP 200 or 206");
    }
    if (input.mimeType !== "application/pdf" && input.mimeType !== "application/octet-stream") {
      throw new Error("reachable PDF verification requires an allowed PDF MIME type");
    }
    if (input.byteSize !== null && (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0)) {
      throw new Error("reachable PDF verification byteSize must be null or positive");
    }
    if (!input.finalUrl?.trim()) {
      throw new Error("reachable PDF verification requires a finalUrl");
    }
    if (input.errorCode !== null || input.errorMessage !== null) {
      throw new Error("reachable PDF verification cannot contain an error");
    }
    return;
  }
  if (
    input.httpStatus !== null ||
    input.mimeType !== null ||
    input.byteSize !== null ||
    input.finalUrl !== null
  ) {
    throw new Error("unreachable PDF verification cannot contain positive response facts");
  }
  if (!input.errorCode?.trim() || !input.errorMessage?.trim()) {
    throw new Error("unreachable PDF verification requires an error code and message");
  }
}

function validateDocumentContentInput(input: StoreDocumentContentInput): void {
  if (!Number.isSafeInteger(input.documentId) || input.documentId <= 0) {
    throw new Error("documentId must be a positive integer");
  }
  if (!/^[a-f0-9]{64}$/.test(input.contentHash)) {
    throw new Error("contentHash must be a lowercase SHA-256 digest");
  }
  if (!input.contentText.trim()) throw new Error("contentText cannot be empty");
  if (
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize <= 0 ||
    !Number.isSafeInteger(input.pageCount) ||
    input.pageCount <= 0 ||
    !Number.isSafeInteger(input.characterCount) ||
    input.characterCount !== input.contentText.length
  ) {
    throw new Error("document content sizes are invalid");
  }
  if (!input.sourceSnapshot.source.trim()) throw new Error("sourceSnapshot.source is required");
}

async function lockCurrentDocumentSnapshot(
  tx: RepositoryTransaction,
  documentId: number,
  sourceSnapshot: DocumentSourceSnapshot,
): Promise<void> {
  const [current] = await tx
    .select({
      initiativeId: documents.initiativeId,
      source: documents.source,
      sourceDocId: documents.sourceDocId,
      url: documents.url,
      docType: documents.docType,
      uploadedAt: documents.uploadedAt,
      modifiedAt: documents.modifiedAt,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1)
    .for("update");
  if (!current) throw new Error("document no longer exists");
  if (!sameDocumentSourceSnapshot(current, sourceSnapshot)) {
    throw new Error("document metadata changed while the official PDF was being verified");
  }
}

async function storeDocumentPdfVerificationInTransaction(
  tx: RepositoryTransaction,
  input: StoreDocumentPdfVerificationInput,
  checkedAt = new Date(),
): Promise<{ id: number; inserted: boolean; applied: boolean }> {
  validateDocumentPdfVerificationInput(input);
  if (!(checkedAt instanceof Date) || !Number.isFinite(checkedAt.getTime())) {
    throw new Error("checkedAt must be a valid Date");
  }
  const values = { ...input, verifiedAt: checkedAt };
  const inserted = await tx
    .insert(documentPdfVerifications)
    .values(values)
    .onConflictDoNothing()
    .returning({ id: documentPdfVerifications.id });
  if (inserted[0]) return { id: inserted[0].id, inserted: true, applied: true };

  const [existing] = await tx
    .update(documentPdfVerifications)
    .set({
      reachable: input.reachable,
      httpStatus: input.httpStatus,
      mimeType: input.mimeType,
      byteSize: input.byteSize,
      finalUrl: input.finalUrl,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      verifiedAt: checkedAt,
    })
    .where(
      and(
        eq(documentPdfVerifications.documentId, input.documentId),
        sql`${documentPdfVerifications.sourceSnapshot} = ${JSON.stringify(input.sourceSnapshot)}::jsonb`,
        sql`${documentPdfVerifications.verifiedAt} <= ${checkedAt}::timestamp`,
      ),
    )
    .returning({ id: documentPdfVerifications.id });
  if (existing) return { id: existing.id, inserted: false, applied: true };
  const [newer] = await tx
    .select({ id: documentPdfVerifications.id })
    .from(documentPdfVerifications)
    .where(
      and(
        eq(documentPdfVerifications.documentId, input.documentId),
        sql`${documentPdfVerifications.sourceSnapshot} = ${JSON.stringify(input.sourceSnapshot)}::jsonb`,
      ),
    )
    .limit(1);
  if (!newer) throw new Error("document PDF verification conflict did not return a row");
  return { id: newer.id, inserted: false, applied: false };
}

/**
 * Fetch first, then persist the independent binary reachability outcome after an
 * exact-snapshot row-lock recheck. A network/host/MIME/magic failure is committed as
 * negative evidence before the original error is rethrown; optional extraction is
 * deliberately outside this API.
 */
export async function verifyAndStoreDocumentPdfReachability<
  T extends PreparedDocumentPdfVerification,
>(
  db: Database,
  input: {
    documentId: number;
    sourceSnapshot: DocumentSourceSnapshot;
    verify: () => Promise<T>;
    /** False preserves prior evidence for an operational/transient probe failure. */
    persistFailure?: (cause: unknown) => boolean;
  },
): Promise<{
  prepared: T;
  verification: { id: number; inserted: boolean; applied: boolean };
}> {
  if (!Number.isSafeInteger(input.documentId) || input.documentId <= 0) {
    throw new Error("documentId must be a positive integer");
  }
  if (!input.sourceSnapshot.source.trim()) throw new Error("sourceSnapshot.source is required");

  // Fetch first. Holding a database transaction/row lock across a slow network request
  // would serialize unrelated work and exhaust production connection pools.
  const attemptStartedAt = new Date();
  let observed:
    | { ok: true; prepared: T; storage: StoreDocumentPdfVerificationInput }
    | { ok: false; cause: unknown; storage: StoreDocumentPdfVerificationInput };
  try {
    const prepared = await input.verify();
    const storage: StoreDocumentPdfVerificationInput = {
      documentId: input.documentId,
      sourceSnapshot: input.sourceSnapshot,
      reachable: true,
      httpStatus: prepared.httpStatus,
      mimeType: prepared.mimeType,
      byteSize: prepared.byteSize,
      finalUrl: prepared.finalUrl,
      errorCode: null,
      errorMessage: null,
    };
    validateDocumentPdfVerificationInput(storage);
    observed = { ok: true, prepared, storage };
  } catch (cause) {
    const errorCode =
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      typeof cause.code === "string" &&
      cause.code.trim()
        ? cause.code.trim().slice(0, 100)
        : "PDF_REACHABILITY_FAILED";
    const errorMessage = (cause instanceof Error ? cause.message : String(cause))
      .trim()
      .slice(0, 2_000);
    observed = {
      ok: false,
      cause,
      storage: {
        documentId: input.documentId,
        sourceSnapshot: input.sourceSnapshot,
        reachable: false,
        httpStatus: null,
        mimeType: null,
        byteSize: null,
        finalUrl: null,
        errorCode,
        errorMessage: errorMessage || "Falló la verificación binaria del PDF.",
      },
    };
  }

  if (!observed.ok && input.persistFailure && !input.persistFailure(observed.cause)) {
    throw observed.cause;
  }

  const outcome = await db.transaction(async (tx) => {
    // Revalidation after the fetch is the TOCTOU guard: a changed snapshot can never
    // receive evidence collected for its predecessor.
    await lockCurrentDocumentSnapshot(tx, input.documentId, input.sourceSnapshot);
    if (observed.ok) {
      const verification = await storeDocumentPdfVerificationInTransaction(
        tx,
        {
          ...observed.storage,
        },
        attemptStartedAt,
      );
      return { ok: true as const, prepared: observed.prepared, verification };
    }
    try {
      await storeDocumentPdfVerificationInTransaction(tx, observed.storage, attemptStartedAt);
    } catch (persistenceError) {
      const errorMessage =
        observed.cause instanceof Error ? observed.cause.message : String(observed.cause);
      const persistenceMessage =
        persistenceError instanceof Error ? persistenceError.message : String(persistenceError);
      throw new Error(
        `Falló la verificación (${errorMessage}) y también su persistencia fail-closed (${persistenceMessage}).`,
      );
    }
    return { ok: false as const, cause: observed.cause };
  });
  if (!outcome.ok) throw outcome.cause;
  return { prepared: outcome.prepared, verification: outcome.verification };
}

/** Low-level store for a binary outcome that has already been verified by a trusted caller. */
export async function storeDocumentPdfVerification(
  db: Database,
  input: StoreDocumentPdfVerificationInput,
): Promise<{ id: number; inserted: boolean }> {
  validateDocumentPdfVerificationInput(input);
  return db.transaction(async (tx) => {
    await lockCurrentDocumentSnapshot(tx, input.documentId, input.sourceSnapshot);
    const stored = await storeDocumentPdfVerificationInTransaction(tx, input);
    return { id: stored.id, inserted: stored.inserted };
  });
}

async function storeDocumentContentInTransaction(
  tx: RepositoryTransaction,
  input: StoreDocumentContentInput,
): Promise<{ id: number; inserted: boolean }> {
  // A successful byte check becomes newer than every prior version of the same
  // document. Callers that fetched bytes must hold the document row lock from before
  // the fetch; see verifyAndStoreDocumentContent below.
  const verificationTimestamp = sql`greatest(
    now(),
    coalesce(
      (
        select max(existing_content.last_verified_at) + interval '1 millisecond'
        from document_contents existing_content
        where existing_content.document_id = ${input.documentId}
      ),
      now()
    )
  )`;
  const value = { ...input, lastVerifiedAt: verificationTimestamp };
  const inserted = await tx
    .insert(documentContents)
    .values(value)
    .onConflictDoNothing()
    .returning({ id: documentContents.id });
  if (inserted[0]) return { id: inserted[0].id, inserted: true };

  const [existing] = await tx
    .update(documentContents)
    .set({
      lastVerifiedAt: verificationTimestamp,
    })
    .where(
      and(
        eq(documentContents.documentId, input.documentId),
        eq(documentContents.contentHash, input.contentHash),
        sql`${documentContents.sourceSnapshot} = ${JSON.stringify(input.sourceSnapshot)}::jsonb`,
      ),
    )
    .returning({ id: documentContents.id });
  if (!existing) throw new Error("document content conflict did not return an existing row");
  return { id: existing.id, inserted: false };
}

/**
 * Serialize a complete official-byte verification for one document.
 *
 * The row lock is acquired and the immutable source snapshot is revalidated before
 * `prepare` can issue its first request. It remains held through download, parsing, and
 * persistence, so an older request cannot finish after a newer one and promote stale
 * bytes back to current. This intentionally keeps one transaction open for the bounded
 * PDF timeout; verification is rare and correctness takes precedence for one document.
 * PostgreSQL and PGlite both implement this standard `SELECT ... FOR UPDATE` contract.
 */
export async function verifyAndStoreDocumentContent<T extends PreparedDocumentContent>(
  db: Database,
  input: {
    documentId: number;
    sourceSnapshot: DocumentSourceSnapshot;
    prepare: () => Promise<T>;
    /** Remove prior availability atomically when this fresh byte check fails. */
    expireOnFailure?: boolean;
  },
): Promise<{ prepared: T; content: { id: number; inserted: boolean } }> {
  if (!Number.isSafeInteger(input.documentId) || input.documentId <= 0) {
    throw new Error("documentId must be a positive integer");
  }
  if (!input.sourceSnapshot.source.trim()) throw new Error("sourceSnapshot.source is required");

  const outcome = await db.transaction(async (tx) => {
    await lockCurrentDocumentSnapshot(tx, input.documentId, input.sourceSnapshot);
    try {
      const prepared = await input.prepare();
      const contentInput: StoreDocumentContentInput = {
        documentId: input.documentId,
        sourceSnapshot: input.sourceSnapshot,
        contentHash: prepared.contentHash,
        contentText: prepared.contentText,
        mimeType: prepared.mimeType,
        byteSize: prepared.byteSize,
        pageCount: prepared.pageCount,
        characterCount: prepared.characterCount,
      };
      validateDocumentContentInput(contentInput);
      const content = await storeDocumentContentInTransaction(tx, contentInput);
      return { ok: true as const, prepared, content };
    } catch (cause) {
      if (!input.expireOnFailure) throw cause;
      try {
        await tx
          .update(documentContents)
          .set({
            lastVerifiedAt: sql`least(
              ${documentContents.lastVerifiedAt},
              now() - interval '25 hours'
            )`,
          })
          .where(eq(documentContents.documentId, input.documentId));
      } catch (expirationError) {
        const verificationMessage = cause instanceof Error ? cause.message : String(cause);
        const expirationMessage =
          expirationError instanceof Error ? expirationError.message : String(expirationError);
        throw new Error(
          `Falló la verificación (${verificationMessage}) y también su expiración fail-closed (${expirationMessage}).`,
        );
      }
      return { ok: false as const, cause };
    }
  });
  if (!outcome.ok) throw outcome.cause;
  return { prepared: outcome.prepared, content: outcome.content };
}

/**
 * Low-level append-safe store for already-prepared content.
 *
 * A production fetch must use `verifyAndStoreDocumentContent`, because acquiring this
 * function's lock only after a download cannot preserve verification start order.
 */
export async function storeDocumentContent(
  db: Database,
  input: StoreDocumentContentInput,
): Promise<{ id: number; inserted: boolean }> {
  validateDocumentContentInput(input);

  return db.transaction(async (tx) => {
    await lockCurrentDocumentSnapshot(tx, input.documentId, input.sourceSnapshot);
    return storeDocumentContentInTransaction(tx, input);
  });
}

export interface ExpireDocumentContentVerificationInput {
  contentId: number;
  contentHash: string;
  sourceSnapshot: DocumentSourceSnapshot;
  expectedLastVerifiedAt: Date;
}

/**
 * Fail closed after a byte-reverification error without invalidating a concurrent
 * successful refresh. All older versions of the same document expire together so
 * changing the target's ordering timestamp cannot accidentally restore stale PDF
 * availability. PostgreSQL timestamps can carry sub-millisecond precision that
 * is lost when read into a JavaScript Date, so the optimistic target comparison uses
 * that Date's exact millisecond window. `storeDocumentContent` advances successful
 * checks beyond every existing version, keeping concurrent successes outside it.
 */
export async function expireDocumentContentVerification(
  db: Database,
  input: ExpireDocumentContentVerificationInput,
): Promise<boolean> {
  if (!Number.isSafeInteger(input.contentId) || input.contentId <= 0) {
    throw new Error("contentId must be a positive integer");
  }
  if (!/^[a-f0-9]{64}$/.test(input.contentHash)) {
    throw new Error("contentHash must be a lowercase SHA-256 digest");
  }
  if (
    !(input.expectedLastVerifiedAt instanceof Date) ||
    !Number.isFinite(input.expectedLastVerifiedAt.getTime())
  ) {
    throw new Error("expectedLastVerifiedAt must be a valid Date");
  }

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ documentId: documentContents.documentId })
      .from(documentContents)
      .where(
        and(
          eq(documentContents.id, input.contentId),
          eq(documentContents.contentHash, input.contentHash),
          sql`${documentContents.sourceSnapshot} = ${JSON.stringify(input.sourceSnapshot)}::jsonb`,
          sql`${documentContents.lastVerifiedAt} >= ${input.expectedLastVerifiedAt}::timestamp`,
          sql`${documentContents.lastVerifiedAt} < ${input.expectedLastVerifiedAt}::timestamp + interval '1 millisecond'`,
        ),
      )
      .limit(1)
      .for("update");
    if (!target) return false;

    const expired = await tx
      .update(documentContents)
      .set({
        lastVerifiedAt: sql`least(
          ${documentContents.lastVerifiedAt},
          now() - interval '25 hours'
        )`,
      })
      .where(
        and(
          eq(documentContents.documentId, target.documentId),
          sql`${documentContents.lastVerifiedAt} < ${input.expectedLastVerifiedAt}::timestamp + interval '1 millisecond'`,
        ),
      )
      .returning({ id: documentContents.id });
    return expired.some((row) => row.id === input.contentId);
  });
}

function checkpointInteger(
  details: Record<string, unknown>,
  field: string,
  opts: { nullable?: boolean; positive?: boolean } = {},
): number | null {
  const value = details[field];
  if (opts.nullable && value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < (opts.positive ? 1 : 0)
  ) {
    throw new Error(`Checkpoint de verificación corrupto: ${field}`);
  }
  return value;
}

export const DOCUMENT_PDF_VERIFICATION_RUN_SOURCE = "document-pdf-byte-verification";
const DOCUMENT_PDF_VERIFICATION_CYCLE_KIND = "DOCUMENT_PDF_BYTE_VERIFICATION";
const DOCUMENT_PDF_VERIFICATION_CHECKPOINT_VERSION = 3;

export interface DocumentPdfVerificationFailureSample {
  documentId: number;
  error: string;
}

export interface DocumentPdfVerificationCycle {
  runId: number;
  startedAt: Date;
  /** UTC epoch persisted in JSON; unlike started_at it has no driver/timezone ambiguity. */
  cycleStartedAtMs: number;
  /** Inclusive high-water mark fixed when the cycle begins. */
  cycleMaxDocumentId: number | null;
  /** Exclusive descending cursor: the next page must contain only smaller ids. */
  beforeDocumentId: number | null;
  inspected: number;
  verified: number;
  newVersions: number;
  refreshed: number;
  /** Reachable PDFs whose optional text extraction failed. */
  extractionFailed: number;
  failed: number;
  operationalFailures: number;
  definitiveUnavailable: number;
  failureSamples: DocumentPdfVerificationFailureSample[];
  extractionFailureSamples: DocumentPdfVerificationFailureSample[];
}

export interface StartedDocumentPdfVerificationCycle extends DocumentPdfVerificationCycle {
  resumed: boolean;
}

type StoredDocumentPdfVerificationCycle = Omit<DocumentPdfVerificationCycle, "runId" | "startedAt">;

function documentPdfVerificationCycleDetails(
  state: StoredDocumentPdfVerificationCycle,
  outcome: "RUNNING" | "COMPLETE" | "PARTIAL" = "RUNNING",
): Record<string, unknown> {
  return {
    kind: DOCUMENT_PDF_VERIFICATION_CYCLE_KIND,
    checkpointVersion: DOCUMENT_PDF_VERIFICATION_CHECKPOINT_VERSION,
    lifecycle: "CHECKPOINTED_CYCLE",
    outcome,
    ...state,
  };
}

function parseDocumentPdfVerificationCycle(row: {
  id: number;
  startedAt: Date;
  details: unknown;
}): DocumentPdfVerificationCycle {
  if (!row.details || typeof row.details !== "object" || Array.isArray(row.details)) {
    throw new Error(`Checkpoint de PDF ${row.id} sin detalles válidos`);
  }
  const details = row.details as Record<string, unknown>;
  if (
    details.kind !== DOCUMENT_PDF_VERIFICATION_CYCLE_KIND ||
    (details.checkpointVersion !== 1 &&
      details.checkpointVersion !== 2 &&
      details.checkpointVersion !== DOCUMENT_PDF_VERIFICATION_CHECKPOINT_VERSION) ||
    details.lifecycle !== "CHECKPOINTED_CYCLE" ||
    details.outcome !== "RUNNING"
  ) {
    throw new Error(`Checkpoint de PDF ${row.id} incompatible`);
  }
  const cycleMaxDocumentId = checkpointInteger(details, "cycleMaxDocumentId", {
    nullable: true,
    positive: true,
  });
  const beforeDocumentId = checkpointInteger(details, "beforeDocumentId", {
    nullable: true,
    positive: true,
  });
  const cycleStartedAtMs = checkpointInteger(details, "cycleStartedAtMs", {
    positive: true,
  })!;
  const inspected = checkpointInteger(details, "inspected")!;
  const verified = checkpointInteger(details, "verified")!;
  const newVersions = checkpointInteger(details, "newVersions")!;
  const refreshed = checkpointInteger(details, "refreshed")!;
  const extractionFailed =
    details.checkpointVersion === 1 ? 0 : checkpointInteger(details, "extractionFailed")!;
  const failed = checkpointInteger(details, "failed")!;
  const operationalFailures =
    details.checkpointVersion === 3 ? checkpointInteger(details, "operationalFailures")! : failed;
  const definitiveUnavailable =
    details.checkpointVersion === 3 ? checkpointInteger(details, "definitiveUnavailable")! : 0;
  if (
    newVersions + refreshed + extractionFailed !== verified ||
    verified + failed !== inspected ||
    operationalFailures + definitiveUnavailable !== failed
  ) {
    throw new Error(`Checkpoint de PDF ${row.id} con contadores inconsistentes`);
  }
  if (
    (cycleMaxDocumentId === null && (beforeDocumentId !== null || inspected !== 0)) ||
    (cycleMaxDocumentId !== null &&
      beforeDocumentId !== null &&
      beforeDocumentId > cycleMaxDocumentId)
  ) {
    throw new Error(`Checkpoint de PDF ${row.id} con cursor inválido`);
  }
  if (!Array.isArray(details.failureSamples)) {
    throw new Error(`Checkpoint de PDF ${row.id} sin muestras de fallo`);
  }
  const failureSamples = details.failureSamples.map((sample) => {
    if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
      throw new Error(`Checkpoint de PDF ${row.id} con muestra de fallo inválida`);
    }
    const value = sample as Record<string, unknown>;
    if (
      typeof value.documentId !== "number" ||
      !Number.isSafeInteger(value.documentId) ||
      value.documentId < 1 ||
      typeof value.error !== "string"
    ) {
      throw new Error(`Checkpoint de PDF ${row.id} con muestra de fallo inválida`);
    }
    return { documentId: value.documentId, error: value.error };
  });
  const rawExtractionSamples =
    details.checkpointVersion === 1 ? [] : details.extractionFailureSamples;
  if (!Array.isArray(rawExtractionSamples)) {
    throw new Error(`Checkpoint de PDF ${row.id} sin muestras de fallo de extracción`);
  }
  const extractionFailureSamples = rawExtractionSamples.map((sample) => {
    if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
      throw new Error(`Checkpoint de PDF ${row.id} con muestra de extracción inválida`);
    }
    const value = sample as Record<string, unknown>;
    if (
      typeof value.documentId !== "number" ||
      !Number.isSafeInteger(value.documentId) ||
      value.documentId < 1 ||
      typeof value.error !== "string"
    ) {
      throw new Error(`Checkpoint de PDF ${row.id} con muestra de extracción inválida`);
    }
    return { documentId: value.documentId, error: value.error };
  });
  return {
    runId: row.id,
    startedAt: row.startedAt,
    cycleStartedAtMs,
    cycleMaxDocumentId,
    beforeDocumentId,
    inspected,
    verified,
    newVersions,
    refreshed,
    extractionFailed,
    failed,
    operationalFailures,
    definitiveUnavailable,
    failureSamples,
    extractionFailureSamples,
  };
}

/** Start one fixed high-water PDF cycle, or resume its sole unfinished checkpoint. */
export async function beginOrResumeDocumentPdfVerificationCycle(
  db: Database,
): Promise<StartedDocumentPdfVerificationCycle> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${DOCUMENT_PDF_VERIFICATION_RUN_SOURCE}))`,
    );
    const unfinished = await tx
      .select({
        id: ingestionRuns.id,
        startedAt: ingestionRuns.startedAt,
        details: ingestionRuns.details,
      })
      .from(ingestionRuns)
      .where(
        and(
          eq(ingestionRuns.source, DOCUMENT_PDF_VERIFICATION_RUN_SOURCE),
          isNull(ingestionRuns.finishedAt),
        ),
      )
      .orderBy(sql`${ingestionRuns.id} desc`)
      .limit(2);
    if (unfinished.length > 1) {
      throw new Error("Hay más de un ciclo de verificación de PDF sin terminar");
    }
    if (unfinished[0]) {
      return { ...parseDocumentPdfVerificationCycle(unfinished[0]), resumed: true };
    }

    const [newest] = await listOfficialDepositedDocumentsForVerification(
      tx as unknown as Database,
      {
        limit: 1,
        verificationDueOnly: true,
      },
    );
    const state: StoredDocumentPdfVerificationCycle = {
      cycleStartedAtMs: Date.now(),
      cycleMaxDocumentId: newest?.documentId ?? null,
      beforeDocumentId: null,
      inspected: 0,
      verified: 0,
      newVersions: 0,
      refreshed: 0,
      extractionFailed: 0,
      failed: 0,
      operationalFailures: 0,
      definitiveUnavailable: 0,
      failureSamples: [],
      extractionFailureSamples: [],
    };
    const [created] = await tx
      .insert(ingestionRuns)
      .values({
        source: DOCUMENT_PDF_VERIFICATION_RUN_SOURCE,
        details: documentPdfVerificationCycleDetails(state),
      })
      .returning({ id: ingestionRuns.id, startedAt: ingestionRuns.startedAt });
    if (!created) throw new Error("No se pudo crear el ciclo de verificación de PDF");
    return { runId: created.id, startedAt: created.startedAt, ...state, resumed: false };
  });
}

/** Persist one handled document and advance the exclusive cursor monotonically. */
export async function checkpointDocumentPdfVerificationCycle(
  db: Database,
  input: {
    runId: number;
    expectedBeforeDocumentId: number | null;
    nextBeforeDocumentId: number;
    result:
      | "new-version"
      | "refreshed"
      | "extraction-failed"
      | "operational-failed"
      | "unavailable"
      | "failed";
    error?: string;
  },
): Promise<DocumentPdfVerificationCycle> {
  const [row] = await db
    .select({
      id: ingestionRuns.id,
      startedAt: ingestionRuns.startedAt,
      details: ingestionRuns.details,
    })
    .from(ingestionRuns)
    .where(
      and(
        eq(ingestionRuns.id, input.runId),
        eq(ingestionRuns.source, DOCUMENT_PDF_VERIFICATION_RUN_SOURCE),
        isNull(ingestionRuns.finishedAt),
      ),
    )
    .limit(1);
  if (!row) throw new Error(`Ciclo de verificación de PDF ${input.runId} no está abierto`);
  const current = parseDocumentPdfVerificationCycle(row);
  if (current.beforeDocumentId !== input.expectedBeforeDocumentId) {
    throw new Error(`Checkpoint de PDF ${input.runId} fue actualizado por otro proceso`);
  }
  if (current.cycleMaxDocumentId === null) {
    throw new Error(`Ciclo de verificación de PDF ${input.runId} no contiene documentos`);
  }
  const upperExclusive = current.beforeDocumentId ?? current.cycleMaxDocumentId + 1;
  if (
    !Number.isSafeInteger(input.nextBeforeDocumentId) ||
    input.nextBeforeDocumentId < 1 ||
    input.nextBeforeDocumentId >= upperExclusive
  ) {
    throw new Error(`Cursor no monotónico para el ciclo de PDF ${input.runId}`);
  }
  const reachabilityFailure =
    input.result === "failed" ||
    input.result === "operational-failed" ||
    input.result === "unavailable";
  if (reachabilityFailure && !input.error?.trim()) {
    throw new Error("Un checkpoint de PDF fallido requiere el error observado");
  }
  if (input.result === "extraction-failed" && !input.error?.trim()) {
    throw new Error("Un checkpoint de extracción fallida requiere el error observado");
  }

  const nextState: StoredDocumentPdfVerificationCycle = {
    cycleStartedAtMs: current.cycleStartedAtMs,
    cycleMaxDocumentId: current.cycleMaxDocumentId,
    beforeDocumentId: input.nextBeforeDocumentId,
    inspected: current.inspected + 1,
    verified: current.verified + (reachabilityFailure ? 0 : 1),
    newVersions: current.newVersions + (input.result === "new-version" ? 1 : 0),
    refreshed: current.refreshed + (input.result === "refreshed" ? 1 : 0),
    extractionFailed: current.extractionFailed + (input.result === "extraction-failed" ? 1 : 0),
    failed: current.failed + (reachabilityFailure ? 1 : 0),
    operationalFailures:
      current.operationalFailures + (input.result === "operational-failed" ? 1 : 0),
    definitiveUnavailable:
      current.definitiveUnavailable +
      (input.result === "unavailable" || input.result === "failed" ? 1 : 0),
    failureSamples: reachabilityFailure
      ? [
          ...current.failureSamples,
          {
            documentId: input.nextBeforeDocumentId,
            error: input.error!.trim().slice(0, 500),
          },
        ].slice(-20)
      : current.failureSamples,
    extractionFailureSamples:
      input.result === "extraction-failed"
        ? [
            ...current.extractionFailureSamples,
            {
              documentId: input.nextBeforeDocumentId,
              error: input.error!.trim().slice(0, 500),
            },
          ].slice(-20)
        : current.extractionFailureSamples,
  };
  const cursorMatches =
    input.expectedBeforeDocumentId === null
      ? sql`${ingestionRuns.details} ->> 'beforeDocumentId' is null`
      : sql`${ingestionRuns.details} ->> 'beforeDocumentId' = ${String(input.expectedBeforeDocumentId)}`;
  const updated = await db
    .update(ingestionRuns)
    .set({
      seen: nextState.inspected,
      inserted: nextState.newVersions,
      updated: nextState.refreshed,
      details: documentPdfVerificationCycleDetails(nextState),
    })
    .where(
      and(
        eq(ingestionRuns.id, input.runId),
        eq(ingestionRuns.source, DOCUMENT_PDF_VERIFICATION_RUN_SOURCE),
        isNull(ingestionRuns.finishedAt),
        cursorMatches,
      ),
    )
    .returning({ id: ingestionRuns.id });
  if (updated.length !== 1) {
    throw new Error(`Checkpoint de PDF ${input.runId} perdió una carrera de escritura`);
  }
  return { runId: current.runId, startedAt: current.startedAt, ...nextState };
}

/** Close one exhausted cycle; failures remain unavailable and visible in run health. */
export async function finishDocumentPdfVerificationCycle(
  db: Database,
  runId: number,
): Promise<DocumentPdfVerificationCycle> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${DOCUMENT_PDF_VERIFICATION_RUN_SOURCE}))`,
    );
    const [row] = await tx
      .select({
        id: ingestionRuns.id,
        startedAt: ingestionRuns.startedAt,
        details: ingestionRuns.details,
      })
      .from(ingestionRuns)
      .where(
        and(
          eq(ingestionRuns.id, runId),
          eq(ingestionRuns.source, DOCUMENT_PDF_VERIFICATION_RUN_SOURCE),
          isNull(ingestionRuns.finishedAt),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) throw new Error(`Ciclo de verificación de PDF ${runId} no está abierto`);
    const state = parseDocumentPdfVerificationCycle(row);
    if (state.cycleMaxDocumentId !== null) {
      const pending = await listOfficialDepositedDocumentsForVerification(
        tx as unknown as Database,
        {
          limit: 1,
          beforeDocumentId: state.beforeDocumentId ?? undefined,
          atOrBeforeDocumentId: state.cycleMaxDocumentId,
          verificationDueOnly: true,
        },
      );
      if (pending.length) {
        throw new Error(
          `Ciclo de verificación de PDF ${runId} aún tiene el documento ${pending[0]!.documentId} pendiente`,
        );
      }
    }

    const ok = state.failed === 0;
    const storedState: StoredDocumentPdfVerificationCycle = {
      cycleStartedAtMs: state.cycleStartedAtMs,
      cycleMaxDocumentId: state.cycleMaxDocumentId,
      beforeDocumentId: state.beforeDocumentId,
      inspected: state.inspected,
      verified: state.verified,
      newVersions: state.newVersions,
      refreshed: state.refreshed,
      extractionFailed: state.extractionFailed,
      failed: state.failed,
      operationalFailures: state.operationalFailures,
      definitiveUnavailable: state.definitiveUnavailable,
      failureSamples: state.failureSamples,
      extractionFailureSamples: state.extractionFailureSamples,
    };
    const updated = await tx
      .update(ingestionRuns)
      .set({
        finishedAt: sql`now()`,
        ok,
        error: ok
          ? null
          : `${state.operationalFailures} fallos operacionales y ` +
            `${state.definitiveUnavailable} PDF no disponibles`,
        details: documentPdfVerificationCycleDetails(storedState, ok ? "COMPLETE" : "PARTIAL"),
      })
      .where(
        and(
          eq(ingestionRuns.id, runId),
          eq(ingestionRuns.source, DOCUMENT_PDF_VERIFICATION_RUN_SOURCE),
          isNull(ingestionRuns.finishedAt),
        ),
      )
      .returning({ id: ingestionRuns.id });
    if (updated.length !== 1) {
      throw new Error(`Ciclo de verificación de PDF ${runId} ya terminó`);
    }
    return state;
  });
}

/** Current, safe drafts awaiting an explicit human content review. */
export interface SourceDocumentListItem {
  id: number;
  source: string;
  sourceDocId: string | null;
  initiativeCode: string | null;
  docType: string | null;
  extension: string | null;
  url: string | null;
  uploadedAt: string | null;
  modifiedAt: string | null;
  sourceCategory: string | null;
  sourceFragment: string | null;
  raw: unknown;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** Official documents from named source collections, including unlinked documents. */
export async function listSourceDocuments(
  db: Database,
  opts: { sources: readonly string[]; limit?: number },
): Promise<SourceDocumentListItem[]> {
  if (opts.sources.length === 0) return [];
  const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
  return db
    .select({
      id: documents.id,
      source: documents.source,
      sourceDocId: documents.sourceDocId,
      initiativeCode: documents.initiativeCode,
      docType: documents.docType,
      extension: documents.extension,
      url: documents.url,
      uploadedAt: documents.uploadedAt,
      modifiedAt: documents.modifiedAt,
      sourceCategory: documents.sourceCategory,
      sourceFragment: documents.sourceFragment,
      raw: documents.raw,
      firstSeenAt: sql<string>`${documents.firstSeenAt}::text`,
      lastSeenAt: sql<string>`${documents.lastSeenAt}::text`,
    })
    .from(documents)
    .where(
      and(inArray(documents.source, [...opts.sources]), sql`${documents.initiativeId} is null`),
    )
    .orderBy(
      sql`${documents.uploadedAt} desc nulls last`,
      sql`${documents.firstSeenAt} desc`,
      sql`${documents.id} desc`,
    )
    .limit(limit);
}

export interface DepositItem {
  id: number;
  source: string;
  code: string | null;
  type: string | null;
  title: string; // SIL `descripcion` — the plain-language summary of the bill
  status: string | null;
  chamber: string | null;
  sourceId: string | null;
  sponsor: string | null;
  sponsorRole: string | null;
  /** Exact SIL legislator id published for the principal/first proponent, active or not. */
  sponsorLegislatorSourceId: string | null;
  /** Active elected-roster profile resolved only from roster-diputados + exact source id. */
  sponsorProfileId: number | null;
  sponsorCount: number | null;
  party: string | null;
  province: string | null;
  filedAt: string | null;
  sourceUrl: string | null; // SIL initiative page (where the document is published)
  docUploaded: boolean; // did the official catalog register document metadata?
  docAvailable: boolean; // were the exact current PDF bytes recently verified?
  docId: number | null; // server-owned identifier used by the guarded opener
  docUrl: string | null; // official view/download link, when available
  docSource: string | null; // adapter that supplied docUrl; used for source-domain validation
  docType: string | null;
}

/**
 * Initiatives DEPOSITED within a date range (the "deposited today" feed). Each row
 * carries its principal sponsor + whether its official document is uploaded yet, so the
 * daily card needs no extra lookups. Diputados only (the SIL corpus is Diputados).
 */
export async function listDeposits(
  db: Database,
  opts: { dateFrom: string; dateTo?: string; limit?: number; chamber?: string },
): Promise<DepositItem[]> {
  const { dateFrom, dateTo = opts.dateFrom, limit = 200, chamber = "DIPUTADOS" } = opts;
  const rows = await db
    .select({
      id: initiatives.id,
      source: initiatives.source,
      sourceId: initiatives.sourceId,
      code: initiatives.code,
      type: initiatives.type,
      title: initiatives.title,
      status: initiatives.status,
      chamber: initiatives.chamber,
      sponsor: initiatives.sponsor,
      sponsorRole: initiatives.sponsorRole,
      sponsorCount: initiatives.sponsorCount,
      party: initiatives.party,
      province: initiatives.province,
      filedAt: initiatives.filedAt,
      sourceUrl: initiatives.sourceUrl,
      raw: initiatives.raw,
    })
    .from(initiatives)
    .where(
      and(
        eq(initiatives.chamber, chamber),
        sql`${initiatives.filedAt} >= ${dateFrom}`,
        sql`${initiatives.filedAt} <= ${dateTo}`,
      ),
    )
    .orderBy(sql`${initiatives.filedAt} desc nulls last`, sql`${initiatives.id} desc`)
    .limit(limit);

  if (rows.length === 0) return [];

  // One follow-up query for the documents of all deposits, merged in memory.
  const ids = rows.map((r) => r.id);
  const docs = await db
    .select({
      id: documents.id,
      initiativeId: documents.initiativeId,
      source: documents.source,
      docType: documents.docType,
      url: documents.url,
      uploadedAt: documents.uploadedAt,
      pdfAvailable: currentDocumentPdfAvailable(),
    })
    .from(documents)
    .where(
      and(
        inArray(documents.initiativeId, ids),
        eq(documents.source, "sil-diputados"),
        isNotNull(documents.url),
        sql`lower(trim(coalesce(${documents.docType}, ''))) in ('proyecto depositado', 'p depositado')`,
        or(
          sql`${documents.url} ~* '\\.pdf(?:$|[?#])'`,
          sql`${documents.url} ~* '^https://([a-z0-9-]+\\.)*(diputadosrd\\.gob\\.do|camaradediputados\\.gob\\.do)(:[0-9]+)?/ReportesGenerales/VerDocumento\\?[^#]*documentoId=[0-9]+(?:[&#]|$)'`,
        ),
      ),
    )
    .orderBy(
      documents.initiativeId,
      sql`${documents.uploadedAt} desc nulls last`,
      sql`${documents.id} desc`,
    );

  const byInitiative = new Map<
    number,
    { id: number; source: string; docType: string | null; url: string; pdfAvailable: boolean }
  >();
  for (const d of docs) {
    if (d.initiativeId == null || byInitiative.has(d.initiativeId)) continue;
    const canonicalUrl = officialDepositedBillPdfUrl(d);
    if (!canonicalUrl) continue;
    byInitiative.set(d.initiativeId, {
      id: d.id,
      source: d.source,
      docType: d.docType,
      url: canonicalUrl,
      pdfAvailable: d.pdfAvailable,
    });
  }

  const identifiedRows = await attachInitiativeSponsorProfiles(db, rows);
  return identifiedRows.map((r): DepositItem => {
    const best = byInitiative.get(r.id) ?? null;
    return {
      ...r,
      docUploaded: best != null,
      docAvailable: best?.pdfAvailable ?? false,
      docId: best?.id ?? null,
      docUrl: best?.url ?? null,
      docSource: best?.source ?? null,
      docType: best?.docType ?? null,
    };
  });
}

/** Start a visible source run before network work; a crash/timeout leaves it pending. */
export async function beginIngestionRun(
  db: Database,
  source: string,
  details: Record<string, unknown> = {},
): Promise<number> {
  const [row] = await db
    .insert(ingestionRuns)
    .values({
      source,
      details: { ...details, outcome: "RUNNING", lifecycle: "EXPLICIT_BEGIN_FINISH" },
    })
    .returning({ id: ingestionRuns.id });
  return row!.id;
}

/** Finish a per-source ingestion run for the health panel. */
export async function recordIngestionRun(
  db: Database,
  run: {
    runId?: number;
    source: string;
    seen?: number;
    inserted?: number;
    updated?: number;
    statusChanges?: number;
    ok: boolean;
    outcome?: "COMPLETE" | "PARTIAL" | "FAILED";
    error?: string | null;
    details?: unknown;
  },
): Promise<void> {
  const outcome = run.outcome ?? (run.ok ? "COMPLETE" : "FAILED");
  const suppliedDetails =
    run.details && typeof run.details === "object" && !Array.isArray(run.details)
      ? (run.details as Record<string, unknown>)
      : run.details == null
        ? {}
        : { payload: run.details };
  const values = {
    source: run.source,
    finishedAt: sql`now()`,
    seen: run.seen ?? 0,
    inserted: run.inserted ?? 0,
    updated: run.updated ?? 0,
    statusChanges: run.statusChanges ?? 0,
    ok: run.ok,
    error: run.error ?? null,
    details: {
      ...suppliedDetails,
      outcome,
      lifecycle: run.runId === undefined ? "COMPLETION_ONLY" : "EXPLICIT_BEGIN_FINISH",
    },
  };
  if (run.runId !== undefined) {
    const updated = await db
      .update(ingestionRuns)
      .set(values)
      .where(and(eq(ingestionRuns.id, run.runId), eq(ingestionRuns.source, run.source)))
      .returning({ id: ingestionRuns.id });
    if (updated.length !== 1) {
      throw new Error(`Ingestion run ${run.runId} for ${run.source} does not exist`);
    }
    return;
  }
  await db.insert(ingestionRuns).values(values);
}

export interface SourceHealth {
  source: string;
  /** When this completed run row was recorded (legacy column name: started_at). */
  recordedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  outcome: "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED";
  seen: number;
  inserted: number;
  updated: number;
  statusChanges: number;
  error: string | null;
  details: unknown;
  /** Last time this source ran ok (so a transient failure doesn't hide freshness). */
  lastSuccessAt: string | null;
  /** Last completed observation that contained one or more source records. */
  lastDataAt: string | null;
  /** Historical median of successful runs; context only, never a health verdict. */
  baselineSeen: number | null;
}

/**
 * Health of every source for the "Estado de monitoreo" page: the latest run, the last
 * successful run, factual counters from the latest run, and a historical median for
 * context. This repository does not infer a health status from that baseline.
 */
export async function latestRunsBySource(db: Database): Promise<SourceHealth[]> {
  const rows = await db.execute(sql`
    with latest as (
      select distinct on (source)
        id, source, started_at as "recordedAt", finished_at as "finishedAt",
        ok,
        case
          when finished_at is null and ok is null then 'RUNNING'
          when details->>'outcome' in ('COMPLETE','PARTIAL','FAILED') then details->>'outcome'
          when ok then 'COMPLETE'
          else 'FAILED'
        end as outcome,
        seen, inserted, updated,
        status_changes as "statusChanges", error, details
      from ingestion_runs order by source, started_at desc
    ),
    success as (
      select distinct on (source) source, finished_at as "lastSuccessAt"
      from ingestion_runs where ok order by source, started_at desc
    ),
    last_data as (
      select distinct on (source) source, finished_at as "lastDataAt"
      from ingestion_runs where seen > 0 order by source, started_at desc
    ),
    baseline as (
      select r.source,
             percentile_cont(0.5) within group (order by r.seen)::int as "baselineSeen"
      from ingestion_runs r
      join latest l on l.source = r.source and l.id <> r.id
      where r.ok and r.seen > 0 group by r.source
    )
    select l.source, l."recordedAt", l."finishedAt", l.ok, l.outcome,
           l.seen, l.inserted, l.updated,
           l."statusChanges", l.error, l.details,
           s."lastSuccessAt", d."lastDataAt", b."baselineSeen"
    from latest l
    left join success s on s.source = l.source
    left join last_data d on d.source = l.source
    left join baseline b on b.source = l.source
    order by l.source
  `);
  return (rows as unknown as { rows: SourceHealth[] }).rows;
}

/** Most recent initiatives by the factual filing date reported by the source. */
export async function listRecentInitiatives(
  db: Database,
  opts: { limit?: number; dateFrom?: string; chamber?: string } = {},
): Promise<InitiativeListItem[]> {
  const { limit = 50, dateFrom, chamber } = opts;
  const conds = [];
  if (dateFrom) conds.push(sql`${initiatives.filedAt} >= ${dateFrom}`);
  if (chamber) conds.push(eq(initiatives.chamber, chamber));
  const where = conds.length ? and(...conds) : undefined;
  const rows = await db
    .select({
      id: initiatives.id,
      source: initiatives.source,
      sourceId: initiatives.sourceId,
      code: initiatives.code,
      title: initiatives.title,
      titleEn: currentEnglishInitiativeTitleSql().as("title_en"),
      sourceCategory: initiatives.sourceCategory,
      status: initiatives.status,
      chamber: initiatives.chamber,
      sponsor: initiatives.sponsor,
      sponsorRole: initiatives.sponsorRole,
      party: initiatives.party,
      province: initiatives.province,
      filedAt: initiatives.filedAt,
      sourceUrl: initiatives.sourceUrl,
      filteredProponentRelationship: sql<null>`null`,
      raw: initiatives.raw,
    })
    .from(initiatives)
    .where(where)
    .orderBy(sql`${initiatives.filedAt} desc nulls last`)
    .limit(limit);
  return attachPreferredDepositedDocuments(db, await attachInitiativeSponsorProfiles(db, rows));
}

// ---------------------------------------------------------------------------
// Legislator roster + committee membership (full elected Congress)
// ---------------------------------------------------------------------------

/** Upsert a legislator (by source+source_id); refreshes the mutable roster fields. */
export async function upsertLegislator(db: Database, l: NewLegislator): Promise<void> {
  if (l.source === "roster-senado") {
    throw new Error(
      "Senate roster writes require replaceRosterSnapshot so seat-occupant identity drift is checked",
    );
  }
  await db
    .insert(legislators)
    .values(l)
    .onConflictDoUpdate({
      target: [legislators.source, legislators.sourceId],
      set: {
        chamber: l.chamber,
        fullName: l.fullName,
        province: l.province,
        circumscription: l.circumscription,
        party: l.party,
        partyShort: l.partyShort,
        role: l.role,
        representationLevel: l.representationLevel,
        period: l.period,
        photoUrl: l.photoUrl,
        email: l.email,
        phone: l.phone,
        profession: l.profession,
        sourceUrl: l.sourceUrl,
        active: true,
        raw: l.raw,
        lastSeenAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });
}

/** Upsert a committee membership row (by source+commission+person); refreshes cargo. */
export async function upsertCommissionMember(db: Database, m: NewCommissionMember): Promise<void> {
  await db
    .insert(commissionMembers)
    .values(m)
    .onConflictDoUpdate({
      target: [
        commissionMembers.source,
        commissionMembers.commissionName,
        commissionMembers.legislatorName,
      ],
      set: {
        chamber: m.chamber,
        commissionSourceId: m.commissionSourceId,
        legislatorSourceId: m.legislatorSourceId,
        cargo: m.cargo,
        party: m.party,
        sourceUrl: m.sourceUrl,
        active: true,
        updatedAt: sql`now()`,
      },
    });
}

/**
 * Atomically replace one source's current roster snapshot. Rows absent from a fully
 * collected and cardinality-validated snapshot remain stored for audit/history but
 * are no longer served as current members.
 */
export async function replaceRosterSnapshot(
  db: Database,
  source: string,
  roster: readonly NewLegislator[],
  memberships: readonly NewCommissionMember[],
): Promise<void> {
  await db.transaction(async (tx) => {
    if (source === "roster-senado") {
      const existing = await tx
        .select({ sourceId: legislators.sourceId, fullName: legislators.fullName })
        .from(legislators)
        .where(eq(legislators.source, source));
      const existingNameBySeat = new Map(
        existing.map((row) => [row.sourceId, exactRosterIdentityNameKey(row.fullName)]),
      );
      const incomingNameBySeat = new Map<string, string>();
      for (const member of roster) {
        if (member.source !== source) {
          throw new Error(`Senate roster row ${member.sourceId} belongs to ${member.source}`);
        }
        const sourceId = member.sourceId.trim();
        const nameKey = exactRosterIdentityNameKey(member.fullName);
        const duplicateName = incomingNameBySeat.get(sourceId);
        if (duplicateName !== undefined && duplicateName !== nameKey) {
          throw new Error(`Senate roster identity drift within snapshot for seat ${sourceId}`);
        }
        incomingNameBySeat.set(sourceId, nameKey);
        const priorName = existingNameBySeat.get(sourceId);
        if (
          priorName !== undefined &&
          priorName !== nameKey &&
          !exactIncomingRosterAliases(member.raw).has(priorName)
        ) {
          // Senado HTML identifies a province seat, not a durable person. Silently
          // updating this row would retarget every historical initiative FK to the
          // replacement occupant. Abort the entire snapshot until the reviewed
          // MasterLex person-id bridge is explicitly reconciled to a new profile. A
          // source-published exact alias is the sole exception: it proves that this is
          // a canonical-name expansion for the same observed profile, not a new person.
          throw new Error(
            `Senate roster occupant drift for seat ${sourceId}; refusing to reassign historical person identity`,
          );
        }
      }
    }
    await tx.update(legislators).set({ active: false }).where(eq(legislators.source, source));
    await tx
      .update(commissionMembers)
      .set({ active: false })
      .where(eq(commissionMembers.source, source));

    for (const member of roster) {
      await tx
        .insert(legislators)
        .values({ ...member, active: true })
        .onConflictDoUpdate({
          target: [legislators.source, legislators.sourceId],
          set: {
            chamber: member.chamber,
            fullName: member.fullName,
            province: member.province,
            circumscription: member.circumscription,
            party: member.party,
            partyShort: member.partyShort,
            role: member.role,
            representationLevel: member.representationLevel,
            period: member.period,
            photoUrl: member.photoUrl,
            email: member.email,
            phone: member.phone,
            profession: member.profession,
            sourceUrl: member.sourceUrl,
            active: true,
            raw: member.raw,
            lastSeenAt: sql`now()`,
            updatedAt: sql`now()`,
          },
        });
    }

    for (const membership of memberships) {
      await tx
        .insert(commissionMembers)
        .values({ ...membership, active: true })
        .onConflictDoUpdate({
          target: [
            commissionMembers.source,
            commissionMembers.commissionName,
            commissionMembers.legislatorName,
          ],
          set: {
            chamber: membership.chamber,
            commissionSourceId: membership.commissionSourceId,
            legislatorSourceId: membership.legislatorSourceId,
            cargo: membership.cargo,
            party: membership.party,
            sourceUrl: membership.sourceUrl,
            active: true,
            updatedAt: sql`now()`,
          },
        });
    }
  });
}

/** Exact reviewed-name comparison: Unicode NFC, whitespace and case only. */
function exactRosterIdentityNameKey(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("es-DO");
}

/**
 * Read only the roster adapter's explicit identity-alias evidence. No alternate raw
 * field, substring, accent folding, or fuzzy comparison can authorize a person rename.
 */
function exactIncomingRosterAliases(raw: unknown): ReadonlySet<string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Set();
  const explicit = (raw as Record<string, unknown>).explicit;
  if (!explicit || typeof explicit !== "object" || Array.isArray(explicit)) return new Set();
  const aliases = (explicit as Record<string, unknown>).identityAliases;
  if (!Array.isArray(aliases)) return new Set();
  return new Set(
    aliases
      .filter((alias): alias is string => typeof alias === "string" && alias.trim().length > 0)
      .map(exactRosterIdentityNameKey),
  );
}

export interface RosterMember {
  id: number;
  source: string;
  sourceId: string;
  chamber: string;
  fullName: string;
  province: string | null;
  circumscription: string | null;
  party: string | null;
  partyShort: string | null;
  role: string | null;
  representationLevel: string | null;
  period: string | null;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  profession: string | null;
  sourceUrl: string | null;
}

/**
 * Deliberately minimal roster payload for server-rendered directories. Full contact,
 * provenance and committee data belongs exclusively to the exact profile endpoint.
 */
export interface LegislatorSummary {
  profileId: number;
  fullName: string;
  chamber: string;
  role: string | null;
  party: string | null;
  province: string | null;
}

/** Active roster summaries, with no profile-only fields selected from the database. */
export async function listLegislatorSummaries(db: Database): Promise<LegislatorSummary[]> {
  return db
    .select({
      profileId: legislators.id,
      fullName: legislators.fullName,
      chamber: legislators.chamber,
      role: legislators.role,
      party: sql<string | null>`coalesce(${legislators.partyShort}, ${legislators.party})`,
      province: legislators.province,
    })
    .from(legislators)
    .where(eq(legislators.active, true))
    .orderBy(legislators.chamber, legislators.fullName);
}

export type OfficialRosterChamber = "DIPUTADOS" | "SENADO";

/** One exact, source-published party bucket within an official active chamber roster. */
export interface ActiveRosterPartyBucket {
  chamber: OfficialRosterChamber;
  /** Source-published abbreviation. Kept separate from the full name and from null. */
  partyShort: string | null;
  /** Source-published full party name. Kept separate from the abbreviation and from null. */
  partyFullName: string | null;
  count: number;
}

/**
 * Active party composition for the two official elected rosters. Source and chamber
 * must match as an exact pair so a mislabeled or unrelated roster cannot enter the
 * aggregate. Party fields are grouped as published; missing values remain their own
 * `(null, null)` bucket instead of being inferred or coalesced.
 */
export async function countActiveRosterByChamberParty(
  db: Database,
): Promise<ActiveRosterPartyBucket[]> {
  return db
    .select({
      chamber: sql<OfficialRosterChamber>`${legislators.chamber}`,
      partyShort: legislators.partyShort,
      partyFullName: legislators.party,
      count: sql<number>`count(*)::int`,
    })
    .from(legislators)
    .where(
      and(
        eq(legislators.active, true),
        or(
          and(eq(legislators.source, "roster-diputados"), eq(legislators.chamber, "DIPUTADOS")),
          and(eq(legislators.source, "roster-senado"), eq(legislators.chamber, "SENADO")),
        ),
      ),
    )
    .groupBy(legislators.chamber, legislators.partyShort, legislators.party)
    .orderBy(legislators.chamber, legislators.partyShort, legislators.party);
}

/** Narrow source-backed portrait record for editorial roster previews. */
export interface LegislatorPortraitCandidate {
  profileId: number;
  source: string;
  fullName: string;
  chamber: string;
  role: string | null;
  party: string | null;
  province: string | null;
  photoUrl: string | null;
}

/**
 * Active legislators with a source-published portrait for one exact chamber. The
 * customer-facing layer still validates the URL against the adapter's official domains.
 */
export async function listLegislatorPortraitCandidates(
  db: Database,
  opts: { chamber: "DIPUTADOS" | "SENADO"; limit?: number },
): Promise<LegislatorPortraitCandidate[]> {
  const requestedLimit = Number.isSafeInteger(opts.limit) ? Math.trunc(opts.limit!) : 24;
  const limit = Math.min(64, Math.max(1, requestedLimit));
  return db
    .select({
      profileId: legislators.id,
      source: legislators.source,
      fullName: legislators.fullName,
      chamber: legislators.chamber,
      role: legislators.role,
      party: sql<string | null>`coalesce(${legislators.partyShort}, ${legislators.party})`,
      province: legislators.province,
      photoUrl: legislators.photoUrl,
    })
    .from(legislators)
    .where(
      and(
        eq(legislators.active, true),
        eq(legislators.chamber, opts.chamber),
        isNotNull(legislators.photoUrl),
      ),
    )
    .orderBy(legislators.fullName, legislators.id)
    .limit(limit);
}

export interface LegislatorProfileReference {
  /** Stable id published by the roster's upstream source. */
  sourceId: string | null;
  /** When present, identity must match this exact adapter source. */
  source?: string | null;
  /** When present, identity must match this exact published chamber. */
  chamber?: string | null;
}

/** @deprecated Prefer `LegislatorProfileReference`; retained for API compatibility. */
export type ActiveLegislatorProfileReference = LegislatorProfileReference;

async function resolveLegislatorProfileIdsByActivity(
  db: Database,
  references: readonly LegislatorProfileReference[],
  activeOnly: boolean,
): Promise<Array<number | null>> {
  const sourceIds = [
    ...new Set(
      references
        .map((reference) => reference.sourceId?.trim() || null)
        .filter((sourceId): sourceId is string => sourceId !== null),
    ),
  ];
  if (sourceIds.length === 0) return references.map(() => null);

  const candidates = await db
    .select({
      id: legislators.id,
      source: legislators.source,
      sourceId: legislators.sourceId,
      chamber: legislators.chamber,
    })
    .from(legislators)
    .where(
      activeOnly
        ? and(eq(legislators.active, true), inArray(legislators.sourceId, sourceIds))
        : inArray(legislators.sourceId, sourceIds),
    );
  const bySourceId = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const bucket = bySourceId.get(candidate.sourceId) ?? [];
    bucket.push(candidate);
    bySourceId.set(candidate.sourceId, bucket);
  }

  return references.map((reference) => {
    const sourceId = reference.sourceId?.trim() || null;
    if (!sourceId) return null;
    const matches = (bySourceId.get(sourceId) ?? []).filter(
      (candidate) =>
        (reference.source == null || candidate.source === reference.source) &&
        (reference.chamber == null || candidate.chamber === reference.chamber),
    );
    return matches.length === 1 ? matches[0]!.id : null;
  });
}

/**
 * Resolve exact source identities across current and historical roster rows.
 *
 * This is the ingestion/linker API: a temporary absence from the active snapshot must
 * not degrade an already exact person id into an unresolved name. Public directories
 * and profile selection must continue to use the active-only resolver below.
 */
export async function resolveLegislatorProfileIds(
  db: Database,
  references: readonly LegislatorProfileReference[],
): Promise<Array<number | null>> {
  return resolveLegislatorProfileIdsByActivity(db, references, false);
}

/**
 * Resolve active roster identities in one bounded query while preserving input order.
 * A reference resolves only when its supplied exact fields leave one candidate. An
 * ambiguous source id deliberately returns null instead of guessing from a name.
 */
export async function resolveActiveLegislatorProfileIds(
  db: Database,
  references: readonly LegislatorProfileReference[],
): Promise<Array<number | null>> {
  return resolveLegislatorProfileIdsByActivity(db, references, true);
}

/** Public-safe exact profile record, including whether it belongs to the current roster. */
export interface LegislatorProfile extends RosterMember {
  active: boolean;
}

/**
 * One exact profile by canonical internal id, including historical/inactive people.
 * Raw source payloads and ingestion timestamps are deliberately not selected.
 */
export async function getLegislatorProfileById(
  db: Database,
  profileId: number,
): Promise<LegislatorProfile | null> {
  if (!Number.isSafeInteger(profileId) || profileId < 1 || profileId > POSTGRES_INTEGER_MAX) {
    return null;
  }
  const [row] = await db
    .select({
      id: legislators.id,
      source: legislators.source,
      sourceId: legislators.sourceId,
      chamber: legislators.chamber,
      fullName: legislators.fullName,
      province: legislators.province,
      circumscription: legislators.circumscription,
      party: legislators.party,
      partyShort: legislators.partyShort,
      role: legislators.role,
      representationLevel: legislators.representationLevel,
      period: legislators.period,
      photoUrl: legislators.photoUrl,
      email: legislators.email,
      phone: legislators.phone,
      profession: legislators.profession,
      sourceUrl: legislators.sourceUrl,
      active: legislators.active,
    })
    .from(legislators)
    .where(eq(legislators.id, profileId))
    .limit(1);
  return row ?? null;
}

/** One active profile by its canonical internal id; historical/inactive rows fail closed. */
export async function getActiveLegislatorProfileById(
  db: Database,
  profileId: number,
): Promise<RosterMember | null> {
  if (!Number.isSafeInteger(profileId) || profileId < 1) return null;
  const [row] = await db
    .select({
      id: legislators.id,
      source: legislators.source,
      sourceId: legislators.sourceId,
      chamber: legislators.chamber,
      fullName: legislators.fullName,
      province: legislators.province,
      circumscription: legislators.circumscription,
      party: legislators.party,
      partyShort: legislators.partyShort,
      role: legislators.role,
      representationLevel: legislators.representationLevel,
      period: legislators.period,
      photoUrl: legislators.photoUrl,
      email: legislators.email,
      phone: legislators.phone,
      profession: legislators.profession,
      sourceUrl: legislators.sourceUrl,
    })
    .from(legislators)
    .where(and(eq(legislators.id, profileId), eq(legislators.active, true)))
    .limit(1);
  return row ?? null;
}

interface InitiativeProponentReconciliationCompatibility {
  initiativeSource: string;
  personNamespace: string;
  rosterSource: string;
  chamber: "DIPUTADOS" | "SENADO";
  resolverVersion: string;
}

function reconciliationCompatibilityForProfile(profile: {
  source: string;
  chamber: string;
}): InitiativeProponentReconciliationCompatibility | null {
  if (profile.source === "roster-diputados" && profile.chamber === "DIPUTADOS") {
    return {
      initiativeSource: "sil-diputados",
      personNamespace: "sil-diputados-legislator",
      rosterSource: "roster-diputados",
      chamber: "DIPUTADOS",
      resolverVersion: DIPUTADOS_PROPONENT_RESOLVER_VERSION,
    };
  }
  if (profile.source === "roster-senado" && profile.chamber === "SENADO") {
    return {
      initiativeSource: "senado-sil",
      personNamespace: "senado-sil-person",
      rosterSource: "roster-senado",
      chamber: "SENADO",
      resolverVersion: SENATE_PROPONENT_RESOLVER_VERSION,
    };
  }
  return null;
}

async function hasCurrentCompleteInitiativeProponentReconciliation(
  db: Database,
  compatibility: InitiativeProponentReconciliationCompatibility,
): Promise<boolean> {
  const [run] = await db
    .select({
      sourceCandidateCount: initiativeProponentReconciliationRuns.sourceCandidateCount,
      sourceMaxInitiativeId: initiativeProponentReconciliationRuns.sourceMaxInitiativeId,
      sourceFingerprint: initiativeProponentReconciliationRuns.sourceFingerprint,
    })
    .from(initiativeProponentReconciliationRuns)
    .where(
      and(
        eq(initiativeProponentReconciliationRuns.status, "complete"),
        eq(initiativeProponentReconciliationRuns.initiativeSource, compatibility.initiativeSource),
        eq(initiativeProponentReconciliationRuns.personNamespace, compatibility.personNamespace),
        eq(initiativeProponentReconciliationRuns.rosterSource, compatibility.rosterSource),
        eq(initiativeProponentReconciliationRuns.chamber, compatibility.chamber),
        eq(initiativeProponentReconciliationRuns.resolverVersion, compatibility.resolverVersion),
        eq(
          initiativeProponentReconciliationRuns.compatibilityVersion,
          INITIATIVE_PROPONENT_RECONCILIATION_COMPATIBILITY_VERSION,
        ),
      ),
    )
    .orderBy(
      sql`${initiativeProponentReconciliationRuns.completedAt} desc nulls last`,
      sql`${initiativeProponentReconciliationRuns.id} desc`,
    )
    .limit(1);
  if (!run) return false;
  const current = await initiativeSourceFingerprint(db, compatibility.initiativeSource);
  return (
    current.candidateCount === run.sourceCandidateCount &&
    current.maxInitiativeId === run.sourceMaxInitiativeId &&
    current.fingerprint === run.sourceFingerprint
  );
}

export type LegislatorInitiativeStats =
  | {
      availability: "observed";
      basis: "official-proponent-id";
      /** `complete` is asserted only by a durable, compatible current full-source run. */
      coverage: "partial" | "complete";
      /** Initiatives with a published filing date and this exact official proponent id. */
      deposited: number;
      /** Deposited initiatives whose current official condition is literally VIGENTE. */
      active: number;
      /** Deposited initiatives with another condition or no published condition. */
      otherConditionOrUnpublished: number;
    }
  | {
      availability: "unavailable";
      reason: "no-compatible-official-identifier" | "reconciliation-incomplete";
      deposited: null;
      active: null;
      otherConditionOrUnpublished: null;
    };

/**
 * Initiative counts for one exact roster identity.
 *
 * The normalized relation records how each source identity was resolved and points to
 * the canonical internal profile. This keeps numeric namespaces separate and supports
 * both chambers without querying names. A deposited initiative must also have a
 * source-published filing date.
 */
export async function getLegislatorInitiativeStats(
  db: Database,
  legislator: number | Pick<RosterMember, "id">,
): Promise<LegislatorInitiativeStats> {
  const profileId = typeof legislator === "number" ? legislator : legislator.id;
  if (!Number.isSafeInteger(profileId) || profileId < 1 || profileId > POSTGRES_INTEGER_MAX) {
    return {
      availability: "unavailable",
      reason: "no-compatible-official-identifier",
      deposited: null,
      active: null,
      otherConditionOrUnpublished: null,
    };
  }

  const [profile] = await db
    .select({ id: legislators.id, source: legislators.source, chamber: legislators.chamber })
    .from(legislators)
    .where(eq(legislators.id, profileId))
    .limit(1);
  if (!profile) {
    return {
      availability: "unavailable",
      reason: "no-compatible-official-identifier",
      deposited: null,
      active: null,
      otherConditionOrUnpublished: null,
    };
  }
  const compatibility = reconciliationCompatibilityForProfile(profile);
  const compatibleRelation = compatibility
    ? sql`and ${initiativeProponents.initiativeSource} = ${compatibility.initiativeSource}
          and ${initiativeProponents.personNamespace} = ${compatibility.personNamespace}`
    : sql``;

  const result = await db.execute(sql`
    select
      count(distinct ${initiatives.id})::int as deposited,
      count(distinct ${initiatives.id}) filter (
        where upper(trim(coalesce(${initiatives.condition}, ''))) = 'VIGENTE'
      )::int as active
    from ${initiatives}
    where ${initiatives.filedAt} is not null
      and trim(${initiatives.filedAt}) <> ''
      and exists (
        select 1
          from ${initiativeProponents}
         where ${initiativeProponents.initiativeId} = ${initiatives.id}
           and ${initiativeProponents.legislatorId} = ${profileId}
           ${compatibleRelation}
      )
  `);
  const row = (result as unknown as { rows: Array<{ deposited: number; active: number }> }).rows[0];
  const deposited = Number(row?.deposited ?? 0);
  const active = Number(row?.active ?? 0);
  if (deposited === 0) {
    if (!compatibility) {
      return {
        availability: "unavailable",
        reason: "no-compatible-official-identifier",
        deposited: null,
        active: null,
        otherConditionOrUnpublished: null,
      };
    }
    if (!(await hasCurrentCompleteInitiativeProponentReconciliation(db, compatibility))) {
      return {
        availability: "unavailable",
        reason: "reconciliation-incomplete",
        deposited: null,
        active: null,
        otherConditionOrUnpublished: null,
      };
    }
  }
  return {
    availability: "observed",
    basis: "official-proponent-id",
    coverage: deposited === 0 ? "complete" : "partial",
    deposited,
    active,
    otherConditionOrUnpublished: Math.max(0, deposited - active),
  };
}

/** Full roster, optionally filtered by chamber/province/party. Ordered by chamber, name. */
export async function listLegislators(
  db: Database,
  opts: { chamber?: string; province?: string; party?: string } = {},
): Promise<RosterMember[]> {
  const conds = [];
  conds.push(eq(legislators.active, true));
  if (opts.chamber) conds.push(eq(legislators.chamber, opts.chamber));
  if (opts.province) conds.push(eq(legislators.province, opts.province));
  if (opts.party) conds.push(eq(legislators.partyShort, opts.party));
  const where = and(...conds);
  return db
    .select({
      id: legislators.id,
      source: legislators.source,
      sourceId: legislators.sourceId,
      chamber: legislators.chamber,
      fullName: legislators.fullName,
      province: legislators.province,
      circumscription: legislators.circumscription,
      party: legislators.party,
      partyShort: legislators.partyShort,
      role: legislators.role,
      representationLevel: legislators.representationLevel,
      period: legislators.period,
      photoUrl: legislators.photoUrl,
      email: legislators.email,
      phone: legislators.phone,
      profession: legislators.profession,
      sourceUrl: legislators.sourceUrl,
    })
    .from(legislators)
    .where(where)
    .orderBy(legislators.chamber, legislators.fullName);
}

export interface LegislatorCommittee {
  source: string;
  legislatorSourceId: string | null;
  legislatorName: string;
  chamber: string;
  commissionName: string;
  cargo: string | null;
}

/** Every committee seat as a flat list — used to attach committees to each legislator. */
export async function legislatorCommittees(db: Database): Promise<LegislatorCommittee[]> {
  return db
    .select({
      source: commissionMembers.source,
      legislatorSourceId: commissionMembers.legislatorSourceId,
      legislatorName: commissionMembers.legislatorName,
      chamber: commissionMembers.chamber,
      commissionName: commissionMembers.commissionName,
      cargo: commissionMembers.cargo,
    })
    .from(commissionMembers)
    .where(eq(commissionMembers.active, true))
    .orderBy(commissionMembers.commissionName);
}

// ---------------------------------------------------------------------------
// Feed window (news / official / social / legislative-signal items)
// ---------------------------------------------------------------------------

/** One entity tag attached to a feed item (deep-links the card to a bill/person/committee). */
export interface FeedEntityTag {
  entityType: "INITIATIVE" | "LEGISLATOR" | "COMMISSION";
  initiativeCode?: string | null;
  legislatorSourceId?: string | null;
  commissionName?: string | null;
  label: string;
}

export interface FeedUpsertResult {
  id: number;
  inserted: boolean;
}

/**
 * Idempotent upsert of a feed item keyed by (source, source_id), then sync its entity
 * tags into feed_item_entities (resolving initiative codes → ids in one query). Mirrors
 * the upsertActivityEvent + activityInitiatives backfill idiom.
 */
export async function upsertFeedItem(
  db: Database,
  item: NewFeedItem,
  tags: FeedEntityTag[] = [],
): Promise<FeedUpsertResult> {
  const existing = await db
    .select({ id: feedItems.id })
    .from(feedItems)
    .where(and(eq(feedItems.source, item.source), eq(feedItems.sourceId, item.sourceId)))
    .limit(1);
  const rejectedCategory = item.category ?? null;
  const safeItem: NewFeedItem = { ...item, category: null };
  return db.transaction(async (tx) => {
    const updates = {
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      imageUrl: item.imageUrl,
      url: item.url,
      author: item.author,
      handle: item.handle,
      platform: item.platform,
      category: null,
      publishedAt: item.publishedAt,
      initiativeId: item.initiativeId,
      initiativeCode: item.initiativeCode,
      legislatorSourceId: item.legislatorSourceId,
      commissionName: item.commissionName,
      chamber: item.chamber,
      raw: item.raw,
      lastSeenAt: sql`now()`,
    };
    const [row] = await tx
      .insert(feedItems)
      .values(safeItem)
      .onConflictDoUpdate({
        target: [feedItems.source, feedItems.sourceId],
        set: updates,
      })
      .returning({ id: feedItems.id });
    const id = row!.id;

    if (rejectedCategory != null) {
      await tx
        .insert(inferenceAudit)
        .values({
          entityType: "feed_item",
          entityId: id,
          inferenceKind: "blocked_category",
          value: { category: rejectedCategory },
          provenance: { source: item.source, sourceUrl: item.url ?? null },
        })
        .onConflictDoUpdate({
          target: [
            inferenceAudit.entityType,
            inferenceAudit.entityId,
            inferenceAudit.inferenceKind,
          ],
          set: {
            value: { category: rejectedCategory },
            provenance: { source: item.source, sourceUrl: item.url ?? null },
            archivedAt: sql`now()`,
          },
        });
    }

    // Tags are a source snapshot. Clearing/reclassifying an item removes stale links.
    await tx.delete(feedItemEntities).where(eq(feedItemEntities.feedItemId, id));
    const uniqueTags = [
      ...new Map(tags.map((tag) => [`${tag.entityType}\u0000${tag.label}`, tag] as const)).values(),
    ];
    const codes = uniqueTags
      .filter((t) => t.entityType === "INITIATIVE" && t.initiativeCode)
      .map((t) => t.initiativeCode!) as string[];
    const codeToId = new Map<string, number>();
    if (codes.length) {
      const rows = await tx
        .select({ id: initiatives.id, code: initiatives.code, chamber: initiatives.chamber })
        .from(initiatives)
        .where(inArray(initiatives.code, codes));
      for (const [code, id] of uniqueInitiativeIdsByCode(rows, item.chamber)) {
        codeToId.set(code, id);
      }
    }
    for (const t of uniqueTags) {
      const initiativeId = t.initiativeCode ? (codeToId.get(t.initiativeCode) ?? null) : null;
      await tx.insert(feedItemEntities).values({
        feedItemId: id,
        entityType: t.entityType,
        initiativeCode: t.initiativeCode ?? null,
        initiativeId,
        legislatorSourceId: t.legislatorSourceId ?? null,
        commissionName: t.commissionName ?? null,
        label: t.label,
      });
    }
    return { id, inserted: existing.length === 0 };
  });
}

/** Idempotent upsert of a registry account keyed by (platform, handle). */
export async function upsertFeedAccount(db: Database, a: NewFeedAccount): Promise<void> {
  const rejectedRank = a.influenceRank ?? null;
  const safeAccount: NewFeedAccount = { ...a, influenceRank: null };
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(feedAccounts)
      .values(safeAccount)
      .onConflictDoUpdate({
        target: [feedAccounts.platform, feedAccounts.handle],
        set: {
          name: a.name,
          url: a.url,
          kind: a.kind,
          chamber: a.chamber,
          legislatorSourceId: a.legislatorSourceId,
          influenceRank: null,
          active: a.active ?? true,
          raw: a.raw,
          lastSeenAt: sql`now()`,
          updatedAt: sql`now()`,
        },
      })
      .returning({ id: feedAccounts.id });
    if (rejectedRank != null) {
      await tx
        .insert(inferenceAudit)
        .values({
          entityType: "feed_account",
          entityId: row!.id,
          inferenceKind: "blocked_influence_rank",
          value: { influenceRank: rejectedRank },
          provenance: { platform: a.platform, handle: a.handle, url: a.url },
        })
        .onConflictDoUpdate({
          target: [
            inferenceAudit.entityType,
            inferenceAudit.entityId,
            inferenceAudit.inferenceKind,
          ],
          set: {
            value: { influenceRank: rejectedRank },
            provenance: { platform: a.platform, handle: a.handle, url: a.url },
            archivedAt: sql`now()`,
          },
        });
    }
  });
}

export interface FeedTag {
  entityType: string;
  label: string;
  initiativeId: number | null;
  initiativeCode: string | null;
  initiativeTitle: string | null; // bill title (shown instead of the code on the card)
  initiativeTitleEn: string | null;
  legislatorSourceId: string | null;
  /** Unique active roster profile for source id + the item's published chamber. */
  legislatorProfileId: number | null;
  commissionName: string | null;
}

export interface FeedListItem {
  id: number;
  source: string;
  sourceId: string;
  kind: string;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  url: string | null;
  author: string | null;
  handle: string | null;
  platform: string | null;
  /** Publication time explicitly supplied by the upstream source. */
  publishedAt: string | null;
  /** First time Oculis stored the item; never presented as a source publication time. */
  observedAt: string;
  /** Internal keyset-order timestamp (`publishedAt ?? observedAt`). */
  sortAt: string;
  chamber: string | null;
  tags: FeedTag[];
}

export interface FeedFilters {
  kind?: string;
  initiativeCode?: string;
  legislatorSourceId?: string;
  commissionName?: string;
  chamber?: string;
  search?: string;
}

export interface FeedCursor {
  sortAt: string;
  id: number;
}

/**
 * Chronological feed with keyset pagination on (coalesce(published_at, first_seen_at) desc,
 * id desc) — feeds grow at the head, so keyset avoids the dupes/skips of offset paging.
 * Each item carries its full entity-tag set (fetched in a second query, merged in memory).
 */
export async function listFeedItems(
  db: Database,
  f: FeedFilters = {},
  opts: { limit?: number; cursor?: FeedCursor | null } = {},
): Promise<{ items: FeedListItem[]; nextCursor: FeedCursor | null }> {
  const limit = Math.min(Math.max(1, opts.limit ?? 30), 100);
  const sortTs = sql`coalesce(${feedItems.publishedAt}, ${feedItems.firstSeenAt})`;
  const conds = [];
  if (f.kind) conds.push(eq(feedItems.kind, f.kind));
  if (f.chamber) conds.push(eq(feedItems.chamber, f.chamber));
  if (f.initiativeCode) {
    conds.push(sql`(
      ${feedItems.initiativeCode} = ${f.initiativeCode}
      or exists (
        select 1 from feed_item_entities fie
        where fie.feed_item_id = ${feedItems.id}
          and fie.entity_type = 'INITIATIVE'
          and fie.initiative_code = ${f.initiativeCode}
      )
    )`);
  }
  if (f.legislatorSourceId) {
    conds.push(sql`(
      ${feedItems.legislatorSourceId} = ${f.legislatorSourceId}
      or exists (
        select 1 from feed_item_entities fie
        where fie.feed_item_id = ${feedItems.id}
          and fie.entity_type = 'LEGISLATOR'
          and fie.legislator_source_id = ${f.legislatorSourceId}
      )
    )`);
  }
  if (f.commissionName) {
    conds.push(sql`(
      ${feedItems.commissionName} = ${f.commissionName}
      or exists (
        select 1 from feed_item_entities fie
        where fie.feed_item_id = ${feedItems.id}
          and fie.entity_type = 'COMMISSION'
          and fie.commission_name = ${f.commissionName}
      )
    )`);
  }
  if (f.search) {
    const q = `%${f.search}%`;
    conds.push(sql`(${feedItems.title} ilike ${q} or ${feedItems.summary} ilike ${q})`);
  }
  if (opts.cursor?.sortAt) {
    const cts = opts.cursor.sortAt;
    const cid = opts.cursor.id;
    conds.push(
      sql`(${sortTs} < ${cts}::timestamp or (${sortTs} = ${cts}::timestamp and ${feedItems.id} < ${cid}))`,
    );
  }
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      id: feedItems.id,
      source: feedItems.source,
      sourceId: feedItems.sourceId,
      kind: feedItems.kind,
      title: feedItems.title,
      summary: feedItems.summary,
      imageUrl: feedItems.imageUrl,
      url: feedItems.url,
      author: feedItems.author,
      handle: feedItems.handle,
      platform: feedItems.platform,
      publishedAt: sql<string | null>`${feedItems.publishedAt}::text`,
      observedAt: sql<string>`${feedItems.firstSeenAt}::text`,
      sortAt: sql<string>`${sortTs}::text`,
      chamber: feedItems.chamber,
    })
    .from(feedItems)
    .where(where)
    .orderBy(sql`${sortTs} desc`, sql`${feedItems.id} desc`)
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const ids = page.map((r) => r.id);
  const tagRows = ids.length
    ? await db
        .select({
          feedItemId: feedItemEntities.feedItemId,
          entityType: feedItemEntities.entityType,
          label: feedItemEntities.label,
          initiativeId: feedItemEntities.initiativeId,
          initiativeCode: feedItemEntities.initiativeCode,
          initiativeTitle: initiatives.title,
          initiativeTitleEn: currentEnglishInitiativeTitleSql().as("initiative_title_en"),
          legislatorSourceId: feedItemEntities.legislatorSourceId,
          commissionName: feedItemEntities.commissionName,
        })
        .from(feedItemEntities)
        .leftJoin(initiatives, eq(feedItemEntities.initiativeId, initiatives.id))
        .where(inArray(feedItemEntities.feedItemId, ids))
    : [];
  const chamberByFeedItemId = new Map(page.map((item) => [item.id, item.chamber]));
  const tagLegislatorProfileIds = await resolveActiveLegislatorProfileIds(
    db,
    tagRows.map((tag) => ({
      sourceId: tag.legislatorSourceId,
      chamber: chamberByFeedItemId.get(tag.feedItemId) ?? null,
    })),
  );
  const tagsByItem = new Map<number, FeedTag[]>();
  for (const [index, t] of tagRows.entries()) {
    const arr = tagsByItem.get(t.feedItemId) ?? [];
    arr.push({
      entityType: t.entityType,
      label: t.label,
      initiativeId: t.initiativeId,
      initiativeCode: t.initiativeCode,
      initiativeTitle: t.initiativeTitle ?? null,
      initiativeTitleEn: t.initiativeTitleEn ?? null,
      legislatorSourceId: t.legislatorSourceId,
      legislatorProfileId: tagLegislatorProfileIds[index] ?? null,
      commissionName: t.commissionName,
    });
    tagsByItem.set(t.feedItemId, arr);
  }

  const items: FeedListItem[] = page.map((r) => ({ ...r, tags: tagsByItem.get(r.id) ?? [] }));
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? { sortAt: last.sortAt, id: last.id } : null;
  return { items, nextCursor };
}

export type FeedAccountListItem = Omit<FeedAccount, "influenceRank">;

/** The curated account registry, alphabetically; subjective rank is not exposed. */
export async function listFeedAccounts(
  db: Database,
  opts: { platform?: string; kind?: string; activeOnly?: boolean; limit?: number } = {},
): Promise<FeedAccountListItem[]> {
  const conds = [];
  if (opts.platform) conds.push(eq(feedAccounts.platform, opts.platform));
  if (opts.kind) conds.push(eq(feedAccounts.kind, opts.kind));
  if (opts.activeOnly) conds.push(eq(feedAccounts.active, true));
  const where = conds.length ? and(...conds) : undefined;
  return db
    .select({
      id: feedAccounts.id,
      name: feedAccounts.name,
      handle: feedAccounts.handle,
      platform: feedAccounts.platform,
      url: feedAccounts.url,
      kind: feedAccounts.kind,
      chamber: feedAccounts.chamber,
      legislatorSourceId: feedAccounts.legislatorSourceId,
      active: feedAccounts.active,
      raw: feedAccounts.raw,
      firstSeenAt: feedAccounts.firstSeenAt,
      lastSeenAt: feedAccounts.lastSeenAt,
      updatedAt: feedAccounts.updatedAt,
    })
    .from(feedAccounts)
    .where(where)
    .orderBy(feedAccounts.name, feedAccounts.handle)
    .limit(opts.limit ?? 1000);
}

export interface RecentStatusEvent {
  id: number;
  initiativeId: number;
  status: string;
  eventDate: string | null;
  code: string | null;
  title: string;
  /** Latest reviewed English translation for this exact current official title. */
  titleEn: string | null;
  chamber: string | null;
  source: string;
  sourceUrl: string | null;
  evidenceType: string;
  raw: unknown;
  observedAt: string;
  effectiveAt: string;
}

/** Recent status changes joined to their initiative — source for legislative-signal cards. */
export async function listRecentStatusEvents(
  db: Database,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<RecentStatusEvent[]> {
  const days = Math.max(1, opts.sinceDays ?? 14);
  const limit = opts.limit ?? 100;
  const effectiveTime = sql`case
    when ${statusEvents.evidenceType} = 'SOURCE_HISTORY'
      and case
        when ${statusEvents.eventDate} ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          then to_char(
            make_date(
              substring(${statusEvents.eventDate} from 1 for 4)::int,
              substring(${statusEvents.eventDate} from 6 for 2)::int,
              1
            ) + (substring(${statusEvents.eventDate} from 9 for 2)::int - 1),
            'YYYY-MM-DD'
          ) = ${statusEvents.eventDate}
        else false
      end
      then ${statusEvents.eventDate}::date::timestamp
    when ${statusEvents.evidenceType} = 'OBSERVED_CHANGE'
      then ${statusEvents.observedAt}
  end`;
  return db
    .select({
      id: statusEvents.id,
      initiativeId: statusEvents.initiativeId,
      status: statusEvents.status,
      eventDate: statusEvents.eventDate,
      code: initiatives.code,
      title: initiatives.title,
      titleEn: currentEnglishInitiativeTitleSql().as("title_en"),
      chamber: initiatives.chamber,
      source: statusEvents.source,
      sourceUrl: statusEvents.sourceUrl,
      evidenceType: statusEvents.evidenceType,
      raw: statusEvents.raw,
      observedAt: sql<string>`${statusEvents.observedAt}::text`,
      effectiveAt: sql<string>`${effectiveTime}::text`,
    })
    .from(statusEvents)
    .innerJoin(initiatives, eq(statusEvents.initiativeId, initiatives.id))
    .where(
      and(
        isNull(statusEvents.retiredAt),
        sql`(
      ${statusEvents.evidenceType} = 'SOURCE_HISTORY'
      and case
        when ${statusEvents.eventDate} ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
          then case
            when to_char(
              make_date(
                substring(${statusEvents.eventDate} from 1 for 4)::int,
                substring(${statusEvents.eventDate} from 6 for 2)::int,
                1
              ) + (substring(${statusEvents.eventDate} from 9 for 2)::int - 1),
              'YYYY-MM-DD'
            ) = ${statusEvents.eventDate}
              then make_date(
                substring(${statusEvents.eventDate} from 1 for 4)::int,
                substring(${statusEvents.eventDate} from 6 for 2)::int,
                1
              ) + (substring(${statusEvents.eventDate} from 9 for 2)::int - 1)
                >= current_date - ${days}::int
            else false
          end
        else false
      end
    ) or (
      ${statusEvents.evidenceType} = 'OBSERVED_CHANGE'
      and ${statusEvents.observedAt} >= now() - make_interval(days => ${days})
    )`,
      ),
    )
    .orderBy(sql`${effectiveTime} desc`)
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Exact official movements by day and chamber
// ---------------------------------------------------------------------------

export type CongressMovementChamber = "DIPUTADOS" | "SENADO";
export type CongressMovementKind = "FILED" | "STATUS";

export type CongressMovementDocumentStatus =
  | "PUBLISHED_VERIFIED"
  | "REGISTERED_UNVERIFIED"
  | "NOT_PUBLISHED_LATEST_CHECK"
  | "UNCONFIRMED"
  | "UNSUPPORTED";

export type CongressMovementDocumentPublication =
  | {
      status: "PUBLISHED_VERIFIED";
      checkedAt: null;
      /** The selected current official document has a fresh exact-snapshot verification. */
      available: true;
      /** Server-owned id for the guarded local opener; never an external URL. */
      documentId: number;
    }
  | {
      status: "REGISTERED_UNVERIFIED";
      /** Exact successful collection observation, when the source supplied one. */
      checkedAt: string | null;
      /** No background extraction claim; the local opener performs the live PDF check. */
      available: false;
      /** Server-owned id remains usable for the guarded on-demand opener. */
      documentId: number;
    }
  | {
      status: Exclude<
        CongressMovementDocumentStatus,
        "PUBLISHED_VERIFIED" | "REGISTERED_UNVERIFIED"
      >;
      /** Exact successful document-collection observation used for a negative result. */
      checkedAt: string | null;
      /** Missing, stale, unsupported or otherwise unverified evidence all fail closed. */
      available: false;
      documentId: null;
    };

export interface CongressMovement {
  kind: CongressMovementKind;
  initiativeId: number;
  code: string | null;
  /** Exact current official Spanish title. */
  title: string;
  /** Latest reviewed English translation for that exact current title. */
  titleEn: string | null;
  /** Exact current initiative status for FILED, or exact source-history status for STATUS. */
  status: string | null;
  /** Exact valid official date that placed this movement on the selected day. */
  eventDate: string;
  chamber: CongressMovementChamber;
  source: string;
  sourceUrl: string | null;
  evidenceType: "OFFICIAL_FILED_AT" | "SOURCE_HISTORY";
  /** Source rows represented by this movement. FILED movements always represent one row. */
  sourceRowCount: number;
  /** Stable official event ids retained when equivalent SOURCE_HISTORY rows are consolidated. */
  sourceEventIds: string[];
  sourceEventId: string | null;
  note: string | null;
  /** When Oculis first observed the initiative or observed the source-history row. */
  observedAt: string;
  /** Current deposited-text availability; it is not a historical fact about eventDate. */
  documentPublication: CongressMovementDocumentPublication;
}

export type CongressDepositedPdfMonitoring =
  | {
      supported: true;
      /** Unique initiatives officially filed on the selected day in Diputados. */
      eligibleFiledInitiativeCount: number;
      /** Filed initiatives with a linked sil-diputados “Proyecto depositado” metadata row. */
      withOfficialMetadata: number;
      /** Filed initiatives with at least one exact-current verification no older than 24 hours. */
      withFreshVerifiedPdf: number;
      /** Denominator minus fresh verification; combines missing, unavailable and stale evidence. */
      unavailableOrUnverified: number;
      contractNote: string;
    }
  | {
      supported: false;
      eligibleFiledInitiativeCount: null;
      withOfficialMetadata: null;
      withFreshVerifiedPdf: null;
      unavailableOrUnverified: null;
      contractNote: string;
    };

export interface CongressPublicationMonitoring {
  /** Exact source collections counted for the selected chamber. */
  sources: readonly string[];
  /** Base catalog rows whose literal uploaded_at equals selectedDate. */
  publishedOnDate: number;
  /** Base catalog rows modified on selectedDate but not uploaded that same date. */
  modifiedOnDate: number;
  /** Stored base catalog rows without an official upload date, even if later modified. */
  undatedStoredCatalog: number;
  /** All stored base rows in the selected chamber's named source collections. */
  storedCatalogTotal: number;
  /** Congressional sources do not publish a reliable expected daily denominator. */
  expectedDailyTotal: null;
  contractNote: string;
}

export interface CongressMovementDay {
  chamber: CongressMovementChamber;
  selectedDate: string;
  previousAvailableDate: string | null;
  nextAvailableDate: string | null;
  latestAvailableDate: string | null;
  totalMovementCount: number;
  uniqueInitiativeCount: number;
  movements: CongressMovement[];
  depositedPdfs: CongressDepositedPdfMonitoring;
  publications: CongressPublicationMonitoring;
}

export const CONGRESS_PUBLICATION_SOURCES: Readonly<
  Record<CongressMovementChamber, readonly string[]>
> = {
  DIPUTADOS: ["dip-known-agenda"],
  SENADO: ["sen-approved", "sen-expired", "sen-votes", "sen-attendance", "sen-reports"],
};

const DEPOSITED_PDF_SUPPORTED_NOTE =
  "Metadata is not proof that PDF bytes are available, and zero stored metadata is not proof that the official source has no document. Fresh verification requires an exact current metadata snapshot checked within 24 hours; each filed initiative is counted once.";
const DEPOSITED_PDF_UNSUPPORTED_NOTE =
  "Senate deposited-PDF monitoring is not supported by the current exact-document verifier; null values must not be presented as 0/0.";
const CONGRESS_PUBLICATION_NOTE =
  "Counts cover stored base catalog rows (initiative_code IS NULL) in the named official collections. Zero dated rows is not proof that the source published nothing, and no expected daily denominator is inferred.";

function assertCongressMovementChamber(
  chamber: CongressMovementChamber,
): asserts chamber is CongressMovementChamber {
  if (chamber !== "DIPUTADOS" && chamber !== "SENADO") {
    throw new Error("chamber must be DIPUTADOS or SENADO");
  }
}

function assertExactOfficialDate(date: string): void {
  const match = /^(1\d{3}|2\d{3})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("date must be an exact ISO calendar date (YYYY-MM-DD)");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error("date must be an exact ISO calendar date (YYYY-MM-DD)");
  }
}

function congressInitiativeChamberIs(chamber: CongressMovementChamber) {
  // source_chamber describes the corpus that supplied the record and is authoritative
  // when populated. Only a missing/blank value permits the exact chamber fallback.
  return sql<boolean>`coalesce(
    nullif(upper(trim(${initiatives.sourceChamber})), ''),
    upper(trim(${initiatives.chamber}))
  ) = ${chamber}`;
}

function exactValidOfficialDate(
  column: typeof initiatives.filedAt | typeof statusEvents.eventDate,
) {
  return sql<boolean>`case
    when ${column} ~ '^[12][0-9]{3}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      then to_char(
        make_date(
          substring(${column} from 1 for 4)::int,
          substring(${column} from 6 for 2)::int,
          1
        ) + (substring(${column} from 9 for 2)::int - 1),
        'YYYY-MM-DD'
      ) = ${column}
    else false
  end`;
}

interface CongressMovementDateAvailability {
  previousAvailableDate: string | null;
  nextAvailableDate: string | null;
  latestAvailableDate: string | null;
}

async function congressMovementDateAvailability(
  db: Database,
  chamber: CongressMovementChamber,
  selectedDate?: string,
): Promise<CongressMovementDateAvailability> {
  assertCongressMovementChamber(chamber);
  if (selectedDate !== undefined) assertExactOfficialDate(selectedDate);
  const selected = selectedDate ?? null;
  const result = await db.execute(sql`
    with official_dates as (
      select ${initiatives.filedAt} as movement_date
        from ${initiatives}
       where ${congressInitiativeChamberIs(chamber)}
         and ${initiatives.kind} = 'LEGISLATIVE'
         and ${exactValidOfficialDate(initiatives.filedAt)}
      union
      select ${statusEvents.eventDate} as movement_date
        from ${statusEvents}
        inner join ${initiatives}
          on ${initiatives.id} = ${statusEvents.initiativeId}
       where ${statusEvents.evidenceType} = 'SOURCE_HISTORY'
         and ${statusEvents.retiredAt} is null
         and ${congressInitiativeChamberIs(chamber)}
         and ${initiatives.kind} = 'LEGISLATIVE'
         and ${exactValidOfficialDate(statusEvents.eventDate)}
    )
    select
      max(movement_date) filter (where ${selected}::text is not null and movement_date < ${selected})
        as previous_available_date,
      min(movement_date) filter (where ${selected}::text is not null and movement_date > ${selected})
        as next_available_date,
      max(movement_date) as latest_available_date
      from official_dates
  `);
  const row = (
    result as unknown as {
      rows: Array<{
        previous_available_date: string | null;
        next_available_date: string | null;
        latest_available_date: string | null;
      }>;
    }
  ).rows[0];
  return {
    previousAvailableDate: row?.previous_available_date ?? null,
    nextAvailableDate: row?.next_available_date ?? null,
    latestAvailableDate: row?.latest_available_date ?? null,
  };
}

/** Newest exact official filing/status-history date for one chamber. */
export async function latestCongressMovementDate(
  db: Database,
  chamber: CongressMovementChamber,
): Promise<string | null> {
  return (await congressMovementDateAvailability(db, chamber)).latestAvailableDate;
}

/** Stable UI order: filings, then status label, official title, initiative id and event id. */
function compareCongressMovements(left: CongressMovement, right: CongressMovement): number {
  const kind = (left.kind === "FILED" ? 0 : 1) - (right.kind === "FILED" ? 0 : 1);
  if (kind !== 0) return kind;
  const status = normalizedCongressMovementStatus(left.status ?? "").localeCompare(
    normalizedCongressMovementStatus(right.status ?? ""),
    "es",
  );
  if (status !== 0) return status;
  const literalStatus = (left.status ?? "").localeCompare(right.status ?? "", "es");
  if (literalStatus !== 0) return literalStatus;
  const title = left.title.localeCompare(right.title, "es");
  if (title !== 0) return title;
  if (left.initiativeId !== right.initiativeId) return left.initiativeId - right.initiativeId;
  const source = left.source.localeCompare(right.source, "en");
  if (source !== 0) return source;
  const sourceEvent = (left.sourceEventId ?? "").localeCompare(right.sourceEventId ?? "", "en", {
    numeric: true,
  });
  if (sourceEvent !== 0) return sourceEvent;
  return left.observedAt.localeCompare(right.observedAt);
}

/**
 * Presentation identity for an exact official status label.
 *
 * The sources sometimes publish the same status row more than once with harmless text
 * differences in the raw payload (for example, 26/08 versus 26/8), or under multiple
 * official row ids. Those source facts remain stored independently; the day view groups
 * only their equivalent presentation. Accent or wording changes remain distinct.
 */
function normalizedCongressMovementStatus(status: string): string {
  return status.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("es");
}

const DOCUMENT_OBSERVATION_FRESH_MS = 24 * 60 * 60 * 1_000;

interface RawDocumentObservation {
  checkedAt: string;
  hasDepositedText: boolean;
}

function currentRawDocumentObservation(raw: unknown): RawDocumentObservation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const snapshot = raw as {
    payload?: { documentos?: unknown };
    provenance?: {
      observedCollections?: unknown;
      retainedCollections?: unknown;
      collectionObservedAt?: { documentos?: unknown };
    };
  };
  const documentsPayload = snapshot.payload?.documentos;
  const checkedAt = snapshot.provenance?.collectionObservedAt?.documentos;
  const observedCollections = snapshot.provenance?.observedCollections;
  const retainedCollections = snapshot.provenance?.retainedCollections;
  const documentsObservedNow =
    Array.isArray(observedCollections) && observedCollections.includes("documentos");
  const documentsRetainedAfterFailure =
    Array.isArray(retainedCollections) && retainedCollections.includes("documentos");
  if (
    !Array.isArray(documentsPayload) ||
    typeof checkedAt !== "string" ||
    !documentsObservedNow ||
    documentsRetainedAfterFailure
  ) {
    return null;
  }

  const checkedAtMs = Date.parse(checkedAt);
  const now = Date.now();
  if (
    !Number.isFinite(checkedAtMs) ||
    checkedAtMs > now + 5 * 60 * 1_000 ||
    checkedAtMs < now - DOCUMENT_OBSERVATION_FRESH_MS
  ) {
    return null;
  }

  const hasDepositedText = documentsPayload.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const description = (item as { descripcion?: unknown }).descripcion;
    return typeof description === "string" && isDepositedBillDocumentType(description);
  });
  return { checkedAt, hasDepositedText };
}

async function congressMovementDocumentPublications(
  db: Database,
  chamber: CongressMovementChamber,
  initiativeIds: readonly number[],
): Promise<Map<number, CongressMovementDocumentPublication>> {
  const uniqueIds = [...new Set(initiativeIds)];
  const result = new Map<number, CongressMovementDocumentPublication>();
  if (chamber === "SENADO") {
    for (const initiativeId of uniqueIds) {
      result.set(initiativeId, {
        status: "UNSUPPORTED",
        checkedAt: null,
        available: false,
        documentId: null,
      });
    }
    return result;
  }
  if (uniqueIds.length === 0) return result;

  const [initiativeRows, documentRows] = await Promise.all([
    db
      .select({ id: initiatives.id, raw: initiatives.raw })
      .from(initiatives)
      .where(inArray(initiatives.id, uniqueIds)),
    db
      .select({
        id: documents.id,
        initiativeId: documents.initiativeId,
        source: documents.source,
        docType: documents.docType,
        url: documents.url,
        freshVerified: currentDocumentPdfAvailable(),
      })
      .from(documents)
      .where(
        and(
          inArray(documents.initiativeId, uniqueIds),
          eq(documents.source, "sil-diputados"),
          sql`lower(trim(coalesce(${documents.docType}, ''))) in ('proyecto depositado', 'p depositado')`,
        ),
      )
      .orderBy(
        documents.initiativeId,
        sql`${documents.uploadedAt} desc nulls last`,
        sql`${documents.id} desc`,
      ),
  ]);

  const metadataIds = new Set<number>();
  const currentDocumentByInitiative = new Map<number, { id: number; freshVerified: boolean }>();
  for (const row of documentRows) {
    if (row.initiativeId == null) continue;
    if (!officialDepositedBillPdfUrl(row)) continue;
    metadataIds.add(row.initiativeId);
    if (!currentDocumentByInitiative.has(row.initiativeId)) {
      currentDocumentByInitiative.set(row.initiativeId, {
        id: row.id,
        freshVerified: row.freshVerified,
      });
    }
  }
  const rawByInitiative = new Map(initiativeRows.map((row) => [row.id, row.raw]));

  for (const initiativeId of uniqueIds) {
    const currentDocument = currentDocumentByInitiative.get(initiativeId);
    if (currentDocument?.freshVerified) {
      result.set(initiativeId, {
        status: "PUBLISHED_VERIFIED",
        checkedAt: null,
        available: true,
        documentId: currentDocument.id,
      });
      continue;
    }
    const observation = currentRawDocumentObservation(rawByInitiative.get(initiativeId));
    if (observation && !observation.hasDepositedText) {
      result.set(initiativeId, {
        status: "NOT_PUBLISHED_LATEST_CHECK",
        checkedAt: observation.checkedAt,
        available: false,
        documentId: null,
      });
      continue;
    }
    if (metadataIds.has(initiativeId) || observation?.hasDepositedText) {
      const documentId = currentDocument?.id;
      if (documentId == null) {
        result.set(initiativeId, {
          status: "UNCONFIRMED",
          checkedAt: observation?.checkedAt ?? null,
          available: false,
          documentId: null,
        });
        continue;
      }
      result.set(initiativeId, {
        status: "REGISTERED_UNVERIFIED",
        checkedAt: observation?.checkedAt ?? null,
        available: false,
        documentId,
      });
      continue;
    }
    result.set(initiativeId, {
      status: "UNCONFIRMED",
      checkedAt: null,
      available: false,
      documentId: null,
    });
  }
  return result;
}

async function congressDepositedPdfMonitoring(
  db: Database,
  chamber: CongressMovementChamber,
  filedInitiativeIds: readonly number[],
): Promise<CongressDepositedPdfMonitoring> {
  if (chamber === "SENADO") {
    return {
      supported: false,
      eligibleFiledInitiativeCount: null,
      withOfficialMetadata: null,
      withFreshVerifiedPdf: null,
      unavailableOrUnverified: null,
      contractNote: DEPOSITED_PDF_UNSUPPORTED_NOTE,
    };
  }

  const uniqueFiledIds = [...new Set(filedInitiativeIds)];
  if (uniqueFiledIds.length === 0) {
    return {
      supported: true,
      eligibleFiledInitiativeCount: 0,
      withOfficialMetadata: 0,
      withFreshVerifiedPdf: 0,
      unavailableOrUnverified: 0,
      contractNote: DEPOSITED_PDF_SUPPORTED_NOTE,
    };
  }
  const rows = await db
    .select({
      id: documents.id,
      initiativeId: documents.initiativeId,
      source: documents.source,
      docType: documents.docType,
      url: documents.url,
      freshVerified: currentDocumentPdfAvailable(),
    })
    .from(documents)
    .where(
      and(
        inArray(documents.initiativeId, uniqueFiledIds),
        eq(documents.source, "sil-diputados"),
        sql`lower(trim(coalesce(${documents.docType}, ''))) in ('proyecto depositado', 'p depositado')`,
      ),
    )
    .orderBy(
      documents.initiativeId,
      sql`${documents.uploadedAt} desc nulls last`,
      sql`${documents.id} desc`,
    );
  const metadataIds = new Set<number>();
  const verifiedIds = new Set<number>();
  for (const row of rows) {
    if (
      row.initiativeId == null ||
      metadataIds.has(row.initiativeId) ||
      !officialDepositedBillPdfUrl(row)
    ) {
      continue;
    }
    // Count only the current preferred official document, never a verified superseded row.
    metadataIds.add(row.initiativeId);
    if (row.freshVerified) verifiedIds.add(row.initiativeId);
  }
  return {
    supported: true,
    eligibleFiledInitiativeCount: uniqueFiledIds.length,
    withOfficialMetadata: metadataIds.size,
    withFreshVerifiedPdf: verifiedIds.size,
    unavailableOrUnverified: uniqueFiledIds.length - verifiedIds.size,
    contractNote: DEPOSITED_PDF_SUPPORTED_NOTE,
  };
}

async function congressPublicationMonitoring(
  db: Database,
  chamber: CongressMovementChamber,
  selectedDate: string,
): Promise<CongressPublicationMonitoring> {
  const sources = CONGRESS_PUBLICATION_SOURCES[chamber];
  const [row] = await db
    .select({
      publishedOnDate: sql<number>`count(*) filter (
        where ${documents.uploadedAt} = ${selectedDate}
      )::int`,
      modifiedOnDate: sql<number>`count(*) filter (
        where ${documents.modifiedAt} = ${selectedDate}
          and ${documents.uploadedAt} is distinct from ${selectedDate}
      )::int`,
      undatedStoredCatalog: sql<number>`count(*) filter (
        where nullif(trim(coalesce(${documents.uploadedAt}, '')), '') is null
      )::int`,
      storedCatalogTotal: sql<number>`count(*)::int`,
    })
    .from(documents)
    .where(and(inArray(documents.source, [...sources]), isNull(documents.initiativeCode)));
  return {
    sources,
    publishedOnDate: row?.publishedOnDate ?? 0,
    modifiedOnDate: row?.modifiedOnDate ?? 0,
    undatedStoredCatalog: row?.undatedStoredCatalog ?? 0,
    storedCatalogTotal: row?.storedCatalogTotal ?? 0,
    expectedDailyTotal: null,
    contractNote: CONGRESS_PUBLICATION_NOTE,
  };
}

/**
 * Exact official movements for one selected calendar day and chamber.
 *
 * Only literal `filed_at` values and exact valid SOURCE_HISTORY event dates qualify.
 * Agenda records, title wording and OBSERVED_CHANGE timestamps never manufacture a
 * daily official movement. A same-day Depositado/Depositada history row is suppressed
 * only when that exact initiative already has its explicit FILED movement.
 */
export async function readCongressMovementDay(
  db: Database,
  opts: { date: string; chamber: CongressMovementChamber },
): Promise<CongressMovementDay> {
  assertCongressMovementChamber(opts.chamber);
  assertExactOfficialDate(opts.date);
  const chamberCondition = congressInitiativeChamberIs(opts.chamber);
  const [filedRows, statusRows, availability, publications] = await Promise.all([
    db
      .select({
        initiativeId: initiatives.id,
        code: initiatives.code,
        title: initiatives.title,
        titleEn: currentEnglishInitiativeTitleSql().as("title_en"),
        status: initiatives.status,
        source: initiatives.source,
        sourceUrl: initiatives.sourceUrl,
        observedAt: sql<string>`${initiatives.firstSeenAt}::text`,
      })
      .from(initiatives)
      .where(
        and(
          chamberCondition,
          eq(initiatives.kind, "LEGISLATIVE"),
          eq(initiatives.filedAt, opts.date),
        ),
      ),
    db
      .select({
        id: statusEvents.id,
        initiativeId: initiatives.id,
        code: initiatives.code,
        title: initiatives.title,
        titleEn: currentEnglishInitiativeTitleSql().as("title_en"),
        status: statusEvents.status,
        source: statusEvents.source,
        sourceUrl: statusEvents.sourceUrl,
        sourceEventId: statusEvents.sourceEventId,
        note: statusEvents.note,
        observedAt: sql<string>`${statusEvents.observedAt}::text`,
      })
      .from(statusEvents)
      .innerJoin(initiatives, eq(statusEvents.initiativeId, initiatives.id))
      .where(
        and(
          chamberCondition,
          eq(initiatives.kind, "LEGISLATIVE"),
          eq(statusEvents.evidenceType, "SOURCE_HISTORY"),
          eq(statusEvents.eventDate, opts.date),
          isNull(statusEvents.retiredAt),
        ),
      ),
    congressMovementDateAvailability(db, opts.chamber, opts.date),
    congressPublicationMonitoring(db, opts.chamber, opts.date),
  ]);

  const filedInitiativeIds = filedRows.map((row) => row.initiativeId);
  const filedSet = new Set(filedInitiativeIds);
  const filedMovements: CongressMovement[] = filedRows.map((row) => ({
    kind: "FILED",
    initiativeId: row.initiativeId,
    code: row.code,
    title: row.title,
    titleEn: row.titleEn,
    status: row.status,
    eventDate: opts.date,
    chamber: opts.chamber,
    source: row.source,
    sourceUrl: row.sourceUrl,
    evidenceType: "OFFICIAL_FILED_AT",
    sourceRowCount: 1,
    sourceEventIds: [],
    sourceEventId: null,
    note: null,
    observedAt: row.observedAt,
    documentPublication: {
      status: "UNCONFIRMED",
      checkedAt: null,
      available: false,
      documentId: null,
    },
  }));
  type StatusRow = (typeof statusRows)[number];
  const statusGroups = new Map<string, StatusRow[]>();
  for (const row of statusRows) {
    if (
      filedSet.has(row.initiativeId) &&
      ["depositado", "depositada"].includes(normalizedCongressMovementStatus(row.status))
    ) {
      continue;
    }
    const presentationKey = JSON.stringify([
      opts.chamber,
      row.initiativeId,
      normalizedCongressMovementStatus(row.status),
      opts.date,
      row.source,
    ]);
    const group = statusGroups.get(presentationKey);
    if (group) group.push(row);
    else statusGroups.set(presentationKey, [row]);
  }
  const statusMovements: CongressMovement[] = [...statusGroups.values()].map((group) => {
    const orderedRows = [...group].sort((left, right) => {
      if (left.sourceEventId == null && right.sourceEventId != null) return 1;
      if (left.sourceEventId != null && right.sourceEventId == null) return -1;
      const sourceEvent = (left.sourceEventId ?? "").localeCompare(
        right.sourceEventId ?? "",
        "en",
        { numeric: true },
      );
      return sourceEvent || left.id - right.id;
    });
    const row = orderedRows[0]!;
    const sourceEventIds = [
      ...new Set(
        orderedRows.flatMap((candidate) =>
          candidate.sourceEventId == null ? [] : [candidate.sourceEventId],
        ),
      ),
    ].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
    const observedAt = orderedRows.reduce(
      (earliest, candidate) =>
        candidate.observedAt.localeCompare(earliest) < 0 ? candidate.observedAt : earliest,
      row.observedAt,
    );
    return {
      kind: "STATUS",
      initiativeId: row.initiativeId,
      code: row.code,
      title: row.title,
      titleEn: row.titleEn,
      status: row.status,
      eventDate: opts.date,
      chamber: opts.chamber,
      source: row.source,
      sourceUrl: row.sourceUrl,
      evidenceType: "SOURCE_HISTORY",
      sourceRowCount: orderedRows.length,
      sourceEventIds,
      sourceEventId: row.sourceEventId,
      note: row.note,
      observedAt,
      documentPublication: {
        status: "UNCONFIRMED",
        checkedAt: null,
        available: false,
        documentId: null,
      },
    };
  });
  const orderedMovements = [...filedMovements, ...statusMovements].sort(compareCongressMovements);
  const [documentPublications, depositedPdfs] = await Promise.all([
    congressMovementDocumentPublications(
      db,
      opts.chamber,
      orderedMovements.map((movement) => movement.initiativeId),
    ),
    congressDepositedPdfMonitoring(db, opts.chamber, filedInitiativeIds),
  ]);
  const movements = orderedMovements.map((movement) => ({
    ...movement,
    documentPublication:
      documentPublications.get(movement.initiativeId) ??
      (opts.chamber === "SENADO"
        ? {
            status: "UNSUPPORTED" as const,
            checkedAt: null,
            available: false,
            documentId: null,
          }
        : {
            status: "UNCONFIRMED" as const,
            checkedAt: null,
            available: false,
            documentId: null,
          }),
  }));

  return {
    chamber: opts.chamber,
    selectedDate: opts.date,
    ...availability,
    totalMovementCount: movements.length,
    uniqueInitiativeCount: new Set(movements.map((movement) => movement.initiativeId)).size,
    movements,
    depositedPdfs,
    publications,
  };
}

export interface RelatedFeedItem {
  id: number;
  kind: string;
  title: string;
  url: string | null;
  source: string;
  publishedAt: string | null;
  observedAt: string;
}

/** Feed items linked to one initiative (primary or via a tag) — newest first.
 *  Powers the "Noticias relacionadas" section in the initiative detail. */
export async function listFeedForInitiative(
  db: Database,
  initiativeId: number,
  limit = 12,
): Promise<RelatedFeedItem[]> {
  return db
    .select({
      id: feedItems.id,
      kind: feedItems.kind,
      title: feedItems.title,
      url: feedItems.url,
      source: feedItems.source,
      publishedAt: sql<string | null>`${feedItems.publishedAt}::text`,
      observedAt: sql<string>`${feedItems.firstSeenAt}::text`,
    })
    .from(feedItems)
    .where(
      sql`${feedItems.initiativeId} = ${initiativeId} or ${feedItems.id} in (select feed_item_id from feed_item_entities where initiative_id = ${initiativeId})`,
    )
    .orderBy(sql`coalesce(${feedItems.publishedAt}, ${feedItems.firstSeenAt}) desc`)
    .limit(limit);
}

/** Resolve an official bill code → its title (for the feed's active-filter label). */
export async function initiativeByCode(
  db: Database,
  code: string,
): Promise<{ id: number; title: string } | null> {
  const rows = await db
    .select({ id: initiatives.id, title: initiatives.title })
    .from(initiatives)
    .where(eq(initiatives.code, code))
    .limit(2);
  return rows.length === 1 ? rows[0]! : null;
}

/** Resolve a complete official code only when it identifies one initiative in scope. */
export async function uniqueInitiativeIdByCode(
  db: Database,
  code: string,
  chamber?: string,
): Promise<number | null> {
  const where = chamber
    ? and(eq(initiatives.code, code), eq(initiatives.chamber, chamber))
    : eq(initiatives.code, code);
  const rows = await db.select({ id: initiatives.id }).from(initiatives).where(where).limit(2);
  return rows.length === 1 ? rows[0]!.id : null;
}

/**
 * Typeahead search over legislative bills (PDLs) by keyword — matches the bill
 * title or official code. Returns the lightest payload needed to render an
 * autocomplete option and then filter the feed by `code`.
 */
export async function searchInitiatives(
  db: Database,
  query: string,
  opts: { limit?: number } = {},
): Promise<
  Array<{ id: number; code: string; title: string; status: string | null; chamber: string | null }>
> {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const rows = await db
    .select({
      id: initiatives.id,
      code: initiatives.code,
      title: initiatives.title,
      status: initiatives.status,
      chamber: initiatives.chamber,
    })
    .from(initiatives)
    .where(
      and(
        eq(initiatives.kind, "LEGISLATIVE"),
        isNotNull(initiatives.code),
        or(ilike(initiatives.title, like), ilike(initiatives.code, like)),
      ),
    )
    // Surface filed bills first, newest by filing date.
    .orderBy(sql`${initiatives.filedAt} desc nulls last`)
    .limit(opts.limit ?? 8);
  // `code` is non-null here thanks to the WHERE clause.
  return rows as Array<{
    id: number;
    code: string;
    title: string;
    status: string | null;
    chamber: string | null;
  }>;
}

export interface CommissionMemberWithProfile {
  name: string;
  cargo: string | null;
  party: string | null;
  /** Canonical active roster profile, present only after an exact identity join. */
  profileId: number | null;
  source: string | null;
  sourceId: string | null;
}

export interface CommissionWithMembers {
  chamber: string;
  name: string;
  members: CommissionMemberWithProfile[];
  /** Durable internal agenda records attributed only by normalized whole-name equality
   * within the same explicitly published chamber. */
  agendas: CommissionAgendaReference[];
}

export interface CommissionAgendaReference {
  id: number;
  eventDate: string;
  eventTime: string | null;
  kind: string | null;
}

export interface CommissionAgendaCandidate extends CommissionAgendaReference {
  chamber: string | null;
  body: string | null;
}

export type CommissionWithoutAgendas = Omit<CommissionWithMembers, "agendas" | "members"> & {
  /** Identity fields are optional only for pure agenda-linking callers; output normalizes them. */
  members: Array<
    Omit<CommissionMemberWithProfile, "profileId" | "source" | "sourceId"> &
      Partial<Pick<CommissionMemberWithProfile, "profileId" | "source" | "sourceId">>
  >;
};

/** Canonicalize spelling only. Matching still requires equality of the complete result. */
export function normalizedCommissionIdentity(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Attach exact, dated activity rows to roster commissions without substring, fuzzy, or
 * cross-chamber matching. A normalized roster-name collision is deliberately left
 * unresolved: choosing either target would turn a useful link into an unsupported guess.
 */
export function attachExactCommissionAgendas(
  roster: CommissionWithoutAgendas[],
  candidates: CommissionAgendaCandidate[],
): CommissionWithMembers[] {
  // The repository supplies canonical member identities. This pure agenda linker also
  // accepts legacy test/data callers and must preserve their member objects verbatim.
  const result = roster.map((commission) => ({
    ...commission,
    agendas: [],
  })) as CommissionWithMembers[];
  const targetByIdentity = new Map<string, number | null>();

  for (const [index, commission] of result.entries()) {
    const identity = normalizedCommissionIdentity(commission.name);
    if (!identity) continue;
    const key = `${commission.chamber}\u0000${identity}`;
    targetByIdentity.set(key, targetByIdentity.has(key) ? null : index);
  }

  const seenByCommission = new Map<number, Set<number>>();
  for (const candidate of candidates) {
    if (
      !Number.isSafeInteger(candidate.id) ||
      candidate.id < 1 ||
      !candidate.chamber ||
      !candidate.body ||
      !/^\d{4}-\d{2}-\d{2}$/.test(candidate.eventDate)
    ) {
      continue;
    }
    const identity = normalizedCommissionIdentity(candidate.body);
    if (!identity) continue;
    const index = targetByIdentity.get(`${candidate.chamber}\u0000${identity}`);
    if (typeof index !== "number") continue;

    const seen = seenByCommission.get(index) ?? new Set<number>();
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    seenByCommission.set(index, seen);
    result[index]!.agendas.push({
      id: candidate.id,
      eventDate: candidate.eventDate,
      eventTime: candidate.eventTime,
      kind: candidate.kind,
    });
  }

  for (const commission of result) {
    commission.agendas.sort(
      (a, b) =>
        b.eventDate.localeCompare(a.eventDate) ||
        (b.eventTime ?? "").localeCompare(a.eventTime ?? "") ||
        b.id - a.id,
    );
    commission.agendas = commission.agendas.slice(0, 6);
  }
  return result;
}

/** Every committee with its full membership (president/VP/secretary/members), grouped. */
export async function commissionsWithMembers(
  db: Database,
  opts: { chamber?: string } = {},
): Promise<CommissionWithMembers[]> {
  const where = opts.chamber
    ? and(eq(commissionMembers.active, true), eq(commissionMembers.chamber, opts.chamber))
    : eq(commissionMembers.active, true);
  const agendaWhere = and(
    eq(activityEvents.scope, "COMMITTEE"),
    isNotNull(activityEvents.body),
    isNotNull(activityEvents.eventDate),
    ...(opts.chamber ? [eq(activityEvents.chamber, opts.chamber)] : []),
  );
  const [rows, agendaRows] = await Promise.all([
    db
      .select({
        chamber: commissionMembers.chamber,
        name: commissionMembers.commissionName,
        memberName: commissionMembers.legislatorName,
        cargo: commissionMembers.cargo,
        party: commissionMembers.party,
        profileId: legislators.id,
        profileSource: legislators.source,
        profileSourceId: legislators.sourceId,
      })
      .from(commissionMembers)
      .leftJoin(
        legislators,
        and(
          eq(legislators.active, true),
          eq(legislators.source, commissionMembers.source),
          eq(legislators.chamber, commissionMembers.chamber),
          eq(legislators.sourceId, commissionMembers.legislatorSourceId),
        ),
      )
      .where(where)
      .orderBy(commissionMembers.chamber, commissionMembers.commissionName),
    db
      .select({
        id: activityEvents.id,
        chamber: activityEvents.chamber,
        body: activityEvents.body,
        eventDate: activityEvents.eventDate,
        eventTime: activityEvents.eventTime,
        kind: activityEvents.kind,
      })
      .from(activityEvents)
      .where(agendaWhere)
      .orderBy(sql`${activityEvents.eventDate} desc`, activityEvents.id),
  ]);

  // Officers first (Presidente, Vicepresidente, Secretario), then plain members A→Z.
  const rank = (c: string | null) =>
    c === "Presidente" ? 0 : c === "Vicepresidente" ? 1 : c === "Secretario" ? 2 : 3;
  const byCommission = new Map<string, CommissionWithoutAgendas>();
  for (const r of rows) {
    const key = `${r.chamber}::${r.name}`;
    const entry = byCommission.get(key) ?? { chamber: r.chamber, name: r.name, members: [] };
    entry.members.push({
      name: r.memberName,
      cargo: r.cargo,
      party: r.party,
      profileId: r.profileId,
      source: r.profileSource,
      sourceId: r.profileSourceId,
    });
    byCommission.set(key, entry);
  }
  const out = [...byCommission.values()];
  for (const c of out) {
    c.members.sort((a, b) => rank(a.cargo) - rank(b.cargo) || a.name.localeCompare(b.name));
  }
  return attachExactCommissionAgendas(
    out,
    agendaRows.map((row) => ({
      id: row.id,
      chamber: row.chamber,
      body: row.body,
      // The query excludes null dates; keep the narrow public type honest without
      // weakening the database-level fail-closed condition.
      eventDate: row.eventDate!,
      eventTime: row.eventTime,
      kind: row.kind,
    })),
  );
}

/** Full roster grouped by province → { diputados, senadores }, keyed by raw province name. */
export async function rosterByProvince(
  db: Database,
): Promise<Array<{ province: string | null; member: RosterMember }>> {
  const rows = await listLegislators(db);
  return rows.map((member) => ({ province: member.province, member }));
}
