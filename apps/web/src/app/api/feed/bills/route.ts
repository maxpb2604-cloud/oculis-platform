import { NextRequest, NextResponse } from "next/server";
import { searchBills } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/feed/bills?q=keyword — bill (PDL) options for the feed typeahead. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 2) {
    return NextResponse.json({ items: [] }, { headers: { "cache-control": "no-store" } });
  }
  const items = await searchBills(q);
  return NextResponse.json({ items }, { headers: { "cache-control": "no-store" } });
}
