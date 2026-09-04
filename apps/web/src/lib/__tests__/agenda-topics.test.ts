import { describe, expect, it } from "vitest";
import { officialExpedienteReferences, publishedAgendaTopic } from "../agenda-topics";

describe("publishedAgendaTopic", () => {
  it("keeps literal topic copy from the official activity", () => {
    expect(
      publishedAgendaTopic(
        "Analizar las iniciativas legislativas pendientes de estudio.",
        "Comisión Permanente de Turismo",
      ),
    ).toBe("Analizar las iniciativas legislativas pendientes de estudio.");
  });

  it("does not present a committee-name fallback as an official topic", () => {
    expect(
      publishedAgendaTopic("  Comisión   Permanente de Turismo ", "Comisión Permanente de Turismo"),
    ).toBeNull();
  });
});

describe("officialExpedienteReferences", () => {
  it("keeps unique literal numeric references from the source payload", () => {
    expect(
      officialExpedienteReferences({
        payload: { expedientes: ["12345", 67890, "12345", " 24680 "] },
      }),
    ).toEqual(["12345", "67890", "24680"]);
  });

  it("ignores values that are not safe literal expediente numbers", () => {
    expect(
      officialExpedienteReferences({
        payload: { expedientes: [null, "12-A", "", { id: 1 }, "1234567890123"] },
      }),
    ).toEqual([]);
    expect(officialExpedienteReferences(null)).toEqual([]);
  });
});
