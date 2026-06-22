import { NextRequest, NextResponse } from "next/server";
import { getInitiatives } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/initiatives?limit=&category=&risk= — initiative records as JSON. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 50) || 50, 500);
  const category = sp.get("category") ?? undefined;
  const risk = sp.get("risk") ?? undefined;
  const data = await getInitiatives({ limit, category, risk });
  return NextResponse.json(
    { count: data.length, data },
    { headers: { "cache-control": "no-store" } },
  );
}
