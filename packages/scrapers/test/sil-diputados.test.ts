import { describe, expect, it } from "vitest";
import { SilDiputadosAdapter } from "../src/sil-diputados.js";

const LIVE = process.env.OCULIS_LIVE === "1";
const live = LIVE ? describe : describe.skip;

describe("SilDiputadosAdapter (offline)", () => {
  it("builds the verified list URL", () => {
    const a = new SilDiputadosAdapter();
    expect(a.buildListUrl(1, true, 2)).toBe(
      "https://www.diputadosrd.gob.do/sil/api/iniciativa/iniciativas?page=2&grupo=1&tipo=true&perimidas=false&keyword=&periodoId=0",
    );
  });
});

/** Live tests hit the real Cámara de Diputados SIL API. Run: `npm run test:live`. */
live("SilDiputadosAdapter (live)", () => {
  const a = new SilDiputadosAdapter();

  it("count() returns a plausible total", async () => {
    expect(await a.count()).toBeGreaterThan(1000);
  }, 30_000);

  it("groups() returns the subject taxonomy", async () => {
    const groups = await a.groups();
    expect(groups.length).toBeGreaterThan(5);
    expect(groups[0]).toHaveProperty("descripcion");
  }, 30_000);

  it("listPage() returns mapped initiatives with code + title", async () => {
    const env = await a.listPage(1, true, 1);
    expect(env.total).toBeGreaterThan(0);
    expect(env.results.length).toBeGreaterThan(0);
    const r = env.results[0]!;
    expect(r).toHaveProperty("numero");
    expect(r).toHaveProperty("descripcion");
  }, 30_000);

  it("enrich() adds party + province + history to a real initiative", async () => {
    const env = await a.listPage(1, true, 1);
    const { mapped, enriched } = await (async () => {
      // pull the first record through map -> enrich
      const iterator = a.list()[Symbol.asyncIterator]();
      const first = await iterator.next();
      const mapped = first.value!;
      const enriched = await a.enrich(mapped);
      return { mapped, enriched };
    })();
    expect(mapped.code).toBeTruthy();
    expect(mapped.title.length).toBeGreaterThan(3);
    // enrichment should surface a party (e.g. "PRM") and a province for most bills
    expect(enriched.party || enriched.province).toBeTruthy();
    expect(Array.isArray(enriched.history)).toBe(true);
    expect(env.results.length).toBeGreaterThan(0);
  }, 60_000);
});
