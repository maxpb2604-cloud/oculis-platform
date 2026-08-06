/**
 * Ingest regulatory instruments from the institution adapters into the `regulations`
 * table (the regulatory twin of initiatives). Per-source isolation + health rows so a
 * single institution's failure never aborts the run.
 */
import { beginIngestionRun, recordIngestionRun, upsertRegulation, type Database } from "@oculis/db";
import { regulatoryAdapters } from "@oculis/scrapers";

export interface RegulatorySummary {
  source: string;
  institution: string;
  ok: boolean;
  outcome: "COMPLETE" | "PARTIAL" | "FAILED";
  count: number;
  inserted: number;
  consultas: number;
  gaps: string[];
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
    const runId = await beginIngestionRun(db, adapter.source, {
      institution: adapter.institution,
    });
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
          sourceCategory: r.sourceCategory,
          isConsulta: r.isConsulta,
          publishedAt: r.publishedAt,
          deadline: r.deadline,
          url: r.url,
          raw: r.raw as object,
        });
        if (res.inserted) inserted++;
      }
      const outcome = gaps.length ? "PARTIAL" : "COMPLETE";
      const ok = outcome === "COMPLETE";
      await recordIngestionRun(db, {
        source: adapter.source,
        runId,
        seen: regulations.length,
        inserted,
        ok,
        outcome,
        details: gaps.length ? { gaps } : null,
      });
      log(
        `  ${ok ? "✔" : "⚠"} ${regulations.length} norms (${inserted} new, ${consultas} consultas)`,
      );
      gaps.forEach((gap) => log(`    ⚠ ${gap}`));
      out.push({
        source: adapter.source,
        institution: adapter.institution,
        ok,
        outcome,
        count: regulations.length,
        inserted,
        consultas,
        gaps,
      });
    } catch (err) {
      const error = (err as Error).message;
      await recordIngestionRun(db, {
        runId,
        source: adapter.source,
        ok: false,
        error,
      });
      log(`  ✖ FAILED: ${error}`);
      out.push({
        source: adapter.source,
        institution: adapter.institution,
        ok: false,
        outcome: "FAILED",
        count: 0,
        inserted: 0,
        consultas: 0,
        gaps: [],
        error,
      });
    }
  }
  return out;
}
