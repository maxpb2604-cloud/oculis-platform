import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rosterMinimumError } from "../src/ingest-roster.js";

describe("roster cardinality thresholds", () => {
  it("rejects dangerously small chamber payloads", () => {
    assert.match(rosterMinimumError("roster-diputados", 149) ?? "", /mínimo seguro 150/);
    assert.match(rosterMinimumError("roster-senado", 29) ?? "", /mínimo seguro 30/);
  });

  it("accepts payloads at or above each safety threshold", () => {
    assert.equal(rosterMinimumError("roster-diputados", 150), null);
    assert.equal(rosterMinimumError("roster-senado", 30), null);
  });
});
