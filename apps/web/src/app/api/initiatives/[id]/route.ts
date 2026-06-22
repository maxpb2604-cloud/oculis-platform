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
  const ini = await getInitiative(Number(id));
  if (!ini) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(ini, { headers: { "cache-control": "no-store" } });
}
