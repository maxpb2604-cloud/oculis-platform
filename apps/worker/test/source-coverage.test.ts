import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyAgendaSourceGaps } from "../src/source-coverage.js";

describe("agenda source coverage classification", () => {
  it("accepts only the audited Diputados aggregate with zero evidence failures", () => {
    const exact =
      "Diputados · agenda PDF diaria: 7 de 12 filas no tuvieron un PDF único y verificable por fecha; 0 fila(s) no tuvieron evidencia literal suficiente de la comisión y su agenda dentro del PDF.";

    assert.deepEqual(classifyAgendaSourceGaps("sil-actividad", [exact]), {
      gaps: [],
      coverageNotes: [exact],
    });
  });

  it("keeps a nonzero Diputados evidence failure as an execution gap", () => {
    const failure =
      "Diputados · agenda PDF diaria: 7 de 12 filas no tuvieron un PDF único y verificable por fecha; 1 fila(s) no tuvieron evidencia literal suficiente de la comisión y su agenda dentro del PDF.";

    assert.deepEqual(classifyAgendaSourceGaps("sil-actividad", [failure]), {
      gaps: [failure],
      coverageNotes: [],
    });
  });

  it("keeps wording drift in the Diputados aggregate as an execution gap", () => {
    const drift =
      "Diputados · agenda PDF diaria: 7 de 12 filas no tuvieron un PDF único y verificable por fecha; 0 filas no tuvieron evidencia literal suficiente de la comisión y su agenda dentro del PDF.";

    assert.deepEqual(classifyAgendaSourceGaps("sil-actividad", [drift]), {
      gaps: [drift],
      coverageNotes: [],
    });
  });
});
