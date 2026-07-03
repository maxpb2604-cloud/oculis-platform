import { NextRequest, NextResponse } from "next/server";
import { getFeed } from "@/lib/data";
import type { FeedCursor } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/feed?cursorAt=&cursorId=&kind=&category=&... — a page of feed items. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit") ?? 25) || 25, 100);
  const filters = {
    kind: sp.get("kind") ?? undefined,
    category: sp.get("category") ?? undefined,
    chamber: sp.get("chamber") ?? undefined,
    initiativeCode: sp.get("initiativeCode") ?? undefined,
    legislatorSourceId: sp.get("legislatorSourceId") ?? undefined,
    commissionName: sp.get("commissionName") ?? undefined,
    search: sp.get("search") ?? undefined,
  };
  // Cursor params end up in SQL casts (`::timestamp`, integer compare) — validate
  // them and silently fall back to the first page on garbage instead of 500ing.
  // Accepts what the cursor itself emits: "YYYY-MM-DD HH:MM:SS[.ffffff][tz]" (or T).
  const TS_RE =
    /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?( ?([zZ]|[+-]\d{2}(:?\d{2})?))?)?$/;
  const cAt = sp.get("cursorAt");
  const cIdRaw = sp.get("cursorId");
  const cId = cIdRaw && /^\d+$/.test(cIdRaw) ? Number(cIdRaw) : NaN;
  const cursor: FeedCursor | null =
    cAt && TS_RE.test(cAt) && Number.isSafeInteger(cId) && cId > 0
      ? { publishedAt: cAt, id: cId }
      : null;

  const { items, nextCursor } = await getFeed(filters, { limit, cursor });
  return NextResponse.json({ items, nextCursor }, { headers: { "cache-control": "no-store" } });
}
