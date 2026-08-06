/**
 * One-off migration: copy all data from the file-backed PGlite dev DB into the
 * standalone PostgreSQL server — no re-scraping of the government API.
 *
 * Usage:
 *   SRC_PGLITE_DIR=.data/pglite DEST_DATABASE_URL=postgres://user@localhost:5433/oculis \
 *     tsx src/migrate-to-postgres.ts
 */
import { loadEnv } from "./env.js";
import { createDb, initiatives, statusEvents } from "@oculis/db";

loadEnv();

const SRC = process.env.SRC_PGLITE_DIR || ".data/pglite";
const DEST = process.env.DEST_DATABASE_URL || process.env.DATABASE_URL;
if (!DEST) {
  console.error("Set DEST_DATABASE_URL (or DATABASE_URL).");
  process.exit(1);
}

// --- read everything from PGlite ---
delete process.env.DATABASE_URL;
process.env.PGLITE_DIR = SRC;
const src = createDb();
await src.ensureSchema();
const inits = await src.db.select().from(initiatives);
const events = await src.db.select().from(statusEvents);
await src.close();
console.log(
  `read from PGlite: ${inits.length} initiatives, ${events.length} official status events`,
);

// --- write into Postgres (remap serial ids) ---
process.env.DATABASE_URL = DEST;
delete process.env.PGLITE_DIR;
const dest = createDb();
await dest.ensureSchema();

const idMap = new Map<number, number>();
for (const row of inits) {
  const { id, ...rest } = row;
  const [ins] = await dest.db
    .insert(initiatives)
    .values(rest)
    .onConflictDoNothing({ target: [initiatives.source, initiatives.sourceId] })
    .returning({ id: initiatives.id });
  if (ins) idMap.set(id, ins.id);
}
for (const e of events) {
  const newId = idMap.get(e.initiativeId);
  if (!newId) continue;
  const { id, initiativeId, ...rest } = e;
  await dest.db
    .insert(statusEvents)
    .values({ ...rest, initiativeId: newId })
    .onConflictDoNothing();
}
await dest.close();
console.log(`✔ migrated ${idMap.size} initiatives into Postgres.`);
