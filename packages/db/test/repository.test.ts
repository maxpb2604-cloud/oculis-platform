import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../src/client.js";
import {
  countInitiatives,
  recordStatusEvents,
  upsertInitiative,
} from "../src/repository.js";
import type { NewInitiative } from "../src/schema.js";

let h: DbHandle;

beforeAll(async () => {
  h = createDb(); // in-memory PGlite (no DATABASE_URL)
  await h.ensureSchema();
});
afterAll(async () => {
  await h.close();
});

function fixture(over: Partial<NewInitiative> = {}): NewInitiative {
  return {
    source: "sil-diputados",
    sourceId: "158418",
    kind: "LEGISLATIVE",
    code: "05956-2024-2028-CD",
    title: "Proyecto de ley de prueba",
    status: "Depositado",
    chamber: "DIPUTADOS",
    ...over,
  };
}

describe("upsertInitiative", () => {
  it("inserts once, then updates the same row (idempotent on source+sourceId)", async () => {
    const a = await upsertInitiative(h.db, fixture());
    expect(a.inserted).toBe(true);

    const b = await upsertInitiative(h.db, fixture({ status: "Depositado" }));
    expect(b.inserted).toBe(false);
    expect(b.statusChanged).toBe(false);
    expect(b.id).toBe(a.id);

    expect(await countInitiatives(h.db)).toBe(1);
  });

  it("detects a status change on re-ingest", async () => {
    const c = await upsertInitiative(h.db, fixture({ status: "En Comisión" }));
    expect(c.inserted).toBe(false);
    expect(c.statusChanged).toBe(true);
    expect(await countInitiatives(h.db)).toBe(1);
  });
});

describe("recordStatusEvents", () => {
  it("dedupes identical (status, date) events across re-scrapes", async () => {
    const { id } = await upsertInitiative(h.db, fixture());
    const events = [
      { status: "Depositado", date: "2026-06-18", note: null },
      { status: "En Comisión", date: "2026-06-20", note: null },
    ];
    const first = await recordStatusEvents(h.db, id, events);
    expect(first).toBe(2);
    const second = await recordStatusEvents(h.db, id, events);
    expect(second).toBe(0); // all duplicates skipped
    const third = await recordStatusEvents(h.db, id, [
      { status: "En Pleno", date: "2026-06-25", note: null },
    ]);
    expect(third).toBe(1);
  });
});
