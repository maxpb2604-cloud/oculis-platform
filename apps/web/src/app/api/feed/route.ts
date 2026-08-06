import { NextRequest, NextResponse } from "next/server";
import { getFeed } from "@/lib/data";
import type { FeedCursor } from "@/lib/data";
import { boundedInteger, isISOTimestamp, optionalText, positiveInteger } from "@/lib/input";
import { apiError, PRIVATE_READ_CACHE } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/feed?cursorAt=&cursorId=&kind=&... — source-attributed feed facts. */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const limit = boundedInteger(sp.get("limit"), { fallback: 25, min: 1, max: 100 });
    const filters = {
      kind: optionalText(sp.get("kind"), 32),
      chamber: optionalText(sp.get("chamber"), 32),
      initiativeCode: optionalText(sp.get("initiativeCode"), 80),
      legislatorSourceId: optionalText(sp.get("legislatorSourceId"), 80),
      commissionName: optionalText(sp.get("commissionName"), 160),
      search: optionalText(sp.get("search"), 160),
    };
    const cAt = sp.get("cursorAt");
    const cId = sp.get("cursorId");
    const parsedCursorId = positiveInteger(cId);
    if ((cAt || cId) && (!isISOTimestamp(cAt) || parsedCursorId == null)) {
      return NextResponse.json({ error: "invalid_cursor" }, { status: 400 });
    }
    const cursor: FeedCursor | null =
      cAt && parsedCursorId ? { sortAt: cAt, id: parsedCursorId } : null;

    const { items, nextCursor } = await getFeed(filters, { limit, cursor });
    return NextResponse.json(
      { items, nextCursor },
      { headers: { "cache-control": PRIVATE_READ_CACHE } },
    );
  } catch (error) {
    return apiError(req, error, "feed");
  }
}
