import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin-auth", () => ({ getAdminSession: vi.fn() }));

import { requestHasSameOrigin, sameOriginRedirectUrl } from "../admin-api";

afterEach(() => vi.unstubAllEnvs());

describe("administrative request origins", () => {
  it("accepts the exact local request origin", () => {
    const request = new NextRequest("http://localhost:3001/api/portal/session", {
      headers: { origin: "http://localhost:3001" },
    });
    expect(requestHasSameOrigin(request)).toBe(true);
    expect(sameOriginRedirectUrl(request, "/admin").href).toBe("http://localhost:3001/admin");
  });

  it("accepts Render's configured external origin despite an internal request URL", () => {
    vi.stubEnv("RENDER", "true");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://oculis-auribus.onrender.com");
    const request = new NextRequest("http://localhost:10000/api/portal/session", {
      headers: { origin: "https://oculis-auribus.onrender.com" },
    });
    expect(requestHasSameOrigin(request)).toBe(true);
    expect(sameOriginRedirectUrl(request, "/admin").href).toBe(
      "https://oculis-auribus.onrender.com/admin",
    );
  });

  it("rejects a foreign origin, including a spoofed forwarded host", () => {
    vi.stubEnv("RENDER", "true");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://oculis-auribus.onrender.com");
    const request = new NextRequest("http://localhost:10000/api/portal/session", {
      headers: {
        origin: "https://attacker.example",
        "x-forwarded-host": "oculis-auribus.onrender.com",
      },
    });
    expect(requestHasSameOrigin(request)).toBe(false);
    expect(() => sameOriginRedirectUrl(request, "/admin")).toThrow();
  });

  it("rejects a missing origin", () => {
    const request = new NextRequest("http://localhost:3001/api/portal/session");
    expect(requestHasSameOrigin(request)).toBe(false);
  });
});
