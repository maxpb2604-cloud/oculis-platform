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
  const cAt = sp.get("cursorAt");
  const cId = sp.get("cursorId");
  const cursor: FeedCursor | null = cAt && cId ? { publishedAt: cAt, id: Number(cId) } : null;

  const { items, nextCursor } = await getFeed(filters, { limit, cursor });
  return NextResponse.json({ items, nextCursor }, { headers: { "cache-control": "no-store" } });
}
