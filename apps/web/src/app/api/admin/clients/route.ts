import { NextResponse, type NextRequest } from "next/server";
import { adminApiError, authorizedAdminRequest } from "@/lib/admin-api";
import { createAdminClient } from "@/lib/data";

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function POST(request: NextRequest) {
  const auth = await authorizedAdminRequest(request);
  if (auth.error) return auth.error;
  try {
    const body = (await request.json()) as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.replace(/\s+/g, " ").trim() : "";
    if (name.length < 2 || name.length > 120) {
      return NextResponse.json(
        { error: "El nombre debe tener entre 2 y 120 caracteres." },
        { status: 400 },
      );
    }
    const client = await createAdminClient({ name, slug: slugify(name) });
    return NextResponse.json({ client }, { status: 201 });
  } catch (error) {
    return adminApiError(error, "No se pudo crear el cliente.");
  }
}
