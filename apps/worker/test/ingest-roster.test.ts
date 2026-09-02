import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDb, legislatorCommittees, listLegislators } from "@oculis/db";
import type { RosterResult } from "@oculis/scrapers";
import {
  classifyRosterGaps,
  rosterMinimumError,
  rosterSnapshotError,
  runRosterSource,
} from "../src/ingest-roster.js";

const NO_EFFECTIVE_DATE =
  "roster-senado: el listado HTML de comisiones no publica una fecha exacta de vigencia; no se infiere ni se fabrica una.";
const EXACT_UNRESOLVED_COVERAGE =
  "roster-senado: 50 de 251 membresías no tienen una coincidencia exacta y única de nombre; legislatorSourceId queda null.";

function senateSnapshot({
  membershipCount = 251,
  unresolvedMemberships = 50,
  gaps = [NO_EFFECTIVE_DATE, EXACT_UNRESOLVED_COVERAGE],
}: {
  membershipCount?: number;
  unresolvedMemberships?: number;
  gaps?: string[];
} = {}): RosterResult {
  return {
    legislators: Array.from({ length: 32 }, (_, index) => ({
      source: "roster-senado",
      sourceId: `seat-${index + 1}`,
      chamber: "SENADO" as const,
      fullName: `Persona Senadora ${index + 1}`,
      province: `Provincia ${index + 1}`,
      circumscription: null,
      party: null,
      partyShort: null,
      role: null,
      representationLevel: null,
      period: "2024-2028",
      photoUrl: null,
      email: null,
      phone: null,
      profession: null,
      sourceUrl: "https://www.senadord.gob.do/senadores-2024-2028/",
    })),
    memberships: Array.from({ length: membershipCount }, (_, index) => ({
      source: "roster-senado",
      chamber: "SENADO" as const,
      commissionName: `Comisión ${index + 1}`,
      commissionSourceId: null,
      legislatorName: `Integrante ${index + 1}`,
      legislatorSourceId: index < unresolvedMemberships ? null : `seat-${(index % 32) + 1}`,
      cargo: "Miembro",
      party: null,
      sourceUrl: "https://www.senadord.gob.do/comisiones/lista-de-comisiones/",
    })),
    gaps,
  };
}

describe("roster cardinality thresholds", () => {
  it("rejects incomplete or impossible chamber payloads", () => {
    assert.match(rosterMinimumError("roster-diputados", 149) ?? "", /mínimo seguro 150/);
    assert.match(rosterMinimumError("roster-senado", 31) ?? "", /exacta 32/);
    assert.match(rosterMinimumError("roster-senado", 33) ?? "", /exacta 32/);
  });

  it("accepts only the safe cardinality for each chamber", () => {
    assert.equal(rosterMinimumError("roster-diputados", 150), null);
    assert.equal(rosterMinimumError("roster-senado", 32), null);
  });
});

describe("roster gap classification", () => {
  it("marks only the two audited 32/251 Senate gaps as COMPLETE coverage notes", () => {
    const assessment = classifyRosterGaps(
      "roster-senado",
      { legislators: 32, memberships: 251, unresolvedMemberships: 50 },
      [NO_EFFECTIVE_DATE, EXACT_UNRESOLVED_COVERAGE],
    );

    assert.equal(assessment.outcome, "COMPLETE");
    assert.deepEqual(assessment.gaps, []);
    assert.deepEqual(assessment.coverageNotes, [NO_EFFECTIVE_DATE, EXACT_UNRESOLVED_COVERAGE]);
  });

  it("keeps a 49/251 mismatch structural and PARTIAL", () => {
    const mismatch =
      "roster-senado: 49 de 251 membresías no tienen una coincidencia exacta y única de nombre; legislatorSourceId queda null.";
    const assessment = classifyRosterGaps(
      "roster-senado",
      { legislators: 32, memberships: 251, unresolvedMemberships: 49 },
      [NO_EFFECTIVE_DATE, mismatch],
    );

    assert.equal(assessment.outcome, "PARTIAL");
    assert.deepEqual(assessment.coverageNotes, []);
    assert.deepEqual(assessment.gaps, [NO_EFFECTIVE_DATE, mismatch]);
  });

  it("keeps every new message structural even beside the two audited notes", () => {
    const newGap = "roster-senado: la estructura oficial cambió.";
    const assessment = classifyRosterGaps(
      "roster-senado",
      { legislators: 32, memberships: 251, unresolvedMemberships: 50 },
      [NO_EFFECTIVE_DATE, EXACT_UNRESOLVED_COVERAGE, newGap],
    );

    assert.equal(assessment.outcome, "PARTIAL");
    assert.deepEqual(assessment.coverageNotes, [NO_EFFECTIVE_DATE, EXACT_UNRESOLVED_COVERAGE]);
    assert.deepEqual(assessment.gaps, [newGap]);
  });
});

describe("Senate roster snapshot replacement gate", () => {
  it("accepts only the exact audited 32/251/50 snapshot and its two known notes", () => {
    assert.equal(rosterSnapshotError("roster-senado", senateSnapshot()), null);
    assert.match(
      rosterSnapshotError("roster-senado", senateSnapshot({ membershipCount: 250 })) ?? "",
      /exactamente 32\/251\/50/,
    );
    assert.match(
      rosterSnapshotError("roster-senado", senateSnapshot({ unresolvedMemberships: 49 })) ?? "",
      /exactamente 32\/251\/50/,
    );
    assert.match(
      rosterSnapshotError("roster-senado", senateSnapshot({ unresolvedMemberships: 51 })) ?? "",
      /exactamente 32\/251\/50/,
    );
    assert.match(
      rosterSnapshotError(
        "roster-senado",
        senateSnapshot({ gaps: [NO_EFFECTIVE_DATE, EXACT_UNRESOLVED_COVERAGE, "drift"] }),
      ) ?? "",
      /dos notas auditadas/,
    );
    const duplicatedSeat = senateSnapshot();
    duplicatedSeat.legislators[31] = {
      ...duplicatedSeat.legislators[31]!,
      sourceId: duplicatedSeat.legislators[0]!.sourceId,
    };
    assert.match(rosterSnapshotError("roster-senado", duplicatedSeat) ?? "", /claves únicas/);
  });

  it("preserves the last valid roster and memberships after partial incoming snapshots", async () => {
    const handle = createDb();
    try {
      await handle.ensureSchema();
      const valid = senateSnapshot();
      const accepted = await runRosterSource(
        handle.db,
        "roster-senado",
        async () => valid,
        () => {},
      );
      assert.equal(accepted.outcome, "COMPLETE");

      const beforeRoster = (await listLegislators(handle.db)).filter(
        (row) => row.source === "roster-senado",
      );
      const beforeMemberships = (await legislatorCommittees(handle.db)).filter(
        (row) => row.source === "roster-senado",
      );
      assert.equal(beforeRoster.length, 32);
      assert.equal(beforeMemberships.length, 251);

      for (const partial of [
        senateSnapshot({ membershipCount: 250 }),
        senateSnapshot({ unresolvedMemberships: 49 }),
        senateSnapshot({ unresolvedMemberships: 51 }),
      ]) {
        const rejected = await runRosterSource(
          handle.db,
          "roster-senado",
          async () => partial,
          () => {},
        );
        assert.equal(rejected.outcome, "FAILED");
        assert.equal(rejected.ok, false);
        assert.deepEqual(
          (await listLegislators(handle.db))
            .filter((row) => row.source === "roster-senado")
            .map((row) => [row.sourceId, row.fullName]),
          beforeRoster.map((row) => [row.sourceId, row.fullName]),
        );
        assert.deepEqual(
          (await legislatorCommittees(handle.db))
            .filter((row) => row.source === "roster-senado")
            .map((row) => [row.commissionName, row.legislatorName, row.legislatorSourceId]),
          beforeMemberships.map((row) => [
            row.commissionName,
            row.legislatorName,
            row.legislatorSourceId,
          ]),
        );
      }
    } finally {
      await handle.close();
    }
  });
});
