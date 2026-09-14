import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authenticateAdmin } = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({
  ADMIN_SESSION_COOKIE: "oculis_admin_session",
  adminSessionCookieOptions: {},
  authenticateAdmin,
}));

import { DELETE, POST } from "./route";

describe("legacy /api/admin/session", () => {
  it("redirects old sign-in submissions to the landing without authenticating", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3001/api/admin/session", {
        method: "POST",
        headers: {
          origin: "http://localhost:3001",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          lang: "en",
          email: "someone@example.com",
          password: "a-long-password",
        }).toString(),
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3001/?lang=en#acceso");
    expect(response.cookies.get("oculis_admin_session")).toBeUndefined();
    expect(authenticateAdmin).not.toHaveBeenCalled();
  });

  it("keeps legacy admin logout functional", async () => {
    const response = await DELETE(
      new NextRequest("http://localhost:3001/api/admin/session", {
        method: "DELETE",
        headers: { origin: "http://localhost:3001" },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get("oculis_admin_session")?.value).toBe("");
  });
});
