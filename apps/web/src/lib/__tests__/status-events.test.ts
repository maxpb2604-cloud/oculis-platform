import { describe, expect, it } from "vitest";
import { statusEvidenceLabel } from "@/lib/status-events";

describe("status evidence labels", () => {
  it("never describes unattributed legacy rows as source-reported history", () => {
    expect(statusEvidenceLabel("LEGACY_UNATTRIBUTED", "es")).toBe(
      "Registro heredado sin fuente atribuible",
    );
    expect(statusEvidenceLabel("LEGACY_UNATTRIBUTED", "es")).not.toContain(
      "reportado por la fuente",
    );
  });
});
