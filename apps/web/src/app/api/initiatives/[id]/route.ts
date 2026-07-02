import { NextRequest, NextResponse } from "next/server";
import { getInitiative } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/initiatives/:id — one initiative with its status timeline + score inputs. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const ini = await getInitiative(numId);
  if (!ini) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(ini, { headers: { "cache-control": "no-store" } });
}
