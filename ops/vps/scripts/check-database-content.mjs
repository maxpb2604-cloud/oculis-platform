import pg from "pg";

const mode = process.argv[2] || "--assert-content";
if (mode !== "--state" && mode !== "--assert-content") {
  throw new Error("usage: check-database-content.mjs {--state|--assert-content}");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl?.startsWith("postgresql://")) {
  throw new Error("DATABASE_URL must point to persistent PostgreSQL");
}

const configuredMinimum = Number(process.env.OCULIS_MIN_READY_INITIATIVES);
if (!Number.isSafeInteger(configuredMinimum) || configuredMinimum < 1) {
  throw new Error("OCULIS_MIN_READY_INITIATIVES must be a positive integer");
}

const client = new pg.Client({
  application_name: "oculis-database-content-gate",
  connectionString: databaseUrl,
  connectionTimeoutMillis: 10_000,
  query_timeout: 15_000,
});

const requiredRelations = [
  "initiatives",
  "status_events",
  "documents",
  "regulations",
  "legislators",
  "portal_users",
  "ingestion_runs",
];

try {
  await client.connect();
  const relation = await client.query(
    `select relation, to_regclass('public.' || relation) is not null as present
     from unnest($1::text[]) as relation`,
    [requiredRelations],
  );
  const present = new Set(
    relation.rows.filter((row) => row.present === true).map((row) => String(row.relation)),
  );
  const initialized = present.size === requiredRelations.length;
  if (mode === "--state") {
    process.stdout.write(initialized ? "initialized" : present.size === 0 ? "empty" : "partial");
  } else {
    if (!initialized) {
      const missing = requiredRelations.filter((relationName) => !present.has(relationName));
      throw new Error(`Oculis schema is incomplete; missing: ${missing.join(", ")}`);
    }
    const result = await client.query("select count(*)::bigint as count from initiatives");
    const initiatives = Number(result.rows[0]?.count ?? 0);
    if (!Number.isSafeInteger(initiatives) || initiatives < configuredMinimum) {
      throw new Error(
        `essential data gate failed: initiatives=${initiatives}, required=${configuredMinimum}`,
      );
    }
    const admin = await client.query(
      `select exists(
         select 1 from portal_users
         where role = 'ADMIN' and active = true and password_hash is not null
       ) as present`,
    );
    if (admin.rows[0]?.present !== true) {
      throw new Error("essential data gate failed: active administrator is unavailable");
    }
    console.log(`essential data gate passed: initiatives=${initiatives}, active_admin=true`);
  }
} finally {
  await client.end().catch(() => undefined);
}
