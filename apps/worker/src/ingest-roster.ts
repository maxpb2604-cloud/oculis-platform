/**
 * Ingest the full elected-legislator roster (both chambers) into `legislators` and the
 * committee composition into `commission_members`. This is what makes the map and the
 * /congreso page show every senator and deputy by province — not just bill sponsors.
 *
 * Two adapters: Diputados (SIL JSON API) and Senado (HTML). Each is isolated and records
 * its own health row so one chamber failing never aborts the other.
 */
import {
  recordIngestionRun,
  upsertCommissionMember,
  upsertLegislator,
  type Database,
} from "@oculis/db";
import {
  DiputadosRosterAdapter,
  SenadoRosterAdapter,
  type RosterResult,
} from "@oculis/scrapers";

export interface RosterSummary {
  source: string;
  ok: boolean;
  legislators: number;
  memberships: number;
  gaps: string[];
  error?: string;
}

type Log = (m: string) => void;

async function persist(db: Database, r: RosterResult): Promise<void> {
  for (const l of r.legislators) {
    await upsertLegislator(db, {
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
    });
  }
  for (const m of r.memberships) {
    await upsertCommissionMember(db, {
      source: m.source,
      chamber: m.chamber,
      commissionName: m.commissionName,
      commissionSourceId: m.commissionSourceId,
      legislatorName: m.legislatorName,
      legislatorSourceId: m.legislatorSourceId,
      cargo: m.cargo,
      party: m.party,
      sourceUrl: m.sourceUrl,
    });
  }
}

async function runOne(
  db: Database,
  source: string,
  collect: () => Promise<RosterResult>,
  log: Log,
): Promise<RosterSummary> {
  log(`\n▶ ${source}`);
  try {
    const r = await collect();
    await persist(db, r);
    await recordIngestionRun(db, {
      source,
      seen: r.legislators.length,
      inserted: r.legislators.length,
      ok: true,
      details: r.gaps.length ? { gaps: r.gaps } : null,
    });
    log(`  ✔ ${r.legislators.length} legisladores, ${r.memberships.length} membresías de comisión`);
    r.gaps.forEach((g) => log(`    ⚠ ${g}`));
    return { source, ok: true, legislators: r.legislators.length, memberships: r.memberships.length, gaps: r.gaps };
  } catch (err) {
    const error = (err as Error).message;
    await recordIngestionRun(db, { source, ok: false, error });
    log(`  ✖ FAILED: ${error}`);
    return { source, ok: false, legislators: 0, memberships: 0, gaps: [], error };
  }
}

export async function ingestRoster(db: Database, opts: { log?: Log } = {}): Promise<RosterSummary[]> {
  const log = opts.log ?? (() => {});
  return [
    await runOne(db, "roster-diputados", () => new DiputadosRosterAdapter().collect(), log),
    await runOne(db, "roster-senado", () => new SenadoRosterAdapter().collect(), log),
  ];
}
