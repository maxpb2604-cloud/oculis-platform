import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateAdmin, authenticateClient } = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  authenticateClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({
  ADMIN_SESSION_COOKIE: "oculis_admin_session",
  adminSessionCookieOptions: {},
  authenticateAdmin,
  createAdminSessionToken: vi.fn(() => "admin-test-token"),
  getAdminSession: vi.fn(),
}));
vi.mock("@/lib/client-auth", () => ({
  CLIENT_SESSION_COOKIE: "oculis_client_session",
  authenticateClient,
  clientSessionCookieOptions: {},
  createClientSessionToken: vi.fn(() => "client-test-token"),
}));

import { POST } from "./route";

function signInRequest(ip: string, lang: "es" | "en" = "es") {
  return new NextRequest("http://localhost:3001/api/portal/session", {
    method: "POST",
    headers: {
      origin: "http://localhost:3001",
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": ip,
    },
    body: new URLSearchParams({
      email: "example@example.com",
      password: "a-test-password-long-enough",
      lang,
    }).toString(),
  });
}

describe("POST /api/portal/session", () => {
  beforeEach(() => {
    authenticateAdmin.mockReset();
    authenticateClient.mockReset();
  });

  it("reports unavailable authentication infrastructure without blaming the password", async () => {
    authenticateAdmin.mockRejectedValue(new Error("database unavailable"));

    const response = await POST(signInRequest("192.0.2.10"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/login?error=unavailable",
    );
    expect(authenticateClient).not.toHaveBeenCalled();
  });

  it("keeps invalid credentials generic and preserves the requested language", async () => {
    authenticateAdmin.mockResolvedValue(null);
    authenticateClient.mockResolvedValue(null);

    const response = await POST(signInRequest("192.0.2.11", "en"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/login?error=1&lang=en",
    );
  });

  it("identifies the temporary attempt limit instead of reporting a bad password", async () => {
    authenticateAdmin.mockResolvedValue(null);
    authenticateClient.mockResolvedValue(null);

    for (let n = 0; n < 8; n++) await POST(signInRequest("192.0.2.12"));
    const response = await POST(signInRequest("192.0.2.12"));

    expect(response.headers.get("location")).toBe(
      "http://localhost:3001/login?error=limited",
    );
    expect(authenticateAdmin).toHaveBeenCalledTimes(8);
  });
});
