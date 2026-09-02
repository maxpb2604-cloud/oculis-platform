import type { SourceCadence, SourceRegistryStatus } from "@oculis/scrapers";
import type { Lang } from "@/lib/i18n";
import { sourceCompletionIsOverdue } from "@/lib/source-freshness";

export type SourceHealthStateKind =
  | "complete"
  | "stale"
  | "partial"
  | "failed"
  | "running"
  | "pending"
  | "gap";

export interface SourceHealthState {
  kind: SourceHealthStateKind;
  label: string;
  tone: "neutral" | "verified" | "warning" | "danger";
}

export interface SourceHealthRegistryFact {
  status: SourceRegistryStatus;
  cadence: SourceCadence;
  required: boolean;
}

export interface SourceHealthRunFact {
  outcome: "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED";
  seen: number;
  finishedAt: string | null;
  recordedAt: string;
}

export interface SourceHealthRowFact {
  registry: SourceHealthRegistryFact | null;
  run: SourceHealthRunFact | null;
}

export interface SourceHealthSummary {
  requiredTotal: number;
  requiredCurrent: number;
  requiredAttention: number;
  requiredStale: number;
  optionalTotal: number;
  optionalLimited: number;
  knownGaps: number;
  unregisteredProcesses: number;
}

/**
 * Classify one source without inferring health from a previous successful run.
 * The latest recorded outcome is authoritative, and scheduled COMPLETE runs age
 * into STALE after the explicit cadence threshold.
 */
export function sourceHealthState(
  row: SourceHealthRowFact,
  lang: Lang,
  nowMs: number = Date.now(),
): SourceHealthState {
  const es = lang === "es";
  if (row.registry?.status === "KNOWN_GAP") {
    return {
      kind: "gap",
      label: es ? "Cobertura no disponible" : "Coverage unavailable",
      tone: "warning",
    };
  }
  if (!row.run) {
    return {
      kind: "pending",
      label: es ? "Sin actualización registrada" : "No recorded update",
      tone: "neutral",
    };
  }
  if (row.run.outcome === "RUNNING") {
    return {
      kind: "running",
      label: es ? "Actualización en curso" : "Update in progress",
      tone: "warning",
    };
  }
  if (row.run.outcome === "COMPLETE") {
    const completedAt = row.run.finishedAt ?? row.run.recordedAt;
    if (row.registry && sourceCompletionIsOverdue(row.registry.cadence, completedAt, nowMs)) {
      return {
        kind: "stale",
        label: es ? "Actualización atrasada" : "Update overdue",
        tone: "warning",
      };
    }
    return {
      kind: "complete",
      label:
        row.run.seen === 0
          ? es
            ? "Ciclo completo · sin filas"
            : "Complete cycle · no rows"
          : es
            ? "Ciclo completo"
            : "Complete cycle",
      tone: "verified",
    };
  }
  if (row.run.outcome === "PARTIAL") {
    return {
      kind: "partial",
      label: es ? "Actualización parcial" : "Partial update",
      tone: "warning",
    };
  }
  if (row.run.outcome === "FAILED") {
    return {
      kind: "failed",
      label: es ? "No se pudo actualizar" : "Update failed",
      tone: "danger",
    };
  }
  return {
    kind: "pending",
    label: es ? "Resultado no informado" : "Result not reported",
    tone: "neutral",
  };
}

/**
 * Required-health KPIs deliberately exclude optional integrations, declared
 * known gaps, and unregistered internal records. This keeps the headline honest:
 * only a current COMPLETE run can be green, while every other required state is
 * either explicitly stale or in attention.
 */
export function summarizeSourceHealth(
  rows: readonly SourceHealthRowFact[],
  nowMs: number = Date.now(),
): SourceHealthSummary {
  const summary: SourceHealthSummary = {
    requiredTotal: 0,
    requiredCurrent: 0,
    requiredAttention: 0,
    requiredStale: 0,
    optionalTotal: 0,
    optionalLimited: 0,
    knownGaps: 0,
    unregisteredProcesses: 0,
  };

  for (const row of rows) {
    if (!row.registry) {
      summary.unregisteredProcesses += 1;
      continue;
    }
    if (row.registry.status === "KNOWN_GAP") {
      summary.knownGaps += 1;
      continue;
    }

    const state = sourceHealthState(row, "es", nowMs);
    if (!row.registry.required) {
      summary.optionalTotal += 1;
      if (state.kind !== "complete") summary.optionalLimited += 1;
      continue;
    }

    summary.requiredTotal += 1;
    if (state.kind === "complete") summary.requiredCurrent += 1;
    else if (state.kind === "stale") summary.requiredStale += 1;
    else summary.requiredAttention += 1;
  }

  return summary;
}
