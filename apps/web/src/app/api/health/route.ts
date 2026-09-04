export const dynamic = "force-dynamic";

/**
 * Process liveness only. Keeping this endpoint independent from PostgreSQL lets the
 * free web service and the serverless database sleep when nobody is using Oculis.
 * Source/database freshness remains visible on /estado-fuentes.
 */
export async function GET() {
  return Response.json(
    {
      status: "ok",
      service: "oculis-web",
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
