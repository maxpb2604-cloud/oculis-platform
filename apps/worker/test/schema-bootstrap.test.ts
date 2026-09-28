import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prepareWorkerSchema } from "../src/schema-bootstrap.js";

describe("worker schema bootstrap policy", () => {
  it("keeps local and test bootstrap behavior when the setting is absent", async () => {
    let calls = 0;
    const result = await prepareWorkerSchema(
      {
        async ensureSchema() {
          calls += 1;
        },
      },
      { env: {} },
    );

    assert.equal(result, "applied");
    assert.equal(calls, 1);
  });

  it("skips repeated worker DDL only when automatic migration is explicitly disabled", async () => {
    let calls = 0;
    const logs: string[] = [];
    const result = await prepareWorkerSchema(
      {
        async ensureSchema() {
          calls += 1;
        },
      },
      { env: { OCULIS_AUTO_MIGRATE: "0" }, log: (message) => logs.push(message) },
    );

    assert.equal(result, "skipped");
    assert.equal(calls, 0);
    assert.deepEqual(logs, ["  schema bootstrap skipped (OCULIS_AUTO_MIGRATE=0)"]);
  });

  it("forces the explicit workflow bootstrap and propagates database failures", async () => {
    const quotaError = Object.assign(new Error("data transfer quota exceeded"), { code: "53000" });
    await assert.rejects(
      prepareWorkerSchema(
        {
          async ensureSchema() {
            throw quotaError;
          },
        },
        { env: { OCULIS_AUTO_MIGRATE: "0" }, force: true },
      ),
      (error: unknown) => error === quotaError && (error as { code?: string }).code === "53000",
    );
  });
});
