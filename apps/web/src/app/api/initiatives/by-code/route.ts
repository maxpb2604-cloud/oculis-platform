import { NextRequest, NextResponse } from "next/server";
import { getInitiativeDetailByCode } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/initiatives/by-code?code=XYZ — the same rich detail as /api/initiatives/:id
 * but resolved from the official code. Powers "click an agenda initiative → bubble",
 * where the UI holds codes rather than ids. Code is a query param (not a path segment)
 * so hyphenated codes never trip route parsing.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim();
  if (!code) return NextResponse.json({ error: "missing_code" }, { status: 400 });
  const ini = await getInitiativeDetailByCode(code);
  if (!ini) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(ini, { headers: { "cache-control": "no-store" } });
}
