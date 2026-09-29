#!/usr/bin/env node

import {
  acquireMaintenanceLock,
  configureSerialization,
  inspectCompatibleSchema,
  verifyDatabaseParity,
  verifyOwnedSequences,
} from "./db-transfer/core.mjs";
import {
  acquireOfflinePgliteSource,
  openTransferConnections,
  parseCommonArguments,
  requireDestinationUrl,
  safeErrorMessage,
} from "./db-transfer/cli.mjs";

const HELP = `
Verify a completed Oculis PGlite -> PostgreSQL migration

Required environment:
  SRC_PGLITE_DIR     Offline PGlite data directory (or use --source)
  DEST_DATABASE_URL  Target PostgreSQL URL; never printed by this command

Usage:
  npm run db:verify:pglite -- --source .data/pglite-snapshot

The verifier compares every public base table using its row count and two
order-independent 64-bit checksum accumulators. It also verifies each owned
sequence's collision-safe next value against the source. Nothing is modified.
`;

async function main() {
  const options = parseCommonArguments(process.argv.slice(2));
  if (options.help) {
    console.log(HELP.trim());
    return;
  }
  if (options.execute || options.bootstrapSchema) {
    throw new Error("The verifier is read-only; --execute and --bootstrap-schema are invalid.");
  }

  const sourceLease = acquireOfflinePgliteSource(options.source);
  try {
    const destinationUrl = requireDestinationUrl();
    const connections = await openTransferConnections({
      sourceDirectory: sourceLease.directory,
      destinationUrl,
    });
    let sourceTransaction = false;
    let destinationTransaction = false;
    try {
      await connections.source.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      sourceTransaction = true;
      await configureSerialization(connections.source);
      await connections.destination.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      destinationTransaction = true;
      await configureSerialization(connections.destination);
      await acquireMaintenanceLock(connections.destination);

      const schema = await inspectCompatibleSchema(connections.source, connections.destination);
      await verifyDatabaseParity({
        source: connections.source,
        destination: connections.destination,
        tables: schema.tables,
        onProgress(event) {
          console.log(
            `${event.matches ? "Verified" : "Mismatch"} ${event.table}: ${event.rows} rows.`,
          );
        },
      });
      const sequenceCount = await verifyOwnedSequences(
        connections.source,
        connections.destination,
        schema.tables,
      );

      await connections.destination.query("ROLLBACK");
      destinationTransaction = false;
      await connections.source.query("ROLLBACK");
      sourceTransaction = false;
      console.log(
        `Parity verified: ${schema.tables.length} tables and ${sequenceCount} owned sequences match.`,
      );
    } finally {
      if (destinationTransaction) {
        await connections.destination.query("ROLLBACK").catch(() => {});
      }
      if (sourceTransaction) {
        await connections.source.query("ROLLBACK").catch(() => {});
      }
      await connections.close();
    }
  } finally {
    sourceLease.release();
  }
}

main().catch((error) => {
  console.error(`Verification failed: ${safeErrorMessage(error)}`);
  process.exitCode = 1;
});
