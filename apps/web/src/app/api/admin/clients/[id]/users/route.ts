import { NextResponse, type NextRequest } from "next/server";
import { adminApiError, authorizedAdminRequest } from "@/lib/admin-api";
import { hashPortalPassword } from "@/lib/admin-auth";
import { createAdminClientUser } from "@/lib/data";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizedAdminRequest(request);
  if (auth.error) return auth.error;
  const clientId = Number((await params).id);
  if (!Number.isSafeInteger(clientId) || clientId <= 0) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }
  try {
    const body = (await request.json()) as {
      email?: unknown;
      displayName?: unknown;
      password?: unknown;
    };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const displayName =
      typeof body.displayName === "string" ? body.displayName.replace(/\s+/g, " ").trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^\S+@\S+\.\S+$/.test(email) || displayName.length < 2 || displayName.length > 100) {
      return NextResponse.json({ error: "Nombre o correo no válido." }, { status: 400 });
    }
    if (password.length < 12 || password.length > 256) {
      return NextResponse.json(
        { error: "La contraseña temporal debe tener entre 12 y 256 caracteres." },
        { status: 400 },
      );
    }
    const user = await createAdminClientUser({
      clientId,
      email,
      displayName,
      passwordHash: hashPortalPassword(password),
    });
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return adminApiError(error, "No se pudo agregar el usuario.");
  }
}
