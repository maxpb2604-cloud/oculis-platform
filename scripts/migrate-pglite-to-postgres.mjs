#!/usr/bin/env node

import { migrateDatabase } from "./db-transfer/core.mjs";
import {
  acquireOfflinePgliteSource,
  bootstrapDestinationSchema,
  formatCountSummary,
  openTransferConnections,
  parseCommonArguments,
  requireDestinationUrl,
  safeErrorMessage,
} from "./db-transfer/cli.mjs";

const HELP = `
Complete Oculis PGlite -> PostgreSQL migration

Required environment:
  SRC_PGLITE_DIR     Offline PGlite data directory (or use --source)
  DEST_DATABASE_URL  Target PostgreSQL URL; never printed by this command

Usage:
  npm run db:migrate:pglite -- --dry-run
  npm run db:migrate:pglite -- --execute --bootstrap-schema

Options:
  --source <path>       Override SRC_PGLITE_DIR
  --batch-size <1-5000> Rows fetched per batch (default: 50)
  --max-batch-bytes <n> Maximum JSON payload per insert (default: 2097152)
  --dry-run             Validate schemas/counts only; this is the default
  --execute             Copy all public tables atomically and verify them
  --bootstrap-schema    Apply the current idempotent Oculis schema first
  -h, --help            Show this help

Safety:
  * The source must be an initialized, offline PGlite directory; this command
    holds its exclusive Oculis lock for the entire operation.
  * --bootstrap-schema only accepts a PostgreSQL database with no user objects.
  * The destination application tables must be empty.
  * No table is truncated and no existing row is merged or overwritten.
  * Data is committed only after every table fingerprint matches.
`;

function createProgressReporter(batchSize) {
  const expectedRows = new Map();
  const lastReported = new Map();
  return (event) => {
    if (event.phase === "plan") {
      for (const [table, count] of event.plan.sourceCounts) expectedRows.set(table, count);
      console.log(`Schema compatible: ${formatCountSummary(event.plan.sourceCounts)}.`);
      console.log(`Foreign-key-safe copy order: ${event.plan.copyOrder.join(" -> ")}`);
      if (event.plan.extraDestinationTables.length > 0) {
        console.log(
          `Destination-only tables left untouched: ${event.plan.extraDestinationTables.join(", ")}`,
        );
      }
    } else if (event.phase === "copy") {
      const expected = expectedRows.get(event.table) ?? 0;
      const previous = lastReported.get(event.table) ?? 0;
      const reportEvery = Math.max(batchSize * 20, 5_000);
      if (event.rows === expected || event.rows - previous >= reportEvery) {
        console.log(`Copied ${event.table}: ${event.rows}/${expected} rows.`);
        lastReported.set(event.table, event.rows);
      }
      if (event.oversizedRow) {
        console.warn(
          `Warning: one ${event.table} row required ${event.batchBytes} bytes; transferred alone.`,
        );
      }
    } else if (event.phase === "verify") {
      console.log(`${event.matches ? "Verified" : "Mismatch"} ${event.table}: ${event.rows} rows.`);
    }
  };
}

async function main() {
  const options = parseCommonArguments(process.argv.slice(2));
  if (options.help) {
    console.log(HELP.trim());
    return;
  }
  if (options.execute && options.dryRun) {
    throw new Error("Choose either --execute or --dry-run, not both.");
  }
  const execute = options.execute === true;
  if (!execute && options.bootstrapSchema) {
    throw new Error("--bootstrap-schema changes PostgreSQL and therefore requires --execute.");
  }

  const sourceLease = acquireOfflinePgliteSource(options.source);
  try {
    const destinationUrl = requireDestinationUrl();
    if (options.bootstrapSchema) {
      console.log("Preflighting a pristine PostgreSQL database, then bootstrapping schema...");
      await bootstrapDestinationSchema(destinationUrl);
    }

    console.log(execute ? "Starting atomic data transfer..." : "Starting read-only dry run...");
    const connections = await openTransferConnections({
      sourceDirectory: sourceLease.directory,
      destinationUrl,
    });
    try {
      const result = await migrateDatabase({
        source: connections.source,
        destination: connections.destination,
        batchSize: options.batchSize,
        maxBatchBytes: options.maxBatchBytes,
        dryRun: !execute,
        onProgress: createProgressReporter(options.batchSize),
      });
      if (result.dryRun) {
        console.log(
          `Dry run passed: ${formatCountSummary(result.plan.sourceCounts)} are ready to transfer. ` +
            "Re-run with --execute to migrate.",
        );
      } else {
        console.log(
          `Migration committed: ${result.copiedRows.toLocaleString("en-US")} rows across ` +
            `${result.plan.tables.length} tables; ${result.resetSequences} sequences reset and verified.`,
        );
      }
    } finally {
      await connections.close();
    }
  } finally {
    sourceLease.release();
  }
}

main().catch((error) => {
  console.error(`Migration failed safely: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
