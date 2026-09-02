import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countInitiatives,
  createDb,
  getInitiativeById,
  upsertInitiative,
  type Database,
} from "@oculis/db";
import {
  mapSilInitiative,
  type RawInitiative,
  type SenadoExpediente,
  type SenadoFichaBatchInput,
  type SenadoFichaBatchResult,
  type SenadoFichaFacts,
  type SilHistorico,
  type SilIniciativa,
} from "@oculis/scrapers";
import {
  assertIncrementalMovementsComplete,
  ingestIncrementalDiputadosMovements,
  ingestIncrementalMovements,
  ingestIncrementalSenadoMovements,
  type DiputadosIncrementalAdapter,
  type SenadoIncrementalAdapter,
} from "../src/ingest-incremental-movements.js";
import { senateInitiativeRecord } from "../src/ingest-deposits.js";

function diputadosRow(status: string | null, changedAt: string | null, id = 159665): SilIniciativa {
  return {
    id,
    numero: "06211-2024-2028-CD",
    tipo: "Proyecto de Ley",
    tipoId: 9,
    descripcion: "Proyecto de ley de prueba.",
    camaraInicio: "Cámara de Diputados",
    grupo: "Justicia",
    grupoId: 1,
    materia: "Justicia",
    estado: status,
    condicion: "VIGENTE",
    fechaDeposito: "2026-08-20T00:00:00",
    fechaUltimoCambioPrincipal: changedAt,
    periodoRegistro: "2024-2028",
    origen: "Cámara de Diputados",
  };
}

function senateRow(status: string | null): SenadoExpediente {
  return {
    code: "01886-2026-SLO-SE",
    idExpediente: "40100",
    type: "Proyecto de Ley",
    title: "PROYECTO DE LEY DE PRUEBA",
    filedAt: "2026-08-28",
    status,
    sourceUrl:
      "https://www.senadord.gob.do/secretaria-general-legislativa/iniciativas-legislativas/",
  };
}

function senateFacts(status: string): SenadoFichaFacts {
  return {
    initiativeCode: "01886-2026-SLO-SE",
    title: "PROYECTO DE LEY DE PRUEBA",
    currentStatus: status,
    historyLiteral: `Depositada el 28/8/2026. ${status} el 1/9/2026.`,
    history: [
      { status: "Depositada", date: "2026-08-28", literal: "Depositada el 28/8/2026." },
      { status, date: "2026-09-01", literal: `${status} el 1/9/2026.` },
    ],
    historyParseComplete: true,
    rawFields: [],
  };
}

function diputadosAdapter(
  rows: RawInitiative[],
  histories: Map<string, SilHistorico[]>,
  calls: string[],
): DiputadosIncrementalAdapter {
  return {
    source: "sil-diputados",
    async count() {
      return rows.length;
    },
    async *list() {
      yield* rows;
    },
    async historicos(id) {
      const sourceId = String(id);
      calls.push(sourceId);
      return histories.get(sourceId) ?? [];
    },
  };
}

function senateAdapter(
  rows: SenadoExpediente[],
  facts: Map<string, SenadoFichaFacts>,
  calls: string[],
): SenadoIncrementalAdapter {
  return {
    source: "senado-sil",
    async listDeposits() {
      return rows;
    },
    async fetchFichaFactsBatch(
      inputs: readonly SenadoFichaBatchInput[],
    ): Promise<SenadoFichaBatchResult> {
      calls.push(...inputs.map((input) => String(input.idExpediente)));
      return {
        records: inputs.flatMap((input) => {
          const idExpediente = String(input.idExpediente);
          const observed = facts.get(idExpediente);
          return observed ? [{ idExpediente, facts: observed }] : [];
        }),
        failures: [],
      };
    },
  };
}

async function seedDiputados(db: Database, row: SilIniciativa): Promise<number> {
  const raw = mapSilInitiative(row);
  const result = await upsertInitiative(db, {
    source: raw.source,
    sourceId: raw.sourceId,
    kind: raw.kind,
    code: raw.code,
    title: raw.title,
    status: raw.status,
    chamber: raw.chamber,
    sourceChamber: raw.sourceChamber,
    filedAt: raw.filedAt,
    sourceUrl: raw.sourceUrl,
    raw: { payload: { list: row }, provenance: { observedCollections: ["list"] } },
  });
  return result.id;
}

async function seedSenado(db: Database, row: SenadoExpediente): Promise<number> {
  return (await upsertInitiative(db, senateInitiativeRecord(row))).id;
}

describe("incremental congressional movements", () => {
  it("fetches only changed histories in both chambers, uses the DR day and is idempotent", async () => {
    const handle = createDb();
    const dipCalls: string[] = [];
    const senCalls: string[] = [];
    try {
      await handle.ensureSchema();
      const dipId = await seedDiputados(
        handle.db,
        diputadosRow("Depositado", "2026-08-20T10:00:00"),
      );
      const priorSenate = senateRow("Depositada");
      const senId = await seedSenado(handle.db, priorSenate);

      const freshDip = mapSilInitiative(diputadosRow("En Comisión", "2026-09-01T15:30:00"));
      const freshSenate = senateRow("Enviada a Comisión");
      const dip = diputadosAdapter(
        [freshDip],
        new Map([
          [
            freshDip.sourceId,
            [
              {
                id: 1,
                estado: "Depositado",
                inicio: "2026-08-20T00:00:00",
                fin: "2026-08-20T00:00:00",
              },
              {
                id: 2,
                estado: "En Comisión",
                inicio: "2026-09-01T00:00:00",
                fin: null,
              },
            ],
          ],
        ]),
        dipCalls,
      );
      const sen = senateAdapter(
        [freshSenate],
        new Map([[freshSenate.idExpediente!, senateFacts("Enviada a Comisión")]]),
        senCalls,
      );

      const first = await ingestIncrementalMovements(handle.db, {
        now: new Date("2026-09-02T02:15:00Z"),
        diputados: { adapter: dip, delayMs: 0 },
        senado: { adapter: sen, fichaDelayMs: 0 },
      });
      assert.equal(first.runDate, "2026-09-01");
      assert.equal(first.diputados.changed, 1);
      assert.equal(first.diputados.verified, 1);
      assert.equal(first.senado.changed, 1);
      assert.equal(first.senado.verified, 1);
      assert.deepEqual(dipCalls, [freshDip.sourceId]);
      assert.deepEqual(senCalls, [freshSenate.idExpediente]);

      const second = await ingestIncrementalMovements(handle.db, {
        now: new Date("2026-09-02T02:15:00Z"),
        diputados: { adapter: dip, delayMs: 0 },
        senado: { adapter: sen, fichaDelayMs: 0 },
      });
      assert.equal(second.diputados.unchanged, 1);
      assert.equal(second.diputados.checked, 0);
      assert.equal(second.senado.unchanged, 1);
      assert.equal(second.senado.checked, 0);
      assert.deepEqual(dipCalls, [freshDip.sourceId]);
      assert.deepEqual(senCalls, [freshSenate.idExpediente]);

      const dipDetail = await getInitiativeById(handle.db, dipId);
      const senDetail = await getInitiativeById(handle.db, senId);
      assert.deepEqual(
        dipDetail?.events.map((event) => event.sourceEventId),
        ["1", "2"],
      );
      assert.deepEqual(
        senDetail?.events.map((event) => event.eventDate),
        ["2026-08-28", "2026-09-01"],
      );
    } finally {
      await handle.close();
    }
  });

  it("does not fetch history for an unchanged signal", async () => {
    const handle = createDb();
    const calls: string[] = [];
    try {
      await handle.ensureSchema();
      const row = diputadosRow("Depositado", "2026-08-20T10:00:00");
      await seedDiputados(handle.db, row);
      const summary = await ingestIncrementalDiputadosMovements(handle.db, {
        adapter: diputadosAdapter([mapSilInitiative(row)], new Map(), calls),
        delayMs: 0,
      });
      assert.equal(summary.outcome, "COMPLETE");
      assert.equal(summary.unchanged, 1);
      assert.equal(summary.checked, 0);
      assert.deepEqual(calls, []);
    } finally {
      await handle.close();
    }
  });

  it("treats serial gaps as upstream notes while an exact global catalogue is COMPLETE", async () => {
    const handle = createDb();
    const calls: string[] = [];
    try {
      await handle.ensureSchema();
      const serials = [1, 2, 4, 5, 6];
      const rows = serials.map((serial) => {
        const row = diputadosRow("Depositado", "2026-08-20T10:00:00", 100 + serial);
        row.numero = `${String(serial).padStart(5, "0")}-2024-2028-CD`;
        return row;
      });
      for (const row of rows) await seedDiputados(handle.db, row);
      const adapter = diputadosAdapter(
        rows.map((row) => mapSilInitiative(row)),
        new Map(),
        calls,
      );
      adapter.count = async () => 5;
      adapter.serialHighWatermark = async () => 6;

      const summary = await ingestIncrementalDiputadosMovements(handle.db, {
        adapter,
        delayMs: 0,
      });

      assert.equal(summary.outcome, "COMPLETE");
      assert.equal(summary.catalogTotal, 5);
      assert.equal(summary.serialHighWatermark, 6);
      assert.deepEqual(summary.upstreamCatalogOmissions, [3]);
      assert.equal(summary.gaps.length, 0);
      assert.match(summary.coverageNotes?.join(" ") ?? "", /no se fabricaron iniciativas/);
      assert.equal(summary.indexed, 5);
      assert.equal(await countInitiatives(handle.db), 5);
      assert.deepEqual(calls, []);
    } finally {
      await handle.close();
    }
  });

  it("retires removed or corrected Cámara history only after a verified complete snapshot", async () => {
    const handle = createDb();
    const calls: string[] = [];
    try {
      await handle.ensureSchema();
      const prior = diputadosRow("Depositado", "2026-08-20T10:00:00");
      const initiativeId = await seedDiputados(handle.db, prior);
      const commission = mapSilInitiative(diputadosRow("En Comisión", "2026-09-01T15:30:00"));
      await ingestIncrementalDiputadosMovements(handle.db, {
        adapter: diputadosAdapter(
          [commission],
          new Map([
            [
              commission.sourceId,
              [
                {
                  id: 1,
                  estado: "Depositado",
                  inicio: "2026-08-20T00:00:00",
                  fin: "2026-08-20T00:00:00",
                },
                {
                  id: 2,
                  estado: "En Comisión",
                  inicio: "2026-09-01T00:00:00",
                  fin: null,
                },
              ],
            ],
          ]),
          calls,
        ),
        delayMs: 0,
      });
      assert.deepEqual(
        (await getInitiativeById(handle.db, initiativeId))?.events.map((event) => event.status),
        ["Depositado", "En Comisión"],
      );

      const approved = mapSilInitiative(diputadosRow("Aprobado", "2026-09-02T09:00:00"));
      const corrected = await ingestIncrementalDiputadosMovements(handle.db, {
        adapter: diputadosAdapter(
          [approved],
          new Map([
            [
              approved.sourceId,
              [
                {
                  id: 2,
                  estado: "Aprobado",
                  inicio: "2026-09-02T00:00:00",
                  fin: null,
                },
              ],
            ],
          ]),
          calls,
        ),
        delayMs: 0,
      });
      assert.equal(corrected.verified, 1);
      assert.equal(corrected.statusEventsInserted, 1);
      assert.deepEqual(
        (await getInitiativeById(handle.db, initiativeId))?.events.map((event) => ({
          sourceEventId: event.sourceEventId,
          status: event.status,
        })),
        [{ sourceEventId: "2", status: "Aprobado" }],
      );

      // A changed index with an incomplete/unverified history cannot retire the last
      // complete snapshot.
      const rejected = mapSilInitiative(diputadosRow("Rechazado", "2026-09-02T10:00:00"));
      const partial = await ingestIncrementalDiputadosMovements(handle.db, {
        adapter: diputadosAdapter([rejected], new Map([[rejected.sourceId, []]]), calls),
        delayMs: 0,
      });
      assert.equal(partial.outcome, "PARTIAL");
      assert.equal(partial.unverifiedHistories, 1);
      assert.deepEqual(
        (await getInitiativeById(handle.db, initiativeId))?.events.map((event) => event.status),
        ["Aprobado"],
      );
    } finally {
      await handle.close();
    }
  });

  it("records a PARTIAL gap and emits no event when the current index signal is missing", async () => {
    const handle = createDb();
    const calls: string[] = [];
    try {
      await handle.ensureSchema();
      const prior = diputadosRow("Depositado", "2026-08-20T10:00:00");
      await seedDiputados(handle.db, prior);
      const malformed = mapSilInitiative(diputadosRow("En Comisión", null));
      const summary = await ingestIncrementalDiputadosMovements(handle.db, {
        adapter: diputadosAdapter([malformed], new Map(), calls),
        delayMs: 0,
      });
      assert.equal(summary.ok, true);
      assert.equal(summary.outcome, "PARTIAL");
      assert.equal(summary.invalidSignals, 1);
      assert.equal(summary.checked, 0);
      assert.match(summary.gaps.join(" "), /señal oficial válida/);
      assert.deepEqual(calls, []);
      assert.throws(
        () =>
          assertIncrementalMovementsComplete({
            runDate: summary.runDate,
            ok: false,
            diputados: summary,
            senado: { ...summary, source: "test-senado", outcome: "COMPLETE" },
          }),
        /sil-diputados=PARTIAL/,
      );
    } finally {
      await handle.close();
    }
  });

  it("excludes conflicting duplicate source ids before any parallel history fetch", async () => {
    const handle = createDb();
    const calls: string[] = [];
    try {
      await handle.ensureSchema();
      const prior = diputadosRow("Depositado", "2026-08-20T10:00:00");
      const initiativeId = await seedDiputados(handle.db, prior);
      const first = mapSilInitiative(diputadosRow("En Comisión", "2026-09-01T15:30:00"));
      const second = mapSilInitiative(diputadosRow("Aprobado", "2026-09-01T16:00:00"));
      const summary = await ingestIncrementalDiputadosMovements(handle.db, {
        adapter: diputadosAdapter([first, second], new Map(), calls),
        delayMs: 0,
      });
      assert.equal(summary.ok, true);
      assert.equal(summary.outcome, "PARTIAL");
      assert.equal(summary.duplicateRows, 1);
      assert.equal(summary.conflictingDuplicateIds, 1);
      assert.equal(summary.invalidSignals, 1);
      assert.equal(summary.checked, 0);
      assert.deepEqual(calls, []);
      const detail = await getInitiativeById(handle.db, initiativeId);
      assert.equal(detail?.status, "Depositado");
      assert.deepEqual(detail?.events, []);
    } finally {
      await handle.close();
    }
  });

  it("counts an identical duplicate once and keeps the duplicate visible as a gap", async () => {
    const handle = createDb();
    const calls: string[] = [];
    try {
      await handle.ensureSchema();
      const row = diputadosRow("Depositado", "2026-08-20T10:00:00");
      await seedDiputados(handle.db, row);
      const fresh = mapSilInitiative(row);
      const summary = await ingestIncrementalDiputadosMovements(handle.db, {
        adapter: diputadosAdapter([fresh, fresh], new Map(), calls),
        delayMs: 0,
      });
      assert.equal(summary.outcome, "PARTIAL");
      assert.equal(summary.indexed, 1);
      assert.equal(summary.unchanged, 1);
      assert.equal(summary.duplicateRows, 1);
      assert.equal(summary.conflictingDuplicateIds, 0);
      assert.equal(summary.checked, 0);
      assert.match(summary.gaps.join(" "), /duplicadas/);
      assert.deepEqual(calls, []);
    } finally {
      await handle.close();
    }
  });

  it("stores a durable baseline without fetching or manufacturing history", async () => {
    const handle = createDb();
    const calls: string[] = [];
    try {
      await handle.ensureSchema();
      const fresh = mapSilInitiative(diputadosRow("En Comisión", "2026-09-01T15:30:00"));
      const adapter = diputadosAdapter([fresh], new Map(), calls);
      const first = await ingestIncrementalDiputadosMovements(handle.db, {
        adapter,
        delayMs: 0,
      });
      assert.equal(first.baselined, 1);
      assert.equal(first.outcome, "PARTIAL");
      assert.equal(first.checked, 0);
      const second = await ingestIncrementalDiputadosMovements(handle.db, {
        adapter,
        delayMs: 0,
      });
      assert.equal(second.unchanged, 1);
      assert.equal(second.outcome, "COMPLETE");
      assert.deepEqual(calls, []);
    } finally {
      await handle.close();
    }
  });

  it("continues the Senate source when the Cámara index fails", async () => {
    const handle = createDb();
    const senCalls: string[] = [];
    try {
      await handle.ensureSchema();
      const priorSenate = senateRow("Depositada");
      await seedSenado(handle.db, priorSenate);
      const freshSenate = senateRow("Enviada a Comisión");
      const failingDip: DiputadosIncrementalAdapter = {
        source: "sil-diputados",
        async count() {
          return 1;
        },
        async *list() {
          yield await Promise.reject(new Error("simulated Cámara outage"));
        },
        async historicos() {
          throw new Error("must not run");
        },
      };
      const summary = await ingestIncrementalMovements(handle.db, {
        diputados: { adapter: failingDip, delayMs: 0 },
        senado: {
          adapter: senateAdapter(
            [freshSenate],
            new Map([[freshSenate.idExpediente!, senateFacts("Enviada a Comisión")]]),
            senCalls,
          ),
          fichaDelayMs: 0,
        },
      });
      assert.equal(summary.ok, false);
      assert.equal(summary.diputados.outcome, "FAILED");
      assert.equal(summary.senado.outcome, "COMPLETE");
      assert.equal(summary.senado.verified, 1);
      assert.deepEqual(senCalls, [freshSenate.idExpediente]);
    } finally {
      await handle.close();
    }
  });

  it("retries a Senate Ficha after a list-only refresh advances the unverified status", async () => {
    const handle = createDb();
    const calls: string[] = [];
    try {
      await handle.ensureSchema();
      const prior = senateRow("Depositada");
      const initiativeId = (
        await upsertInitiative(handle.db, senateInitiativeRecord(prior, senateFacts("Depositada")))
      ).id;

      const fresh = senateRow("Enviada a Comisión");
      await upsertInitiative(handle.db, senateInitiativeRecord(fresh), {
        preserveVerifiedSenateFicha: true,
      });

      const summary = await ingestIncrementalSenadoMovements(handle.db, {
        adapter: senateAdapter(
          [fresh],
          new Map([[fresh.idExpediente!, senateFacts("Enviada a Comisión")]]),
          calls,
        ),
        fichaDelayMs: 0,
      });

      assert.equal(summary.changed, 1);
      assert.equal(summary.checked, 1);
      assert.equal(summary.verified, 1);
      assert.equal(summary.unchanged, 0);
      assert.deepEqual(calls, ["40100"]);

      const detail = await getInitiativeById(handle.db, initiativeId);
      assert.equal(detail?.status, "Enviada a Comisión");
      assert.deepEqual(
        detail?.events
          .filter((event) => event.evidenceType === "SOURCE_HISTORY")
          .map((event) => [event.status, event.eventDate]),
        [
          ["Depositada", "2026-08-28"],
          ["Enviada a Comisión", "2026-09-01"],
        ],
      );
    } finally {
      await handle.close();
    }
  });

  it("treats a Senate source-identity mismatch as a fail-closed gap, not an outage", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const prior = senateRow("Depositada");
      const initiativeId = await seedSenado(handle.db, prior);
      const fresh = senateRow("Enviada a Comisión");
      const mismatch: SenadoIncrementalAdapter = {
        source: "senado-sil",
        async listDeposits() {
          return [fresh];
        },
        async fetchFichaFactsBatch() {
          return {
            records: [],
            failures: [
              {
                idExpediente: fresh.idExpediente!,
                classification: "SOURCE_IDENTITY_MISMATCH",
                expectedCode: fresh.code,
                observedCode: "99999-2026-SLO-SE",
                error: "official list/Ficha identity mismatch",
              },
            ],
          };
        },
      };
      const summary = await ingestIncrementalSenadoMovements(handle.db, {
        adapter: mismatch,
        fichaDelayMs: 0,
      });
      assert.equal(summary.ok, true);
      assert.equal(summary.outcome, "PARTIAL");
      assert.equal(summary.failures, 0);
      assert.equal(summary.unverifiedHistories, 1);
      assert.match(summary.gaps.join(" "), /historial oficial verificado/);
      assert.deepEqual((await getInitiativeById(handle.db, initiativeId))?.events, []);
    } finally {
      await handle.close();
    }
  });
});
