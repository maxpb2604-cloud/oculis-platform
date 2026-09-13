import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  adminSessionCookieOptions,
  authenticateAdmin,
  createAdminSessionToken,
} from "@/lib/admin-auth";
import { requestHasSameOrigin, sameOriginRedirectUrl } from "@/lib/admin-api";
import {
  CLIENT_SESSION_COOKIE,
  authenticateClient,
  clientSessionCookieOptions,
  createClientSessionToken,
} from "@/lib/client-auth";

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
  return current.count > 8;
}

export async function POST(request: NextRequest) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Origen de solicitud no permitido." }, { status: 403 });
  }
  const form = await request.formData();
  const lang = form.get("lang") === "en" ? "en" : "es";
  const suffix = lang === "en" ? "?lang=en" : "";
  if (form.get("intent") === "logout") {
    const response = NextResponse.redirect(sameOriginRedirectUrl(request, `/login${suffix}`), 303);
    response.cookies.set(ADMIN_SESSION_COOKIE, "", { ...adminSessionCookieOptions, maxAge: 0 });
    response.cookies.set(CLIENT_SESSION_COOKIE, "", { ...clientSessionCookieOptions, maxAge: 0 });
    return response;
  }
  const failure = sameOriginRedirectUrl(request, `/login?error=1${lang === "en" ? "&lang=en" : ""}`);
  if (limited(request)) return NextResponse.redirect(failure, 303);
  const email = typeof form.get("email") === "string" ? String(form.get("email")) : "";
  const password = typeof form.get("password") === "string" ? String(form.get("password")) : "";
  if (email.length > 254 || password.length < 12 || password.length > 256) {
    return NextResponse.redirect(failure, 303);
  }
  try {
    const admin = await authenticateAdmin(email, password);
    if (admin) {
      attempts.delete(clientKey(request));
      const response = NextResponse.redirect(sameOriginRedirectUrl(request, `/admin${suffix}`), 303);
      response.cookies.set(
        ADMIN_SESSION_COOKIE,
        createAdminSessionToken(admin),
        adminSessionCookieOptions,
      );
      response.cookies.set(CLIENT_SESSION_COOKIE, "", { ...clientSessionCookieOptions, maxAge: 0 });
      return response;
    }
    const client = await authenticateClient(email, password);
    if (client) {
      attempts.delete(clientKey(request));
      const response = NextResponse.redirect(sameOriginRedirectUrl(request, `/cliente${suffix}`), 303);
      response.cookies.set(
        CLIENT_SESSION_COOKIE,
        createClientSessionToken(client),
        clientSessionCookieOptions,
      );
      response.cookies.set(ADMIN_SESSION_COOKIE, "", { ...adminSessionCookieOptions, maxAge: 0 });
      return response;
    }
  } catch {
    // Keep authentication failure generic; do not reveal account existence or role.
  }
  return NextResponse.redirect(failure, 303);
}
