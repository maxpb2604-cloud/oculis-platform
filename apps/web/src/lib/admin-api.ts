import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession, type AdminSession } from "@/lib/admin-auth";

export function requestHasSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const suppliedOrigin = new URL(origin).origin;
    if (suppliedOrigin === new URL(request.url).origin) return true;
    // Render's proxy may expose an internal request URL to Next.js. Trust only
    // Render's own externally assigned URL, never an arbitrary forwarded host.
    const renderUrl = process.env.RENDER === "true" ? process.env.RENDER_EXTERNAL_URL : null;
    return Boolean(renderUrl && suppliedOrigin === new URL(renderUrl).origin);
  } catch {
    return false;
  }
}

export function sameOriginRedirectUrl(request: NextRequest, path: string): URL {
  if (!requestHasSameOrigin(request)) throw new Error("Request origin is not allowed");
  return new URL(path, new URL(request.headers.get("origin")!).origin);
}

export async function authorizedAdminRequest(
  request: NextRequest,
): Promise<{ session: AdminSession; error: null } | { session: null; error: NextResponse }> {
  if (!requestHasSameOrigin(request)) {
    return {
      session: null,
      error: NextResponse.json({ error: "Origen de solicitud no permitido." }, { status: 403 }),
    };
  }
  const session = await getAdminSession();
  if (!session) {
    return {
      session: null,
      error: NextResponse.json({ error: "Sesión administrativa requerida." }, { status: 401 }),
    };
  }
  return { session, error: null };
}

export function adminApiError(error: unknown, fallback: string): NextResponse {
  const message = error instanceof Error ? error.message : fallback;
  const conflict = /unique|already|duplicate/i.test(message);
  return NextResponse.json(
    { error: conflict ? "Ese registro ya existe." : fallback },
    { status: conflict ? 409 : 400 },
  );
}
