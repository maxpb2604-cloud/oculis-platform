import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { numericArg } from "../src/cli.js";

describe("numericArg", () => {
  it("accepts split and inline integer forms", () => {
    assert.equal(numericArg(["node", "worker", "--limit", "25"], "limit", { min: 1 }), 25);
    assert.equal(numericArg(["node", "worker", "--delay=0"], "delay", { min: 0 }), 0);
  });

  it("returns undefined when the flag is absent", () => {
    assert.equal(numericArg(["node", "worker", "--daily"], "limit", { min: 1 }), undefined);
  });

  it("rejects missing, malformed, non-finite, decimal, and out-of-range values", () => {
    assert.throws(() => numericArg(["--limit"], "limit", { min: 1 }), /requires a numeric value/);
    assert.throws(
      () => numericArg(["--limit", "--daily"], "limit", { min: 1 }),
      /requires a numeric value/,
    );
    assert.throws(() => numericArg(["--limit=nope"], "limit", { min: 1 }), /finite number/);
    assert.throws(() => numericArg(["--limit=Infinity"], "limit", { min: 1 }), /finite number/);
    assert.throws(() => numericArg(["--limit=1.5"], "limit", { min: 1 }), /integer/);
    assert.throws(() => numericArg(["--limit=0"], "limit", { min: 1 }), />= 1/);
  });

  it("rejects duplicate forms instead of choosing one ambiguously", () => {
    assert.throws(
      () => numericArg(["--pages", "1", "--pages=2"], "pages", { min: 1 }),
      /only be provided once/,
    );
  });
});
