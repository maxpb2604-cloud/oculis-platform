import { describe, expect, it } from "vitest";
import {
  createDb,
  getInitiativeRawBySourceId,
  listInitiativeMovementCheckpoints,
  upsertInitiative,
} from "../src/index.js";

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

  it("returns only literal movement signal fields for each chamber without altering stored raw", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const large = "retained official detail ".repeat(5_000);
      const diputadosRaw = {
        payload: {
          list: {
            id: 159665,
            estado: "En Comisión",
            fechaUltimoCambioPrincipal: "2026-09-01T15:30:00",
            descripcion: large,
          },
          historicos: [{ id: 2, estado: "En Comisión", evidence: large }],
          detalle: { document: large },
        },
        provenance: { retainedCollections: ["historicos", "detalle"] },
      };
      const senadoRaw = {
        payload: {
          list: { idExpediente: "40100", status: "Enviada a Comisión", description: large },
          ficha: { currentStatus: "Depositada", historyLiteral: large },
        },
        provenance: { retainedCollections: ["ficha"] },
      };
      await upsertInitiative(handle.db, {
        source: "sil-diputados",
        sourceId: "159665",
        kind: "LEGISLATIVE",
        title: "Diputados",
        raw: diputadosRaw,
      });
      await upsertInitiative(handle.db, {
        source: "senado-sil",
        sourceId: "40100",
        kind: "LEGISLATIVE",
        title: "Senado",
        raw: senadoRaw,
      });

      const [diputados] = await listInitiativeMovementCheckpoints(handle.db, {
        source: "sil-diputados",
      });
      const [senado] = await listInitiativeMovementCheckpoints(handle.db, {
        source: "senado-sil",
      });
      expect(diputados?.raw).toEqual({
        payload: {
          list: {
            id: 159665,
            estado: "En Comisión",
            fechaUltimoCambioPrincipal: "2026-09-01T15:30:00",
          },
        },
      });
      expect(senado?.raw).toEqual({
        payload: {
          list: { idExpediente: "40100" },
          ficha: { currentStatus: "Depositada" },
        },
      });
      expect(await getInitiativeRawBySourceId(handle.db, "sil-diputados", "159665")).toEqual(
        diputadosRaw,
      );
      expect(await getInitiativeRawBySourceId(handle.db, "senado-sil", "40100")).toEqual(senadoRaw);
    } finally {
      await handle.close();
    }
  });
});
