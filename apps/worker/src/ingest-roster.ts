/**
 * Ingest the full elected-legislator roster (both chambers) into `legislators` and the
 * committee composition into `commission_members`. This is what makes the map and the
 * /congreso page show every senator and deputy by province — not just bill sponsors.
 *
 * Two adapters: Diputados (SIL JSON API) and Senado (HTML). Each is isolated and records
 * its own health row so one chamber failing never aborts the other.
 */
import {
  beginIngestionRun,
  recordIngestionRun,
  replaceRosterSnapshot,
  type Database,
  type NewCommissionMember,
  type NewLegislator,
} from "@oculis/db";
import { DiputadosRosterAdapter, SenadoRosterAdapter, type RosterResult } from "@oculis/scrapers";

export interface RosterSummary {
  source: string;
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  legislators: number;
  memberships: number;
  gaps: string[];
  coverageNotes: string[];
  error?: string;
}

export interface RosterGapAssessment {
  outcome: "COMPLETE" | "PARTIAL";
  gaps: string[];
  coverageNotes: string[];
}

type Log = (m: string) => void;

/** Cardinality canaries: reject partial/changed source payloads before they corrupt roster state. */
export const ROSTER_MINIMUMS: Readonly<Record<string, number>> = {
  "roster-diputados": 150,
  "roster-senado": 32,
};

export function rosterMinimumError(source: string, count: number): string | null {
  if (source === "roster-senado" && count !== 32) {
    return `roster-senado: ${count} legisladores recolectados; cardinalidad segura exacta 32`;
  }
  const minimum = ROSTER_MINIMUMS[source];
  return minimum !== undefined && count < minimum
    ? `${source}: ${count} legisladores recolectados; mínimo seguro ${minimum}`
    : null;
}

const SENATE_ROSTER_NO_EFFECTIVE_DATE =
  "roster-senado: el listado HTML de comisiones no publica una fecha exacta de vigencia; no se infiere ni se fabrica una.";
const SENATE_ROSTER_EXACT_UNRESOLVED_COVERAGE =
  "roster-senado: 50 de 251 membresías no tienen una coincidencia exacta y única de nombre; legislatorSourceId queda null.";
const SENATE_ROSTER_AUDITED_COVERAGE = new Set([
  SENATE_ROSTER_NO_EFFECTIVE_DATE,
  SENATE_ROSTER_EXACT_UNRESOLVED_COVERAGE,
]);

function hasExactAuditedSenateCoverage(reportedGaps: readonly string[]): boolean {
  return (
    reportedGaps.length === SENATE_ROSTER_AUDITED_COVERAGE.size &&
    reportedGaps.every((gap) => SENATE_ROSTER_AUDITED_COVERAGE.has(gap)) &&
    new Set(reportedGaps).size === SENATE_ROSTER_AUDITED_COVERAGE.size
  );
}

/**
 * Reject any Senate payload that is not the exact snapshot audited against the official
 * pages. This runs before `replaceRosterSnapshot`, so a truncated or structurally changed
 * response cannot deactivate any member or committee seat from the last valid snapshot.
 */
export function rosterSnapshotError(source: string, result: RosterResult): string | null {
  const cardinalityError = rosterMinimumError(source, result.legislators.length);
  if (cardinalityError) return cardinalityError;
  if (source !== "roster-senado") {
    return result.memberships.length === 0
      ? `${source}: la fuente devolvió 0 membresías de comisión`
      : null;
  }

  const unresolvedMemberships = result.memberships.filter(
    (membership) => !membership.legislatorSourceId,
  ).length;
  const legislatorSourceIds = new Set(
    result.legislators.map((legislator) => legislator.sourceId.trim()),
  );
  const uniqueMemberships = new Set(
    result.memberships.map(
      (membership) =>
        `${membership.source}\u0000${membership.commissionName}\u0000${membership.legislatorName}`,
    ),
  );
  const structurallyValidRows =
    result.legislators.every(
      (legislator) =>
        legislator.source === "roster-senado" &&
        legislator.chamber === "SENADO" &&
        legislator.sourceId.trim().length > 0,
    ) &&
    result.memberships.every(
      (membership) =>
        membership.source === "roster-senado" &&
        membership.chamber === "SENADO" &&
        (!membership.legislatorSourceId ||
          legislatorSourceIds.has(membership.legislatorSourceId.trim())),
    );
  if (
    result.memberships.length !== 251 ||
    unresolvedMemberships !== 50 ||
    legislatorSourceIds.size !== 32 ||
    uniqueMemberships.size !== 251 ||
    !structurallyValidRows ||
    !hasExactAuditedSenateCoverage(result.gaps)
  ) {
    return (
      "roster-senado: snapshot rechazado antes de persistir; " +
      `se observaron ${result.legislators.length} legisladores, ` +
      `${result.memberships.length} membresías, ${unresolvedMemberships} sin coincidencia ` +
      `(${legislatorSourceIds.size}/${uniqueMemberships.size} claves únicas) y ` +
      `${result.gaps.length} notas; se requieren exactamente 32/251/50, claves únicas ` +
      "y las dos notas auditadas"
    );
  }
  return null;
}

/**
 * Keep the two audited upstream limitations visible without treating them as structural
 * drift. The exception applies only to the exact 32/251 snapshot with exactly 50
 * unresolved memberships; every other source message remains a structural gap.
 */
export function classifyRosterGaps(
  source: string,
  counts: { legislators: number; memberships: number; unresolvedMemberships: number },
  reportedGaps: readonly string[],
): RosterGapAssessment {
  const auditedSenateSnapshot =
    source === "roster-senado" &&
    counts.legislators === 32 &&
    counts.memberships === 251 &&
    counts.unresolvedMemberships === 50;
  const coverageNotes = auditedSenateSnapshot
    ? reportedGaps.filter((gap) => SENATE_ROSTER_AUDITED_COVERAGE.has(gap))
    : [];
  const coverageSet = new Set(coverageNotes);
  const gaps = reportedGaps.filter((gap) => !coverageSet.has(gap));
  return {
    outcome: gaps.length ? "PARTIAL" : "COMPLETE",
    gaps,
    coverageNotes,
  };
}

async function persist(db: Database, source: string, r: RosterResult): Promise<void> {
  const legislators: NewLegislator[] = r.legislators.map((l) => ({
    source: l.source,
    sourceId: l.sourceId,
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
    raw: l.raw ?? null,
  }));
  const memberships: NewCommissionMember[] = r.memberships.map((m) => ({
    source: m.source,
    chamber: m.chamber,
    commissionName: m.commissionName,
    commissionSourceId: m.commissionSourceId,
    legislatorName: m.legislatorName,
    legislatorSourceId: m.legislatorSourceId,
    cargo: m.cargo,
    party: m.party,
    sourceUrl: m.sourceUrl,
  }));
  await replaceRosterSnapshot(db, source, legislators, memberships);
}

export async function runRosterSource(
  db: Database,
  source: string,
  collect: () => Promise<RosterResult>,
  log: Log,
): Promise<RosterSummary> {
  log(`\n▶ ${source}`);
  const runId = await beginIngestionRun(db, source);
  try {
    const r = await collect();
    const snapshotError = rosterSnapshotError(source, r);
    if (snapshotError) {
      const gaps = [...r.gaps, snapshotError];
      await recordIngestionRun(db, {
        source,
        runId,
        seen: r.legislators.length,
        ok: false,
        error: snapshotError,
        details: { gaps },
      });
      log(`  ✖ FAILED: ${snapshotError} — lote descartado sin persistir`);
      r.gaps.forEach((g) => log(`    ⚠ ${g}`));
      return {
        source,
        ok: false,
        outcome: "FAILED",
        legislators: r.legislators.length,
        memberships: r.memberships.length,
        gaps,
        coverageNotes: [],
        error: snapshotError,
      };
    }
    await persist(db, source, r);
    const assessment = classifyRosterGaps(
      source,
      {
        legislators: r.legislators.length,
        memberships: r.memberships.length,
        unresolvedMemberships: r.memberships.filter((membership) => !membership.legislatorSourceId)
          .length,
      },
      r.gaps,
    );
    const { outcome, gaps, coverageNotes } = assessment;
    // Cardinality failures return above without replacing the snapshot. Remaining
    // gaps preserve explicit fallback or unmatched evidence without fabricating links.
    const ok = true;
    await recordIngestionRun(db, {
      source,
      runId,
      seen: r.legislators.length,
      inserted: r.legislators.length,
      ok,
      outcome,
      details: gaps.length || coverageNotes.length ? { gaps, coverageNotes } : null,
    });
    log(
      `  ${outcome === "COMPLETE" ? "✔" : "⚠"} ${r.legislators.length} legisladores, ${r.memberships.length} membresías de comisión`,
    );
    gaps.forEach((g) => log(`    ⚠ ${g}`));
    coverageNotes.forEach((note) => log(`    ℹ ${note}`));
    return {
      source,
      ok,
      outcome,
      legislators: r.legislators.length,
      memberships: r.memberships.length,
      gaps,
      coverageNotes,
    };
  } catch (err) {
    const error = (err as Error).message;
    await recordIngestionRun(db, { runId, source, ok: false, error });
    log(`  ✖ FAILED: ${error}`);
    return {
      source,
      ok: false,
      outcome: "FAILED",
      legislators: 0,
      memberships: 0,
      gaps: [],
      coverageNotes: [],
      error,
    };
  }
}

export async function ingestRoster(
  db: Database,
  opts: { log?: Log } = {},
): Promise<RosterSummary[]> {
  const log = opts.log ?? (() => {});
  return [
    await runRosterSource(
      db,
      "roster-diputados",
      () => new DiputadosRosterAdapter().collect(),
      log,
    ),
    await runRosterSource(db, "roster-senado", () => new SenadoRosterAdapter().collect(), log),
  ];
}
