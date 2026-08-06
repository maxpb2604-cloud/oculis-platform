import { NextRequest, NextResponse } from "next/server";
import { searchBills } from "@/lib/data";
import { optionalText } from "@/lib/input";
import { apiError, PRIVATE_READ_CACHE } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/feed/bills?q=keyword — bill (PDL) options for the feed typeahead. */
export async function GET(req: NextRequest) {
  try {
    const raw = req.nextUrl.searchParams.get("q");
    if (raw && raw.length > 160) {
      return NextResponse.json({ error: "query_too_long" }, { status: 400 });
    }
    const q = optionalText(raw, 160) ?? "";
    if (q.length < 2) {
      return NextResponse.json(
        { items: [] },
        { headers: { "cache-control": PRIVATE_READ_CACHE } },
      );
    }
    const items = await searchBills(q);
    return NextResponse.json(
      { items },
      { headers: { "cache-control": PRIVATE_READ_CACHE } },
    );
  } catch (error) {
    return apiError(req, error, "feed-bills");
  }
}
