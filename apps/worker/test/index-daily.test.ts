import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runDailyDataRefresh } from "../src/index.js";

describe("daily orchestration", () => {
  it("defers a proponent-linker exception until unrelated daily and feed work completes", async () => {
    const calls: string[] = [];
    let senateCall = 0;
    const result = await runDailyDataRefresh({} as never, {
      dependencies: {
        ingestDeposits: (async () => {
          calls.push("diputados-deposits");
          return { source: "dip", ok: true, deposits: 1 };
        }) as never,
        ingestSenateDeposits: (async (
          _db: unknown,
          options: { enrichFichas?: boolean; resumeFichas?: boolean },
        ) => {
          senateCall++;
          if (senateCall === 1) {
            calls.push("senate-deposits");
            assert.equal(options.enrichFichas, undefined);
            return { source: "senado-sil-deposits", ok: true, deposits: 1 };
          }
          calls.push("senate-fichas-refresh");
          assert.equal(options.enrichFichas, true);
          assert.equal(options.resumeFichas, false);
          return {
            source: "senado-sil-fichas",
            ok: true,
            deposits: 1,
            statusChanges: 1,
          };
        }) as never,
        linkInitiativeProponents: (async (_db: unknown, options: { recordCoverage?: boolean }) => {
          calls.push("proponent-linker");
          assert.equal(options.recordCoverage, false);
          throw new Error("simulated linker failure");
        }) as never,
        runDaily: (async () => {
          calls.push("agenda-and-status");
          return [];
        }) as never,
        ingestFeed: (async () => {
          calls.push("feed");
          return [];
        }) as never,
      },
    });

    assert.deepEqual(calls, [
      "diputados-deposits",
      "senate-deposits",
      "senate-fichas-refresh",
      "proponent-linker",
      "agenda-and-status",
      "feed",
    ]);
    assert.equal(result.proponentLinks, null);
    assert.equal(result.senDep.source, "senado-sil-deposits");
    assert.equal(result.senFicha.source, "senado-sil-fichas");
    assert.match(result.proponentFailure?.message ?? "", /simulated linker failure/);
  });
});
