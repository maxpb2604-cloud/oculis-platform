# Complete PGlite to PostgreSQL transfer

These commands replace the legacy two-table migrator for deployments that need
the complete Oculis database. They discover every public base table, preserve
primary keys and relationships, reset owned sequences, and verify row-level
fingerprints before committing.

## Safety contract

- Stop every process using the source PGlite directory first. The command
  canonicalizes and validates the data directory, then owns the same exclusive
  `.oculis.lock` for the entire operation.
- Use a fresh destination database. Existing application rows are never
  truncated, merged, updated, or overwritten.
- `--bootstrap-schema` performs a strict pristine-database preflight and aborts
  if it finds any user schema, relation, function, type, or extension.
- Keep `DEST_DATABASE_URL` in the environment or a protected environment file;
  do not put it in a command argument or commit it.
- Take a filesystem snapshot/backup of PGlite before the cutover.
- Keep the web application stopped until the post-migration verifier passes.

## Cutover

```bash
export SRC_PGLITE_DIR=/absolute/path/to/offline-pglite-snapshot
export DEST_DATABASE_URL='postgresql://...'

# Read-only schema/count preflight. This is also the default without flags.
npm run db:migrate:pglite -- --dry-run

# Create the current schema, transfer every source table atomically, reset
# sequences, and commit only after all fingerprints match.
npm run db:migrate:pglite -- --execute --bootstrap-schema

# Independent read-only verification after the commit.
npm run db:verify:pglite
```

If PostgreSQL only listens on the VPS loopback interface, run the commands
through a temporary SSH tunnel and point `DEST_DATABASE_URL` to that tunnel.
Do not expose PostgreSQL port 5432 publicly.

## What is verified

- Exact source/destination column compatibility for every source table.
- Foreign-key-safe table order.
- A maintenance advisory lock plus bounded PostgreSQL lock wait.
- Stable UTC/ISO/hex serialization settings on both database sessions.
- Exact row counts plus two order-independent 64-bit checksum accumulators for
  every row of every table.
- Collision-safe preservation of each source sequence's next value using
  transactional `ALTER SEQUENCE ... RESTART WITH`.
- A populated destination aborts before copying, and any copy/verification
  failure rolls back the entire destination transaction.

Run the isolated regression test with:

```bash
npm run test:db-migration
```

CI can additionally exercise a native PostgreSQL server. The database name and
explicit acknowledgement are both guarded so this cannot target Oculis:

```bash
export OCULIS_TEST_POSTGRES_URL='postgresql://.../oculis_migration_test_ci'
export OCULIS_ALLOW_NATIVE_DB_TEST=1
npm run test:db-migration:native
```
