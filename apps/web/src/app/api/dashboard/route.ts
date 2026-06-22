import { NextResponse } from "next/server";
import { getDashboardData } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/dashboard — aggregated metrics for the dashboard (KPIs + breakdowns). */
export async function GET() {
  const data = await getDashboardData();
  return NextResponse.json(data, {
    headers: { "cache-control": "no-store" },
  });
}
