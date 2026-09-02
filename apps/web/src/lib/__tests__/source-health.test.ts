import { describe, expect, it } from "vitest";
import {
  sourceHealthState,
  summarizeSourceHealth,
  type SourceHealthRegistryFact,
  type SourceHealthRowFact,
  type SourceHealthRunFact,
} from "../source-health";

const HOUR_MS = 60 * 60 * 1_000;
const NOW = Date.parse("2026-09-02T16:00:00.000Z");

function registry(
  required: boolean,
  overrides: Partial<SourceHealthRegistryFact> = {},
): SourceHealthRegistryFact {
  return {
    status: "ACTIVE",
    cadence: "DAILY",
    required,
    ...overrides,
  };
}

function run(outcome: SourceHealthRunFact["outcome"], ageMs = HOUR_MS): SourceHealthRunFact {
  const completedAt = new Date(NOW - ageMs).toISOString();
  return {
    outcome,
    seen: 12,
    recordedAt: completedAt,
    finishedAt: outcome === "RUNNING" ? null : completedAt,
  };
}

describe("source health classification", () => {
  it("marks only a current COMPLETE cycle green in Spanish and English", () => {
    const row = { registry: registry(true), run: run("COMPLETE") };

    expect(sourceHealthState(row, "es", NOW)).toMatchObject({
      kind: "complete",
      tone: "verified",
      label: "Ciclo completo",
    });
    expect(sourceHealthState(row, "en", NOW)).toMatchObject({
      kind: "complete",
      tone: "verified",
      label: "Complete cycle",
    });
  });

  it("keeps a required PARTIAL cycle in attention instead of using its prior success", () => {
    const state = sourceHealthState({ registry: registry(true), run: run("PARTIAL") }, "es", NOW);

    expect(state).toEqual({
      kind: "partial",
      tone: "warning",
      label: "Actualización parcial",
    });
  });

  it("separates a COMPLETE but overdue required source from current sources", () => {
    const state = sourceHealthState(
      { registry: registry(true), run: run("COMPLETE", 36 * HOUR_MS + 1) },
      "en",
      NOW,
    );

    expect(state).toEqual({
      kind: "stale",
      tone: "warning",
      label: "Update overdue",
    });
  });

  it("keeps a declared known gap visible without inventing a run state", () => {
    const state = sourceHealthState(
      {
        registry: registry(false, { status: "KNOWN_GAP", cadence: "NOT_SCHEDULED" }),
        run: null,
      },
      "es",
      NOW,
    );

    expect(state).toEqual({
      kind: "gap",
      tone: "warning",
      label: "Cobertura no disponible",
    });
  });
});

describe("required source health KPIs", () => {
  it("excludes optional, known-gap, and unregistered rows from required health", () => {
    const rows: SourceHealthRowFact[] = [
      { registry: registry(true), run: run("COMPLETE") },
      { registry: registry(true), run: run("PARTIAL") },
      { registry: registry(true), run: run("FAILED") },
      { registry: registry(true), run: run("RUNNING") },
      { registry: registry(true), run: null },
      { registry: registry(true), run: run("COMPLETE", 36 * HOUR_MS + 1) },
      { registry: registry(false), run: run("COMPLETE") },
      { registry: registry(false), run: run("PARTIAL") },
      { registry: registry(false), run: null },
      {
        registry: registry(false, { status: "KNOWN_GAP", cadence: "NOT_SCHEDULED" }),
        run: null,
      },
      { registry: null, run: run("FAILED") },
    ];

    expect(summarizeSourceHealth(rows, NOW)).toEqual({
      requiredTotal: 6,
      requiredCurrent: 1,
      requiredAttention: 4,
      requiredStale: 1,
      optionalTotal: 3,
      optionalLimited: 2,
      knownGaps: 1,
      unregisteredProcesses: 1,
    });
  });

  it("never counts required PARTIAL, FAILED, RUNNING, or missing runs as green", () => {
    const rows: SourceHealthRowFact[] = [
      { registry: registry(true), run: run("PARTIAL") },
      { registry: registry(true), run: run("FAILED") },
      { registry: registry(true), run: run("RUNNING") },
      { registry: registry(true), run: null },
    ];

    const summary = summarizeSourceHealth(rows, NOW);
    expect(summary.requiredCurrent).toBe(0);
    expect(summary.requiredAttention).toBe(4);
    expect(summary.requiredStale).toBe(0);
  });
});
