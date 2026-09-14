import { beforeEach, describe, expect, it, vi } from "vitest";

const { redirect } = vi.hoisted(() => ({
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect }));

import LoginPage from "./page";
import AdminLoginPage from "../admin/login/page";

describe("legacy sign-in pages", () => {
  beforeEach(() => redirect.mockClear());

  it("sends the former public sign-in page to landing access", async () => {
    await LoginPage({ searchParams: Promise.resolve({}) });
    expect(redirect).toHaveBeenCalledWith("/#acceso");
  });

  it("preserves allowed language and error on the former administrative page", async () => {
    await AdminLoginPage({
      searchParams: Promise.resolve({ lang: "en", error: "limited" }),
    });
    expect(redirect).toHaveBeenCalledWith("/?lang=en&error=limited#acceso");
  });

  it("drops unrecognized errors from legacy URLs", async () => {
    await LoginPage({
      searchParams: Promise.resolve({ error: "unexpected" }),
    });
    expect(redirect).toHaveBeenCalledWith("/#acceso");
  });
});
