/**
 * Ingest regulatory instruments from the institution adapters into the `regulations`
 * table (the regulatory twin of initiatives). Per-source isolation + health rows so a
 * single institution's failure never aborts the run.
 */
import { recordIngestionRun, upsertRegulation, type Database } from "@oculis/db";
import { regulatoryAdapters } from "@oculis/scrapers";

export interface RegulatorySummary {
  source: string;
  institution: string;
  ok: boolean;
  count: number;
  inserted: number;
  consultas: number;
  error?: string;
}

export async function ingestRegulatory(
  db: Database,
  opts: { log?: (m: string) => void } = {},
): Promise<RegulatorySummary[]> {
  const log = opts.log ?? (() => {});
  const out: RegulatorySummary[] = [];

  for (const adapter of regulatoryAdapters()) {
    log(`\n▶ ${adapter.source} (${adapter.institution})`);
    try {
      const { regulations, gaps } = await adapter.collect();
      let inserted = 0;
      let consultas = 0;
      for (const r of regulations) {
        if (r.isConsulta) consultas++;
        const res = await upsertRegulation(db, {
          source: r.source,
          sourceId: r.sourceId,
          institution: r.institution,
          regType: r.regType,
          title: r.title,
          status: r.status,
          interventionLevel: r.interventionLevel,
          category: r.category,
          isConsulta: r.isConsulta,
          publishedAt: r.publishedAt,
          deadline: r.deadline,
          url: r.url,
          raw: r.raw as object,
        });
        if (res.inserted) inserted++;
      }
      await recordIngestionRun(db, {
        source: adapter.source,
        seen: regulations.length,
        inserted,
        ok: true,
        details: gaps.length ? { gaps } : null,
      });
      log(`  ✔ ${regulations.length} norms (${inserted} new, ${consultas} consultas)`);
      out.push({ source: adapter.source, institution: adapter.institution, ok: true, count: regulations.length, inserted, consultas });
    } catch (err) {
      const error = (err as Error).message;
      await recordIngestionRun(db, { source: adapter.source, ok: false, error });
      log(`  ✖ FAILED: ${error}`);
      out.push({ source: adapter.source, institution: adapter.institution, ok: false, count: 0, inserted: 0, consultas: 0, error });
    }
  }
  return out;
}
