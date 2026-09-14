import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { authorizedAdminRequest, createAdminTeamUser, hashPortalPassword } = vi.hoisted(() => ({
  authorizedAdminRequest: vi.fn(),
  createAdminTeamUser: vi.fn(),
  hashPortalPassword: vi.fn(() => "one-way-hash"),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-api", () => ({
  authorizedAdminRequest,
  adminApiError: vi.fn(() => NextResponse.json({ error: "No se pudo agregar el administrador." }, { status: 400 })),
}));
vi.mock("@/lib/admin-auth", () => ({ hashPortalPassword }));
vi.mock("@/lib/data", () => ({ createAdminTeamUser }));

import { POST } from "./route";

function request(body: Record<string, unknown>) {
  return new NextRequest("http://localhost:3001/api/admin/users", {
    method: "POST",
    headers: { origin: "http://localhost:3001", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/admin/users", () => {
  beforeEach(() => {
    authorizedAdminRequest.mockReset();
    createAdminTeamUser.mockReset();
    hashPortalPassword.mockClear();
  });

  it("rejects requests without an administrator session before reading credentials", async () => {
    authorizedAdminRequest.mockResolvedValue({
      error: NextResponse.json({ error: "Sesión administrativa requerida." }, { status: 401 }),
    });
    const response = await POST(request({ email: "a@fhc.test", password: "long-test-password" }));
    expect(response.status).toBe(401);
    expect(createAdminTeamUser).not.toHaveBeenCalled();
  });

  it("creates a distinct admin using a hash without returning password material", async () => {
    authorizedAdminRequest.mockResolvedValue({ session: { userId: 1 }, error: null });
    createAdminTeamUser.mockResolvedValue({
      id: 2,
      email: "new@fhc.test",
      displayName: "Nueva Persona",
      active: true,
      activationPending: false,
    });
    const response = await POST(request({
      email: "NEW@FHC.TEST",
      displayName: " Nueva   Persona ",
      password: "long-test-password",
    }));

    expect(response.status).toBe(201);
    expect(createAdminTeamUser).toHaveBeenCalledWith({
      email: "new@fhc.test",
      displayName: "Nueva Persona",
      passwordHash: "one-way-hash",
    });
    expect(JSON.stringify(await response.json())).not.toContain("password");
  });

  it("rejects weak temporary passwords", async () => {
    authorizedAdminRequest.mockResolvedValue({ session: { userId: 1 }, error: null });
    const response = await POST(request({
      email: "new@fhc.test",
      displayName: "Nueva Persona",
      password: "short",
    }));
    expect(response.status).toBe(400);
    expect(hashPortalPassword).not.toHaveBeenCalled();
  });
});
