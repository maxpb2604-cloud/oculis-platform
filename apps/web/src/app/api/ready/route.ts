import { createDb } from "@oculis/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

function configuredInitiativeFloor(): bigint | null {
  const raw = process.env.OCULIS_MIN_READY_INITIATIVES?.trim() || "1";
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

/**
 * Deployment readiness. Unlike /api/health (process liveness), this endpoint proves
 * that the production PostgreSQL database accepts a query. It never returns connection
 * details or database contents.
 */
export async function GET() {
  if (!process.env.DATABASE_URL?.trim()) {
    return Response.json(
      { status: "unavailable", service: "oculis-web", database: "unavailable" },
      { status: 503, headers },
    );
  }

  const initiativeFloor = configuredInitiativeFloor();
  if (initiativeFloor === null) {
    return Response.json(
      { status: "unavailable", service: "oculis-web", database: "unavailable" },
      { status: 503, headers },
    );
  }

  let handle: ReturnType<typeof createDb> | undefined;
  try {
    handle = createDb();
    const result = await handle.db.execute(sql`
      select
        count(*)::text as initiative_count,
        exists(
          select 1
          from portal_users
          where role = 'ADMIN' and active = true and password_hash is not null
        ) as has_active_admin
      from initiatives
    `);
    const readiness = result.rows[0] as
      | { initiative_count?: unknown; has_active_admin?: unknown }
      | undefined;
    const initiativeCount =
      typeof readiness?.initiative_count === "string" && /^\d+$/.test(readiness.initiative_count)
        ? BigInt(readiness.initiative_count)
        : null;
    if (
      initiativeCount === null ||
      initiativeCount < initiativeFloor ||
      readiness?.has_active_admin !== true
    ) {
      throw new Error("Required production data is not ready");
    }
    return Response.json(
      { status: "ready", service: "oculis-web", database: "postgresql" },
      { headers },
    );
  } catch {
    return Response.json(
      { status: "unavailable", service: "oculis-web", database: "unavailable" },
      { status: 503, headers },
    );
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
