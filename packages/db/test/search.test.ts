/**
 * searchInitiatives on PGlite — which has neither the generated `search_tsv`/'spanish'
 * FTS config nor pg_trgm, so this exercises the GRACEFUL FALLBACK path (synonym-expanded
 * ILIKE over title/purpose/search_text). Verifies keyword recall degrades but still works
 * offline, so the db test suite and web startup stay green on PGlite.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { keywordBlob } from "@oculis/core";
import { createDb, type DbHandle } from "../src/client.js";
import { saveSearchText, searchInitiatives, upsertInitiative } from "../src/repository.js";
import type { NewInitiative } from "../src/schema.js";

let h: DbHandle;

async function seed(over: Partial<NewInitiative>): Promise<number> {
  const base: NewInitiative = {
    source: "test",
    sourceId: `s-${Math.random().toString(36).slice(2)}`,
    kind: "LEGISLATIVE",
    code: over.code ?? `C-${Math.random().toString(36).slice(2)}`,
    title: "sin título",
    ...over,
  };
  const { id } = await upsertInitiative(h.db, base);
  // Mirror the ingest/reindex path: compute + store the keyword blob.
  await saveSearchText(
    h.db,
    id,
    keywordBlob({ title: base.title, purpose: base.purpose ?? null, category: over.category ?? null }),
  );
  return id;
}

beforeAll(async () => {
  h = createDb(); // in-memory PGlite (no DATABASE_URL) → fallback path
  await h.ensureSchema();
});
afterAll(async () => {
  await h.close();
});

describe("searchInitiatives (PGlite fallback)", () => {
  it("still returns rows and finds a bill by a word literally in its title", async () => {
    const id = await seed({
      code: "IMP-1",
      title: "Proyecto de ley que modifica el impuesto sobre la renta",
      category: "FISCAL",
    });
    const rows = await searchInitiatives(h.db, "impuesto");
    expect(rows.some((r) => r.id === id)).toBe(true);
    // stable return shape (feed UI depends on these five fields)
    const hit = rows.find((r) => r.id === id)!;
    expect(hit).toMatchObject({ id, code: "IMP-1" });
    expect(hit.title).toContain("impuesto");
  });

  it("finds the bill by a SYNONYM absent from the title (via expanded ILIKE)", async () => {
    // "tributario" is not in the title, but keywordBlob injected it into search_text.
    const rows = await searchInitiatives(h.db, "tributario");
    expect(rows.some((r) => r.code === "IMP-1")).toBe(true);
  });

  it("does not match an unrelated query", async () => {
    const rows = await searchInitiatives(h.db, "aeropuerto");
    expect(rows.some((r) => r.code === "IMP-1")).toBe(false);
  });

  it("ignores queries shorter than 2 chars", async () => {
    expect(await searchInitiatives(h.db, "a")).toEqual([]);
  });
});
