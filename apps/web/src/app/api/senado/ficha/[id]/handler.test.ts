import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { fetchFicha } = vi.hoisted(() => ({
  fetchFicha: vi.fn(
    async (id: string | number) => `<html><head></head><body>Ficha ${String(id)}</body></html>`,
  ),
}));

vi.mock("@oculis/scrapers", () => ({
  SenadoSilAdapter: class {
    fetchFicha = fetchFicha;
  },
}));

import { GET } from "./route";

const request = (id: string, query = "") =>
  GET(new NextRequest(`http://localhost/api/senado/ficha/${id}${query}`), {
    params: Promise.resolve({ id }),
  });

describe("Senate ficha route admission", () => {
  it("does not spend upstream capacity on invalid ids or fresh cache hits", async () => {
    for (let index = 0; index < 12; index++) {
      expect((await request(`bad-${index}`)).status).toBe(400);
    }
    expect(fetchFicha).not.toHaveBeenCalled();

    expect((await request("1000", "?lang=fr")).status).toBe(400);
    expect((await request("1000", "?lang=en&lang=es")).status).toBe(400);
    expect((await request("1000", "?lang=en&redirect=https://example.com")).status).toBe(400);
    expect(fetchFicha).not.toHaveBeenCalled();

    // Each localized shell has its own cache/in-flight identity. The official source
    // fragment remains Spanish, but an English request must never reuse a Spanish shell.
    expect((await request("1000")).status).toBe(200);
    expect((await request("1000", "?lang=en")).status).toBe(200);
    for (let id = 1_001; id < 1_011; id++) {
      expect((await request(String(id))).status).toBe(200);
    }
    expect(fetchFicha).toHaveBeenCalledTimes(12);
    expect((await request("1011")).status).toBe(429);

    expect((await request("1000")).status).toBe(200);
    expect((await request("1000", "?lang=en")).status).toBe(200);
    expect(fetchFicha).toHaveBeenCalledTimes(12);
  });

  it("serves the correctly localized cached shell under a network-closed policy", async () => {
    const response = await request("1000", "?lang=en");
    const policy = response.headers.get("content-security-policy") ?? "";
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toMatch(/^<!doctype html><html lang="en">/i);
    expect(html).toContain("Transport warning");
    expect(html).toContain('<section lang="es"');
    expect(html).toContain("Ficha 1000");
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("style-src 'none'");
    expect(policy).not.toMatch(/https?:/);
  });
});
