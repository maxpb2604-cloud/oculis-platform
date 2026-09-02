import { describe, expect, it } from "vitest";
import { createDb, listInitiativeMovementCheckpoints, upsertInitiative } from "../src/index.js";

describe("initiative movement checkpoints", () => {
  it("is source-isolated and supports stable id keyset batches", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const first = await upsertInitiative(handle.db, {
        source: "sil-diputados",
        sourceId: "1",
        kind: "LEGISLATIVE",
        title: "Primera",
        status: "Depositado",
        officialStatusChangedAt: "2026-08-31T10:00:00",
        raw: { payload: { list: { id: 1, estado: "Depositado" } } },
      });
      const second = await upsertInitiative(handle.db, {
        source: "sil-diputados",
        sourceId: "2",
        kind: "LEGISLATIVE",
        title: "Segunda",
        status: "En Comisión",
        officialStatusChangedAt: "2026-09-01T10:00:00",
        raw: { payload: { list: { id: 2, estado: "En Comisión" } } },
      });
      await upsertInitiative(handle.db, {
        source: "senado-sil",
        sourceId: "1",
        kind: "LEGISLATIVE",
        title: "Senado",
        status: "Depositada",
        raw: { payload: { list: { idExpediente: "1", status: "Depositada" } } },
      });

      const pageOne = await listInitiativeMovementCheckpoints(handle.db, {
        source: "sil-diputados",
        limit: 1,
      });
      expect(pageOne).toHaveLength(1);
      expect(pageOne[0]).toMatchObject({
        id: first.id,
        source: "sil-diputados",
        sourceId: "1",
        status: "Depositado",
        officialStatusChangedAt: "2026-08-31T10:00:00",
      });
      const pageTwo = await listInitiativeMovementCheckpoints(handle.db, {
        source: "sil-diputados",
        afterId: pageOne[0]!.id,
        limit: 10,
      });
      expect(pageTwo.map((row) => row.id)).toEqual([second.id]);
      expect(pageTwo.every((row) => row.source === "sil-diputados")).toBe(true);
    } finally {
      await handle.close();
    }
  });
});
