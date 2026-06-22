/**
 * Derive the auto-fillable scoring inputs (party strength, sponsor track record) and
 * compose the full five-input `ScoreInputs` together with the Claude/heuristic estimate
 * of the three judgment fields (see score.ts). Feeds the ported Excel formulas in
 * `@oculis/core` (score()).
 */
import type {
  PartyStrength,
  ScoreInputs,
  SponsorTrackRecord,
} from "@oculis/core";
import type { ScoreEstimate } from "./score.js";

/** Current ruling party (Partido de Gobierno), period 2024-2028. */
const RULING_PARTY_SIGLAS = new Set(["PRM"]);
/** Major opposition parties holding ~>= 1/3 of a chamber (best-effort). */
const MAJOR_OPPOSITION_SIGLAS = new Set(["PLD", "FP"]);

export function derivePartyStrength(siglas: string | null): PartyStrength {
  if (!siglas) return "OPOSICION_MENOR";
  const s = siglas.trim().toUpperCase();
  if (RULING_PARTY_SIGLAS.has(s)) return "GOBIERNO";
  if (MAJOR_OPPOSITION_SIGLAS.has(s)) return "OPOSICION_TERCIO";
  return "OPOSICION_MENOR";
}

/** Map a sponsor's count of prior approved initiatives to the track-record tier. */
export function deriveSponsorRecord(approvedCount: number): SponsorTrackRecord {
  if (approvedCount > 2) return "MAS_DE_2";
  if (approvedCount >= 1) return "UNO";
  return "MENOS_DE_1";
}

/** Assemble the full five-input object the core formulas consume. */
export function composeScoreInputs(
  partyStrength: PartyStrength,
  sponsorRecord: SponsorTrackRecord,
  estimate: ScoreEstimate,
): ScoreInputs {
  return {
    party: partyStrength,
    sponsorRecord,
    executiveSupport: estimate.executiveSupport,
    stakeholderSupport: estimate.stakeholderSupport,
    socialPressureCount: estimate.socialPressureCount,
  };
}
