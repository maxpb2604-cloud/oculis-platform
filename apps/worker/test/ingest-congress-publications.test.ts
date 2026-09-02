import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessCongressPublicationHealth } from "../src/ingest-congress-publications.js";

describe("congress-publication health semantics", () => {
  it("keeps exact initiative-code misses as coverage while execution is complete", () => {
    const note =
      "Senado · Proyectos aprobados: 2 código(s) exacto(s) no identificaron un PDL único del corpus del Senado.";

    assert.deepEqual(assessCongressPublicationHealth(0, [], [note]), {
      ok: true,
      outcome: "COMPLETE",
      gaps: [],
      coverageNotes: [note],
    });
  });

  it("keeps an unclassified reconciliation gap PARTIAL", () => {
    const gap = "Cámara · catálogo conocido: 12 de 13 documento(s) reconciliados.";

    assert.deepEqual(assessCongressPublicationHealth(0, [gap], []), {
      ok: true,
      outcome: "PARTIAL",
      gaps: [gap],
      coverageNotes: [],
    });
  });

  it("never hides a document request failure behind coverage notes", () => {
    const note =
      "Senado · Proyectos perimidos: 1 código(s) exacto(s) no identificaron un PDL único del corpus del Senado.";

    assert.deepEqual(assessCongressPublicationHealth(1, [], [note]), {
      ok: false,
      outcome: "PARTIAL",
      gaps: [],
      coverageNotes: [note],
      error: "1 official document request(s) failed",
    });
  });
});
