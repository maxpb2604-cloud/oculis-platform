/**
 * Worker CLI entrypoint — runs an ingestion cycle.
 *
 * Usage:
 *   npm run ingest -w @oculis/worker -- [--limit N] [--enrich] [--delay MS]
 *   npm run publications -w @oculis/worker -- [--limit N] [--full]
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
import { ingestRoster } from "./ingest-roster.js";
import { ingestMovements } from "./ingest-movements.js";
import { ingestCongressPublications } from "./ingest-congress-publications.js";
import { ingestFeed } from "./ingest-feed.js";
import { seedFeedAccounts } from "./feed-accounts.seed.js";
import { numericArg } from "./cli.js";
import {
  assertRequiredSourcesOk,
  assertSourcesOk,
  REQUIRED_SOURCE_SETS,
  type SourceResult,
} from "./reliability.js";

loadEnv();

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const limit = numericArg(process.argv, "limit", { min: 1 });
  const maxPagesPerSlice = numericArg(process.argv, "pages", { min: 1 });
  const concurrency = numericArg(process.argv, "concurrency", { min: 1 });
  const enrich = flag("enrich");
  const delayMs = numericArg(process.argv, "delay", { min: 0 }) ?? (enrich ? 150 : 0);

  const target = process.env.DATABASE_URL
    ? "Postgres (DATABASE_URL)"
    : process.env.PGLITE_DIR
      ? `PGlite (file: ${process.env.PGLITE_DIR})`
      : "PGlite (in-memory)";
  console.log(`▶ Oculis ingestion → ${target}`);
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
      const mark = ok === r.length ? "✔" : "⚠";
      console.log(
        `\n${mark} done in ${secs}s — sources ok ${ok}/${r.length}, norms ${total}, consultas ${consultas}`,
      );
      // Known external blockers remain recorded by ingestRegulatory, but only sources
      // declared operational and required in SOURCE_REGISTRY fail the whole job.
      assertRequiredSourcesOk("regulatory ingestion", r, REQUIRED_SOURCE_SETS.regulatory);
      return;
    }

    if (flag("documents")) {
      console.log("📎 Ingesting official initiative documents (metadata + URLs)\n");
      const r = await ingestDocuments(db, { limit, log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `\n${r.ok ? "✔" : "⚠"} done in ${secs}s — ${r.initiatives} initiatives, ` +
          `${r.documents} docs (${r.newDocuments} new), ${r.failures} failures`,
      );
      assertSourcesOk("document metadata ingestion", [r]);
      return;
    }

    if (flag("fetch-docs")) {
      console.log("⬇  Downloading official PDFs → storage backend\n");
      const r = await fetchDocumentFiles(db, { limit, log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `\n✔ done in ${secs}s — backend ${r.backend}: stored ${r.stored}, skipped ${r.skipped}, failed ${r.failed} of ${r.attempted}`,
      );
      if (r.failed > 0)
        throw new Error(`document fetch: ${r.failed} of ${r.attempted} download(s) failed`);
      return;
    }

    if (flag("senate-corpus")) {
      console.log("🏛  Ingesting the complete configured Senate collection\n");
      const result = await ingestSenateDeposits(db, {
        fullCollection: true,
        log: (message) => console.log(message),
      });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `\n${result.ok ? "✔" : "⚠"} done in ${secs}s — ` +
          `${result.deposits} rows, ${result.inserted} new, ${result.rejected} rejected`,
      );
      assertSourcesOk("Senate corpus ingestion", [result]);
      return;
    }

    if (flag("deposits")) {
      console.log("📥 Syncing recent deposits (initiatives + documents)\n");
      const sinceDays = numericArg(process.argv, "since-days", { min: 0 });
      const r = await ingestDeposits(db, { sinceDays, log: (m) => console.log(m) });
      const sen = await ingestSenateDeposits(db, { sinceDays, log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const mark = r.ok && sen.ok ? "✔" : "⚠";
      console.log(
        `\n${mark} done in ${secs}s — Diputados ${r.deposits} deposits (${r.inserted} new), ` +
          `${r.documents} new docs · Senado ${sen.deposits} deposits (${sen.inserted} new)`,
      );
      assertSourcesOk("deposits ingestion", [r, sen]);
      return;
    }

    if (flag("daily")) {
      console.log("🗓  FHC daily monitoring — both chambers\n");
      // Ingest deposits first so agenda rows collected immediately afterward can resolve
      // their exact initiative codes in the same run.
      const dep = await ingestDeposits(db, { log: (m) => console.log(m) });
      const senDep = await ingestSenateDeposits(db, { log: (m) => console.log(m) });
      const summaries = await runDaily(db, { log: (m) => console.log(m) });
      // Feed refresh (news / official / social / legislative signals) on the same cadence.
      const feed = await ingestFeed(db, { log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const sourceResults: SourceResult[] = [...summaries, dep, senDep, ...feed];
      const okCount = sourceResults.filter((s) => s.ok).length;
      const totalEvents = summaries.reduce((n, s) => n + s.events, 0);
      const totalGaps = summaries.reduce((n, s) => n + s.gaps.length, 0);
      const feedItems = feed.reduce((n, s) => n + s.count, 0);
      const feedInserted = feed.reduce((n, s) => n + s.inserted, 0);
      const mark = okCount === sourceResults.length ? "✔" : "⚠";
      console.log(
        `\n${mark} daily done in ${secs}s — sources ok ${okCount}/${sourceResults.length}, ` +
          `events ${totalEvents}, deposits ${dep.deposits}+${senDep.deposits} (Dip+Sen), ` +
          `feed ${feedItems} (${feedInserted} new), flagged gaps ${totalGaps}`,
      );
      assertRequiredSourcesOk("daily ingestion", sourceResults, REQUIRED_SOURCE_SETS.daily);
      return;
    }

    if (flag("roster")) {
      console.log("🏛  Ingesting legislator roster + committee membership (both chambers)\n");
      const summaries = await ingestRoster(db, { log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const ok = summaries.filter((s) => s.ok).length;
      const legs = summaries.reduce((n, s) => n + s.legislators, 0);
      const mem = summaries.reduce((n, s) => n + s.memberships, 0);
      const mark = ok === summaries.length ? "✔" : "⚠";
      console.log(
        `\n${mark} done in ${secs}s — sources ok ${ok}/${summaries.length}, legisladores ${legs}, membresías ${mem}`,
      );
      assertSourcesOk("roster ingestion", summaries);
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

    if (flag("movements")) {
      console.log("↻ Refreshing official SIL status histories\n");
      const r = await ingestMovements(db, {
        limit,
        concurrency,
        delayMs,
        log: (m) => console.log(m),
      });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `\n${r.ok ? "✔" : "⚠"} done in ${secs}s — checked ${r.checked}/${r.initiatives}, ` +
          `official events ${r.statusEventsSeen} (${r.statusEventsInserted} new), failures ${r.failures}`,
      );
      assertSourcesOk("status-movement ingestion", [r]);
      return;
    }

    if (flag("publications")) {
      const full = flag("full");
      console.log(
        `📚 Ingesting official congressional publications (${full ? "full PDF sweep" : "recent PDF slice"})\n`,
      );
      const summaries = await ingestCongressPublications(db, {
        full,
        pdfLimitPerSource: limit,
        log: (message) => console.log(message),
      });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const documents = summaries.reduce((sum, row) => sum + row.seen, 0);
      const changes = summaries.reduce((sum, row) => sum + row.statusChanges, 0);
      const complete = summaries.filter((row) => row.ok).length;
      console.log(
        `\n${complete === summaries.length ? "✔" : "⚠"} done in ${secs}s — ` +
          `${complete}/${summaries.length} fuentes completas, ${documents} documentos observados, ` +
          `${changes} eventos de estado nuevos`,
      );
      assertRequiredSourcesOk(
        "congressional publications ingestion",
        summaries,
        REQUIRED_SOURCE_SETS.publications,
      );
      return;
    }

    if (flag("feed")) {
      console.log("📰 Ingesting Congress feed (news + official + social + legislative signals)\n");
      const r = await ingestFeed(db, { log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      const ok = r.filter((s) => s.ok).length;
      const total = r.reduce((n, s) => n + s.count, 0);
      const inserted = r.reduce((n, s) => n + s.inserted, 0);
      const mark = ok === r.length ? "✔" : "⚠";
      console.log(
        `\n${mark} done in ${secs}s — sources ok ${ok}/${r.length}, items ${total} (${inserted} new)`,
      );
      assertRequiredSourcesOk("feed ingestion", r, REQUIRED_SOURCE_SETS.feed);
      return;
    }

    if (flag("seed-accounts")) {
      console.log("👥 Seeding the verified institutional account directory\n");
      const r = await seedFeedAccounts(db, { log: (m) => console.log(m) });
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `\n✔ done in ${secs}s — ${r.total} verified accounts ` +
          `(${r.linked} linked to legislators, ${r.deactivated} legacy entries disabled)`,
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
      `\n${summary.ok ? "✔" : "⚠"} done in ${secs}s — seen ${summary.seen}, ` +
        `inserted ${summary.inserted}, updated ${summary.updated}, ` +
        `official status changes ${summary.statusChanges}, enrichment failures ` +
        `${summary.enrichmentFailures}, total in DB ${summary.total}`,
    );
    assertSourcesOk("SIL corpus ingestion", [summary]);
  } finally {
    await close();
  }
}

main().catch((err) => {
  console.error("ingestion failed:", err);
  process.exit(1);
});
