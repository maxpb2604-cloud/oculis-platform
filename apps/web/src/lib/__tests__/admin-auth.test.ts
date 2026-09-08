import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  createAdminSessionToken,
  hashPortalPassword,
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
      { userId: 7, email: "ADMIN@FHC.TEST", displayName: "Equipo FHC" },
      now,
    );
    expect(verifyAdminSessionToken(token, now)).toEqual({
      sub: 7,
      email: "admin@fhc.test",
      exp: now + 8 * 60 * 60,
    });
    expect(verifyAdminSessionToken(`${token}x`, now)).toBeNull();
    expect(verifyAdminSessionToken(token, now + 8 * 60 * 60)).toBeNull();
  });
});
