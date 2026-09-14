import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { cookieStore, getPortalUserById } = vi.hoisted(() => ({
  cookieStore: { get: vi.fn() },
  getPortalUserById: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));
vi.mock("@/lib/data", () => ({ getPortalUserById }));
import {
  createAdminSessionToken,
  getAdminSession,
  hashPortalPassword,
  portalCredentialFingerprint,
  verifyAdminSessionToken,
  verifyPortalPassword,
} from "../admin-auth";

describe("administrative authentication primitives", () => {
  it("stores only a salted one-way password hash", () => {
    const password = "una-clave-muy-segura";
    const first = hashPortalPassword(password);
    const second = hashPortalPassword(password);
    expect(first).not.toBe(second);
    expect(first).not.toContain(password);
    expect(verifyPortalPassword(password, first)).toBe(true);
    expect(verifyPortalPassword("clave-equivocada", first)).toBe(false);
  });

  it("signs, expires, and rejects tampered admin sessions", () => {
    const now = 2_000_000_000;
    const token = createAdminSessionToken(
      { userId: 7, email: "ADMIN@FHC.TEST", displayName: "Equipo FHC", credentialFingerprint: portalCredentialFingerprint("old-hash") },
      now,
    );
    expect(verifyAdminSessionToken(token, now)).toEqual({
      sub: 7,
      email: "admin@fhc.test",
      cv: portalCredentialFingerprint("old-hash"),
      exp: now + 8 * 60 * 60,
    });
    expect(portalCredentialFingerprint("new-hash")).not.toBe(portalCredentialFingerprint("old-hash"));
    expect(verifyAdminSessionToken(`${token}x`, now)).toBeNull();
    expect(verifyAdminSessionToken(token, now + 8 * 60 * 60)).toBeNull();
  });

  it("invalidates existing administrator sessions after a password change", async () => {
    const oldHash = hashPortalPassword("old-long-password");
    const token = createAdminSessionToken({
      userId: 7,
      email: "admin@fhc.test",
      displayName: "Equipo FHC",
      credentialFingerprint: portalCredentialFingerprint(oldHash),
    });
    cookieStore.get.mockReturnValue({ value: token });
    getPortalUserById.mockResolvedValue({
      id: 7,
      email: "admin@fhc.test",
      displayName: "Equipo FHC",
      role: "ADMIN",
      active: true,
      passwordHash: oldHash,
    });
    expect(await getAdminSession()).toMatchObject({ userId: 7 });
    getPortalUserById.mockResolvedValue({
      id: 7,
      email: "admin@fhc.test",
      displayName: "Equipo FHC",
      role: "ADMIN",
      active: true,
      passwordHash: hashPortalPassword("new-long-password"),
    });
    expect(await getAdminSession()).toBeNull();
  });
});
