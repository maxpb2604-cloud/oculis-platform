import pg from "pg";

const healthUrl = process.env.OCULIS_HEALTH_URL || "http://127.0.0.1:3000/api/health";
const readyUrl = process.env.OCULIS_READY_URL || "http://127.0.0.1:3000/api/ready";
const databaseUrl = process.env.DATABASE_URL;
const expectedRelease = process.env.GITHUB_SHA?.trim();
const minimumInitiatives = Number(process.env.OCULIS_MIN_READY_INITIATIVES);

if (!databaseUrl?.startsWith("postgresql://")) {
  throw new Error("DATABASE_URL must point to persistent PostgreSQL");
}
if (!Number.isSafeInteger(minimumInitiatives) || minimumInitiatives < 1) {
  throw new Error("OCULIS_MIN_READY_INITIATIVES must be a positive integer");
}
if (!expectedRelease || !/^[0-9a-f]{40}$/.test(expectedRelease)) {
  throw new Error("GITHUB_SHA must identify the active 40-character release");
}

async function fetchStatus(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.json();
    return { body, response };
  } finally {
    clearTimeout(timeout);
  }
}

{
  const { body, response } = await fetchStatus(healthUrl);
  if (!response.ok) throw new Error(`web health returned HTTP ${response.status}`);
  if (
    body?.status !== "ok" ||
    body?.service !== "oculis-web" ||
    body?.release !== expectedRelease
  ) {
    throw new Error("web health returned an unexpected payload");
  }
}

{
  const { body, response } = await fetchStatus(readyUrl);
  if (!response.ok) throw new Error(`web readiness returned HTTP ${response.status}`);
  if (
    body?.status !== "ready" ||
    body?.service !== "oculis-web" ||
    body?.database !== "postgresql"
  ) {
    throw new Error("web readiness returned an unexpected payload");
  }
}

const client = new pg.Client({
  application_name: "oculis-systemd-health",
  connectionString: databaseUrl,
  connectionTimeoutMillis: 8_000,
  query_timeout: 8_000,
});
try {
  await client.connect();
  const result = await client.query("select 1 as healthy");
  if (result.rows[0]?.healthy !== 1) throw new Error("PostgreSQL returned an unexpected result");
  const content = await client.query("select count(*)::bigint as count from initiatives");
  const initiatives = Number(content.rows[0]?.count ?? 0);
  if (!Number.isSafeInteger(initiatives) || initiatives < minimumInitiatives) {
    throw new Error(
      `essential data gate failed: initiatives=${initiatives}, required=${minimumInitiatives}`,
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
} finally {
  await client.end().catch(() => undefined);
}

console.log(`${new Date().toISOString()} Oculis health and readiness checks passed`);
