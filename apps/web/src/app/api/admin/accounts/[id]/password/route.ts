import { NextResponse, type NextRequest } from "next/server";
import { authorizedAdminRequest, adminApiError } from "@/lib/admin-api";
import { hashPortalPassword } from "@/lib/admin-auth";
import { changePortalUserPassword } from "@/lib/data";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizedAdminRequest(request);
  if (auth.error) return auth.error;
  const userId = Number((await params).id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Cuenta inválida." }, { status: 400 });
  }
  try {
    const body = (await request.json()) as { password?: unknown };
    const password = typeof body.password === "string" ? body.password : "";
    if (password.length < 12 || password.length > 256) {
      return NextResponse.json(
        { error: "La nueva contraseña debe tener entre 12 y 256 caracteres." },
        { status: 400 },
      );
    }
    const account = await changePortalUserPassword({
      userId,
      passwordHash: hashPortalPassword(password),
    });
    if (!account) return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });
    return NextResponse.json({ account: { id: account.id, role: account.role } });
  } catch (error) {
    return adminApiError(error, "No se pudo cambiar la contraseña.");
  }
}
