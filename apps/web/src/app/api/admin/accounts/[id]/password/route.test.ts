import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { authorizedAdminRequest, changePortalUserPassword, hashPortalPassword } = vi.hoisted(() => ({
  authorizedAdminRequest: vi.fn(),
  changePortalUserPassword: vi.fn(),
  hashPortalPassword: vi.fn(() => "one-way-hash"),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-api", () => ({
  authorizedAdminRequest,
  adminApiError: vi.fn(() => NextResponse.json({ error: "No se pudo cambiar la contraseña." }, { status: 400 })),
}));
vi.mock("@/lib/admin-auth", () => ({ hashPortalPassword }));
vi.mock("@/lib/data", () => ({ changePortalUserPassword }));

import { PATCH } from "./route";

function request(password: string) {
  return new NextRequest("http://localhost:3001/api/admin/accounts/2/password", {
    method: "PATCH",
    headers: { origin: "http://localhost:3001", "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

describe("PATCH /api/admin/accounts/[id]/password", () => {
  beforeEach(() => {
    authorizedAdminRequest.mockReset();
    changePortalUserPassword.mockReset();
    hashPortalPassword.mockClear();
  });

  it("requires an administrator session", async () => {
    authorizedAdminRequest.mockResolvedValue({
      error: NextResponse.json({ error: "Sesión administrativa requerida." }, { status: 401 }),
    });
    const response = await PATCH(request("new-long-password"), { params: Promise.resolve({ id: "2" }) });
    expect(response.status).toBe(401);
    expect(changePortalUserPassword).not.toHaveBeenCalled();
  });

  it("replaces either account type without returning credential material", async () => {
    authorizedAdminRequest.mockResolvedValue({ session: { userId: 1 }, error: null });
    changePortalUserPassword.mockResolvedValue({ id: 2, role: "CLIENT", email: "person@example.test" });
    const response = await PATCH(request("new-long-password"), { params: Promise.resolve({ id: "2" }) });
    expect(response.status).toBe(200);
    expect(changePortalUserPassword).toHaveBeenCalledWith({ userId: 2, passwordHash: "one-way-hash" });
    expect(await response.json()).toEqual({ account: { id: 2, role: "CLIENT" } });
  });

  it("rejects invalid account IDs and short passwords", async () => {
    authorizedAdminRequest.mockResolvedValue({ session: { userId: 1 }, error: null });
    expect((await PATCH(request("new-long-password"), { params: Promise.resolve({ id: "x" }) })).status).toBe(400);
    expect((await PATCH(request("short"), { params: Promise.resolve({ id: "2" }) })).status).toBe(400);
    expect(changePortalUserPassword).not.toHaveBeenCalled();
  });

  it("does not reveal whether a missing account had a password", async () => {
    authorizedAdminRequest.mockResolvedValue({ session: { userId: 1 }, error: null });
    changePortalUserPassword.mockResolvedValue(null);
    const response = await PATCH(request("new-long-password"), { params: Promise.resolve({ id: "999" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Cuenta no encontrada." });
  });
});
