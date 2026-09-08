export const dynamic = "force-dynamic";

/**
 * Process liveness only. Keeping this endpoint independent from PostgreSQL lets the
 * free web service and the serverless database sleep when nobody is using Oculis.
 * Source/database freshness remains visible on /estado-fuentes.
 */
export async function GET() {
  const release = process.env.RENDER_GIT_COMMIT?.trim() || process.env.GITHUB_SHA?.trim();

  return Response.json(
    {
      status: "ok",
      service: "oculis-web",
      ...(release ? { release } : {}),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
