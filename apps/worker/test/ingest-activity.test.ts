import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDb, latestRunsBySource } from "@oculis/db";
import type { RawActivityEvent } from "@oculis/scrapers";
import { ingestActivity, type ActivityIngestAdapter } from "../src/ingest-activity.js";

function event(overrides: Partial<RawActivityEvent> = {}): RawActivityEvent {
  return {
    source: "sil-actividad",
    scope: "COMMITTEE",
    chamber: "DIPUTADOS",
    agendaUrl: "https://www.diputadosrd.gob.do/sil/comision/5197",
    date: "2026-08-27",
    kind: "Reunión",
    body: "Comisión Permanente de Justicia",
    description: "Conocimiento de 01234-2024-2028-CD.",
    initiativeCodes: ["01234-2024-2028-CD"],
    dedupeKey: "activity-test-committee",
    raw: { fixture: true },
    ...overrides,
  };
}

function adapter(factory: () => AsyncIterable<RawActivityEvent>): ActivityIngestAdapter {
  return { source: "sil-actividad", list: factory };
}

function collectingAdapter(
  source: string,
  events: RawActivityEvent[],
  gaps: string[],
): ActivityIngestAdapter {
  return {
    source,
    async collect() {
      return { events, gaps };
    },
    async *list() {
      yield* events;
    },
  };
}

describe("activity ingestion source-health bookkeeping", () => {
  it("records a COMPLETE run with coverage metrics and update counts", async () => {
    const handle = createDb();
    const source = adapter(async function* () {
      yield event();
      yield event({
        scope: "PLENARY",
        body: "Pleno",
        initiativeCodes: ["04567-2024-2028-CD", "07890-2024-2028-CD"],
        dedupeKey: "activity-test-plenary",
      });
    });

    try {
      await handle.ensureSchema();

      assert.deepEqual(await ingestActivity(handle.db, { adapter: source }), {
        ok: true,
        outcome: "COMPLETE",
        seen: 2,
        inserted: 2,
        linkedCodes: 3,
        committee: 1,
        plenary: 1,
        gaps: [],
        coverageNotes: [],
      });

      // A repeated source snapshot is an update, not a new activity row.
      await ingestActivity(handle.db, { adapter: source });
      const health = (await latestRunsBySource(handle.db)).find(
        (row) => row.source === "sil-actividad",
      );

      assert.equal(health?.ok, true);
      assert.equal(health?.outcome, "COMPLETE");
      assert.equal(health?.seen, 2);
      assert.equal(health?.inserted, 0);
      assert.equal(health?.updated, 2);
      assert.equal(health?.error, null);
      assert.deepEqual(health?.details, {
        outcome: "COMPLETE",
        lifecycle: "EXPLICIT_BEGIN_FINISH",
        mode: "COMMITTEE_AND_PLENARY_AGENDA",
        committee: 1,
        plenary: 1,
        linkedCodes: 3,
        gaps: [],
        coverageNotes: [],
      });
    } finally {
      await handle.close();
    }
  });

  it("keeps an unpublished daily PDF as a COMPLETE coverage note", async () => {
    const handle = createDb();
    const note =
      "Diputados · agenda de comisiones (2026-09-02): la fuente no publicó un PDF diario con esa fecha literal.";
    const source = collectingAdapter("sil-actividad", [event()], [note]);
    try {
      await handle.ensureSchema();
      const result = await ingestActivity(handle.db, { adapter: source });
      assert.equal(result.ok, true);
      assert.equal(result.outcome, "COMPLETE");
      assert.deepEqual(result.gaps, []);
      assert.deepEqual(result.coverageNotes, [note]);

      const health = (await latestRunsBySource(handle.db)).find(
        (row) => row.source === "sil-actividad",
      );
      assert.equal(health?.outcome, "COMPLETE");
      assert.deepEqual((health?.details as { coverageNotes?: string[] })?.coverageNotes, [note]);
    } finally {
      await handle.close();
    }
  });

  it("keeps an unreadable PDF or an unclassified message PARTIAL", async () => {
    const handle = createDb();
    const unreadable =
      "Diputados · agenda de comisiones (2026-09-02): el archivo 91 no fue un PDF legible (PDF sin texto verificable).";
    const source = collectingAdapter("sil-actividad", [event()], [unreadable]);
    try {
      await handle.ensureSchema();
      const result = await ingestActivity(handle.db, { adapter: source });
      assert.equal(result.ok, true);
      assert.equal(result.outcome, "PARTIAL");
      assert.deepEqual(result.gaps, [unreadable]);
      assert.deepEqual(result.coverageNotes, []);
    } finally {
      await handle.close();
    }
  });

  it("classifies only the exact Senate missing-date wording", async () => {
    const handle = createDb();
    const exact =
      'Senado · 1 comisión(es) sin fecha exacta en "AGENDA SEMANAL"; el campo date queda null.';
    const drift = "Senado · una comisión perdió su fecha por un error del parser.";
    try {
      await handle.ensureSchema();
      const complete = await ingestActivity(handle.db, {
        adapter: collectingAdapter("senado", [event({ source: "senado" })], [exact]),
      });
      assert.equal(complete.outcome, "COMPLETE");
      assert.deepEqual(complete.coverageNotes, [exact]);

      const partial = await ingestActivity(handle.db, {
        adapter: collectingAdapter(
          "senado",
          [event({ source: "senado", dedupeKey: "senate-drift" })],
          [drift],
        ),
      });
      assert.equal(partial.outcome, "PARTIAL");
      assert.deepEqual(partial.gaps, [drift]);
    } finally {
      await handle.close();
    }
  });

  it("records partial counters as FAILED and rethrows a streaming error", async () => {
    const handle = createDb();
    const source = adapter(async function* () {
      yield event();
      throw new Error("fixture upstream timeout");
    });

    try {
      await handle.ensureSchema();

      await assert.rejects(
        ingestActivity(handle.db, { adapter: source }),
        /fixture upstream timeout/,
      );
      const health = (await latestRunsBySource(handle.db)).find(
        (row) => row.source === "sil-actividad",
      );

      assert.equal(health?.ok, false);
      assert.equal(health?.outcome, "FAILED");
      assert.equal(health?.seen, 1);
      assert.equal(health?.inserted, 1);
      assert.equal(health?.updated, 0);
      assert.equal(health?.error, "fixture upstream timeout");
      assert.deepEqual(health?.details, {
        outcome: "FAILED",
        lifecycle: "EXPLICIT_BEGIN_FINISH",
        mode: "COMMITTEE_AND_PLENARY_AGENDA",
        committee: 1,
        plenary: 0,
        linkedCodes: 1,
      });
    } finally {
      await handle.close();
    }
  });
});
