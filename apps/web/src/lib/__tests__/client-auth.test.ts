import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { cookieStore, getPortalUserByEmail, getPortalUserById, getActivePortalClientById } =
  vi.hoisted(() => ({
    cookieStore: { get: vi.fn() },
    getPortalUserByEmail: vi.fn(),
    getPortalUserById: vi.fn(),
    getActivePortalClientById: vi.fn(),
  }));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/data", () => ({
  getPortalUserByEmail,
  getPortalUserById,
  getActivePortalClientById,
}));

import { createClientSessionToken, authenticateClient, getClientSession } from "../client-auth";
import { hashPortalPassword } from "../admin-auth";

const client = { id: 3, name: "Empresa de prueba", slug: "empresa-prueba" };
const user = {
  id: 9,
  clientId: 3,
  email: "persona@ejemplo.test",
  displayName: "Persona de prueba",
  role: "CLIENT" as const,
  active: true,
  passwordHash: hashPortalPassword("una-clave-de-prueba-larga"),
};

describe("client portal authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActivePortalClientById.mockResolvedValue(client);
  });

  it("authenticates only an active client user with an active tenant", async () => {
    getPortalUserByEmail.mockResolvedValue(user);
    expect(await authenticateClient(user.email, "una-clave-de-prueba-larga")).toMatchObject({
      userId: 9,
    });
    expect(await authenticateClient(user.email, "incorrecta")).toBeNull();
    getActivePortalClientById.mockResolvedValue(null);
    expect(await authenticateClient(user.email, "una-clave-de-prueba-larga")).toBeNull();
    getPortalUserByEmail.mockResolvedValue({ ...user, role: "ADMIN", clientId: null });
    expect(await authenticateClient(user.email, "una-clave-de-prueba-larga")).toBeNull();
  });

  it("rejects a token when the user is deactivated or its tenant is inactive", async () => {
    const token = createClientSessionToken({
      userId: 9,
      email: user.email,
      displayName: user.displayName,
    });
    cookieStore.get.mockReturnValue({ value: token });
    getPortalUserById.mockResolvedValue(user);
    expect(await getClientSession()).toMatchObject({ userId: 9, client });
    getPortalUserById.mockResolvedValue({ ...user, active: false });
    expect(await getClientSession()).toBeNull();
    getPortalUserById.mockResolvedValue(user);
    getActivePortalClientById.mockResolvedValue(null);
    expect(await getClientSession()).toBeNull();
  });
});
