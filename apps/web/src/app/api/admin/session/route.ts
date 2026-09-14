import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, adminSessionCookieOptions } from "@/lib/admin-auth";
import { requestHasSameOrigin, sameOriginRedirectUrl } from "@/lib/admin-api";

/** Legacy endpoint: authentication now happens only through the landing's portal form. */
export async function POST(request: NextRequest) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Origen de solicitud no permitido." }, { status: 403 });
  }
  const form = await request.formData();
  const suffix = form.get("lang") === "en" ? "?lang=en" : "";
  return NextResponse.redirect(sameOriginRedirectUrl(request, `/${suffix}#acceso`), 303);
}

export async function DELETE(request: NextRequest) {
  if (!requestHasSameOrigin(request)) {
    return NextResponse.json({ error: "Origen de solicitud no permitido." }, { status: 403 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", { ...adminSessionCookieOptions, maxAge: 0 });
  return response;
}
