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
  error?: string;
}

type Log = (m: string) => void;

/** Cardinality canaries: reject partial/changed source payloads before they corrupt roster state. */
export const ROSTER_MINIMUMS: Readonly<Record<string, number>> = {
  "roster-diputados": 150,
  "roster-senado": 30,
};

export function rosterMinimumError(source: string, count: number): string | null {
  const minimum = ROSTER_MINIMUMS[source];
  return minimum !== undefined && count < minimum
    ? `${source}: ${count} legisladores recolectados; mínimo seguro ${minimum}`
    : null;
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

async function runOne(
  db: Database,
  source: string,
  collect: () => Promise<RosterResult>,
  log: Log,
): Promise<RosterSummary> {
  log(`\n▶ ${source}`);
  const runId = await beginIngestionRun(db, source);
  try {
    const r = await collect();
    const cardinalityError =
      rosterMinimumError(source, r.legislators.length) ??
      (r.memberships.length === 0
        ? `${source}: la fuente devolvió 0 membresías de comisión`
        : null);
    if (cardinalityError) {
      const gaps = [...r.gaps, cardinalityError];
      await recordIngestionRun(db, {
        source,
        runId,
        seen: r.legislators.length,
        ok: false,
        error: cardinalityError,
        details: { gaps },
      });
      log(`  ✖ FAILED: ${cardinalityError} — lote descartado sin persistir`);
      r.gaps.forEach((g) => log(`    ⚠ ${g}`));
      return {
        source,
        ok: false,
        outcome: "FAILED",
        legislators: r.legislators.length,
        memberships: r.memberships.length,
        gaps,
        error: cardinalityError,
      };
    }
    await persist(db, source, r);
    const outcome = r.gaps.length ? "PARTIAL" : "COMPLETE";
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
      details: r.gaps.length ? { gaps: r.gaps } : null,
    });
    log(
      `  ${outcome === "COMPLETE" ? "✔" : "⚠"} ${r.legislators.length} legisladores, ${r.memberships.length} membresías de comisión`,
    );
    r.gaps.forEach((g) => log(`    ⚠ ${g}`));
    return {
      source,
      ok,
      outcome,
      legislators: r.legislators.length,
      memberships: r.memberships.length,
      gaps: r.gaps,
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
    await runOne(db, "roster-diputados", () => new DiputadosRosterAdapter().collect(), log),
    await runOne(db, "roster-senado", () => new SenadoRosterAdapter().collect(), log),
  ];
}
