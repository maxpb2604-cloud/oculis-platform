import { NextRequest, NextResponse } from "next/server";
import { getInitiatives } from "@/lib/data";
import { boundedInteger } from "@/lib/input";
import { apiError, PRIVATE_READ_CACHE } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/initiatives?limit= — source-backed initiative facts as JSON. */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const limit = boundedInteger(sp.get("limit"), { fallback: 50, min: 1, max: 500 });
    const data = await getInitiatives({ limit });
    return NextResponse.json(
      { count: data.length, data },
      { headers: { "cache-control": PRIVATE_READ_CACHE } },
    );
  } catch (error) {
    return apiError(req, error, "initiatives");
  }
}
