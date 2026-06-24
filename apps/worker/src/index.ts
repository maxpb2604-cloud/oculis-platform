/**
 * Worker CLI entrypoint — runs an ingestion cycle.
 *
 * Usage:
 *   npm run ingest -w @oculis/worker -- [--limit N] [--enrich] [--delay MS]
 *   npm run ingest:demo -w @oculis/worker        # 25 records, enriched, into PGlite
 *
 * DB target: set DATABASE_URL for Postgres/RDS; otherwise an in-memory PGlite is used
 * (set PGLITE_DIR to persist to disk).
 */
import { createDb } from "@oculis/db";
import { loadEnv } from "./env.js";
import { ingestSilDiputados } from "./ingest.js";
import { ingestActivity } from "./ingest-activity.js";
import { ingestDocuments, fetchDocumentFiles } from "./ingest-documents.js";
import { ingestRegulatory } from "./ingest-regulatory.js";
import { ingestDeposits, ingestSenateDeposits } from "./ingest-deposits.js";
import { runDaily } from "./daily.js";
import { rescoreAll } from "./rescore.js";

loadEnv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const limit = arg("limit") ? Number(arg("limit")) : undefined;
  const maxPagesPerSlice = arg("pages") ? Number(arg("pages")) : undefined;
  const concurrency = arg("concurrency") ? Number(arg("concurrency")) : undefined;
  const enrich = flag("enrich");
  const delayMs = arg("delay") ? Number(arg("delay")) : enrich ? 150 : 0;

  const target = process.env.DATABASE_URL
    ? "Postgres (DATABASE_URL)"
    : process.env.PGLITE_DIR
      ? `PGlite (file: ${process.env.PGLITE_DIR})`
      : "PGlite (in-memory)";
  console.log(`▶ Oculis ingestion — source: sil-diputados → ${target}`);
  console.log(
    `  limit=${limit ?? "all"} pagesPerSlice=${maxPagesPerSlice ?? "all"} ` +
      `enrich=${enrich} delay=${delayMs}ms\n`,
  );

  const { db, ensureSchema, close } = createDb();
  const started = Date.now();
  try {
    await ensureSchema();

    if (flag("regulatory")) {
      console.log("🏛  Ingesting regulatory instruments (institutions)\n");
      const r = await ingestRegulatory(db, { log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const ok = r.filter((s) => s.ok).length;
      const total = r.reduce((n, s) => n + s.count, 0);
      const consultas = r.reduce((n, s) => n + s.consultas, 0);
      console.log(`\n✔ done in ${secs}s — sources ok ${ok}/${r.length}, norms ${total}, consultas ${consultas}`);
      return;
    }

    if (flag("documents")) {
      console.log("📎 Ingesting official initiative documents (metadata + URLs)\n");
      const r = await ingestDocuments(db, { limit, log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `\n✔ done in ${secs}s — ${r.initiatives} initiatives, ${r.documents} docs (${r.newDocuments} new)`,
      );
      return;
    }

    if (flag("fetch-docs")) {
      console.log("⬇  Downloading official PDFs → storage backend\n");
      const r = await fetchDocumentFiles(db, { limit, log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `\n✔ done in ${secs}s — backend ${r.backend}: stored ${r.stored}, skipped ${r.skipped}, failed ${r.failed} of ${r.attempted}`,
      );
      return;
    }

    if (flag("deposits")) {
      console.log("📥 Syncing recent deposits (initiatives + documents)\n");
      const sinceDays = arg("since-days") ? Number(arg("since-days")) : undefined;
      const r = await ingestDeposits(db, { sinceDays, log: (m) => console.log(m) });
      const sen = await ingestSenateDeposits(db, { sinceDays, log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `\n✔ done in ${secs}s — Diputados ${r.deposits} deposits (${r.inserted} new), ` +
          `${r.documents} new docs · Senado ${sen.deposits} deposits (${sen.inserted} new)`,
      );
      return;
    }

    if (flag("daily")) {
      console.log("🗓  FHC daily monitoring — both chambers\n");
      const summaries = await runDaily(db, { log: (m) => console.log(m) });
      // Deposits sync runs as part of the daily pass so "depositadas hoy" stays fresh —
      // both chambers (Diputados via SIL API, Senado via the legacy MasterLex SIL).
      const dep = await ingestDeposits(db, { log: (m) => console.log(m) });
      const senDep = await ingestSenateDeposits(db, { log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const okCount = summaries.filter((s) => s.ok).length + (dep.ok ? 1 : 0) + (senDep.ok ? 1 : 0);
      const totalEvents = summaries.reduce((n, s) => n + s.events, 0);
      const totalGaps = summaries.reduce((n, s) => n + s.gaps.length, 0);
      console.log(
        `\n✔ daily done in ${secs}s — sources ok ${okCount}/${summaries.length + 2}, ` +
          `events ${totalEvents}, deposits ${dep.deposits}+${senDep.deposits} (Dip+Sen), flagged gaps ${totalGaps}`,
      );
      return;
    }

    if (flag("activity")) {
      console.log("📅 Ingesting committee + plenary agenda activity\n");
      const r = await ingestActivity(db, { log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `\n✔ done in ${secs}s — seen ${r.seen} (committee ${r.committee}, plenary ${r.plenary}), ` +
          `new ${r.inserted}, initiative links ${r.linkedCodes}`,
      );
      return;
    }

    if (flag("rescore")) {
      console.log("↻ Re-scoring existing initiatives (no scraping)\n");
      const r = await rescoreAll(db, { log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `\n✔ rescored ${r.scored} in ${secs}s — risk spread: ${JSON.stringify(r.byRisk)}`,
      );
      return;
    }

    const summary = await ingestSilDiputados(db, {
      limit,
      maxPagesPerSlice,
      enrich,
      concurrency,
      delayMs,
      log: (m) => console.log(m),
    });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `\n✔ done in ${secs}s — seen ${summary.seen}, inserted ${summary.inserted}, ` +
        `updated ${summary.updated}, status-changes ${summary.statusChanges}, ` +
        `categorized ${summary.categorized}, total in DB ${summary.total}`,
    );
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error("ingestion failed:", err);
  process.exit(1);
});
