import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSourcesOk } from "../src/reliability.js";

describe("assertSourcesOk", () => {
  it("allows an empty or fully healthy source set", () => {
    assert.doesNotThrow(() => assertSourcesOk("daily", []));
    assert.doesNotThrow(() =>
      assertSourcesOk("daily", [
        { source: "activity", ok: true },
        { source: "feed", ok: true },
      ]),
    );
  });

  it("throws once with every failed source named", () => {
    assert.throws(
      () =>
        assertSourcesOk("daily", [
          { source: "activity", ok: false },
          { source: "feed", ok: true },
          { source: "deposits", ok: false },
        ]),
      /daily: 2 source\(s\) failed: activity, deposits/,
    );
  });
});
