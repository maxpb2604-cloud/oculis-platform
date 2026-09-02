import { describe, expect, it } from "vitest";
import { languageSwitchHref, parseLang } from "@/lib/i18n";

describe("parseLang", () => {
  it("selects English only for the exact supported query value", () => {
    expect(parseLang("en")).toBe("en");
    expect(parseLang("es")).toBe("es");
    expect(parseLang(undefined)).toBe("es");
    expect(parseLang("EN")).toBe("es");
  });
});

describe("languageSwitchHref", () => {
  it("preserves every URL parameter when switching to English", () => {
    const params = new URLSearchParams("search=salud&page=2&chamber=SENADO");
    expect(languageSwitchHref("/initiatives", params, "en")).toBe(
      "/initiatives?search=salud&page=2&chamber=SENADO&lang=en",
    );
  });

  it("removes only the language parameter when switching to canonical Spanish", () => {
    const params = new URLSearchParams("lang=en&from=2026-08-01&to=2026-08-28");
    expect(languageSwitchHref("/hoy", params, "es")).toBe("/hoy?from=2026-08-01&to=2026-08-28");
  });
});
