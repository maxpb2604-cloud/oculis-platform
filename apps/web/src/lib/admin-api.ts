import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { getAdminSession, type AdminSession } from "@/lib/admin-auth";

function configuredPublicOrigin(): string | null | undefined {
  const configuredUrl = process.env.OCULIS_PUBLIC_URL?.trim();
  const externalUrl =
    configuredUrl ||
    (process.env.RENDER === "true" ? process.env.RENDER_EXTERNAL_URL?.trim() : undefined);
  if (!externalUrl) return undefined;

  try {
    const parsed = new URL(externalUrl);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

export function requestHasSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const suppliedOrigin = new URL(origin).origin;
    // A reverse proxy may expose an internal request URL to Next.js. Trust only the
    // explicitly configured public URL, never an arbitrary forwarded host. Render's
    // assigned URL remains a compatibility fallback for the legacy deployment.
    const publicOrigin = configuredPublicOrigin();
    if (publicOrigin === null) return false;
    return publicOrigin === undefined
      ? suppliedOrigin === new URL(request.url).origin
      : suppliedOrigin === publicOrigin;
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
