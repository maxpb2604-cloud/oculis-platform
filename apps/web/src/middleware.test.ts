import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { LANG_REQUEST_HEADER } from "@/lib/i18n";
import { middleware } from "./middleware";

function forwardedLanguage(url: string): string | null {
  const response = middleware(new NextRequest(url));
  return response.headers.get(`x-middleware-request-${LANG_REQUEST_HEADER}`);
}

describe("locale middleware", () => {
  it("forwards English from the canonical URL query", () => {
    expect(forwardedLanguage("https://oculis.test/initiatives?lang=en")).toBe("en");
  });

  it("defaults missing and unsupported language values to Spanish", () => {
    expect(forwardedLanguage("https://oculis.test/initiatives")).toBe("es");
    expect(forwardedLanguage("https://oculis.test/initiatives?lang=fr")).toBe("es");
  });

  it("overwrites an incoming internal language header", () => {
    const request = new NextRequest("https://oculis.test/?lang=en", {
      headers: { [LANG_REQUEST_HEADER]: "es" },
    });
    const response = middleware(request);
    expect(response.headers.get(`x-middleware-request-${LANG_REQUEST_HEADER}`)).toBe("en");
  });
});
