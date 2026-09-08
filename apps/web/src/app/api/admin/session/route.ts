import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  authenticateAdmin,
  createAdminSessionToken,
} from "@/lib/admin-auth";
import { requestHasSameOrigin } from "@/lib/admin-api";

const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function limited(request: NextRequest, now = Date.now()): boolean {
  const key = clientKey(request);
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return false;
  }
  current.count += 1;
  attempts.set(key, current);
  return current.count > 8;
}

export async function POST(request: NextRequest) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Origen de solicitud no permitido." }, { status: 403 });
  }
  const form = await request.formData();
  const lang = form.get("lang") === "en" ? "en" : "es";
  const loginUrl = new URL(`/admin/login?error=1${lang === "en" ? "&lang=en" : ""}`, request.url);
  if (limited(request)) return NextResponse.redirect(loginUrl, 303);
  const email = typeof form.get("email") === "string" ? String(form.get("email")) : "";
  const password = typeof form.get("password") === "string" ? String(form.get("password")) : "";
  try {
    const user = await authenticateAdmin(email, password);
    if (!user) return NextResponse.redirect(loginUrl, 303);
    attempts.delete(clientKey(request));
    const response = NextResponse.redirect(
      new URL(`/admin${lang === "en" ? "?lang=en" : ""}`, request.url),
      303,
    );
    response.cookies.set(
      ADMIN_SESSION_COOKIE,
      createAdminSessionToken(user),
      adminSessionCookieOptions,
    );
    return response;
  } catch {
    return NextResponse.redirect(loginUrl, 303);
  }
}

export async function DELETE(request: NextRequest) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Origen de solicitud no permitido." }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", { ...adminSessionCookieOptions, maxAge: 0 });
  return response;
}
