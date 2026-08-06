import { NextRequest, NextResponse } from "next/server";
import { getDashboardData } from "@/lib/data";
import { apiError, PRIVATE_READ_CACHE } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/dashboard — aggregated metrics for the dashboard (KPIs + breakdowns). */
export async function GET(req: NextRequest) {
  try {
    const data = await getDashboardData();
    return NextResponse.json(data, {
      headers: { "cache-control": PRIVATE_READ_CACHE },
    });
  } catch (error) {
    return apiError(req, error, "dashboard");
  }
}
