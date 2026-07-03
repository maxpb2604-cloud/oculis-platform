import { NextRequest, NextResponse } from "next/server";
import { resolveLegislator } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/legislators/resolve?sourceId=&name=&chamber= — one legislator's full
 * profile (with committee seats) for the click-to-open bubble. Resolves by sourceId
 * (reliable) or by name (accent-insensitive, then trigram-fuzzy for misspellings).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sourceId = sp.get("sourceId")?.trim() || null;
  const name = sp.get("name")?.trim() || null;
  const chamber = sp.get("chamber")?.trim() || null;
  if (!sourceId && !name) {
    return NextResponse.json({ error: "missing_query" }, { status: 400 });
  }
  const profile = await resolveLegislator({ sourceId, name, chamber });
  if (!profile) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(profile, { headers: { "cache-control": "no-store" } });
}
