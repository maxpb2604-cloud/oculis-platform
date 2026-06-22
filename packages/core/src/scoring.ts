/**
 * Risk-level and approval-probability scoring.
 *
 * Ported verbatim from the client's rubric workbook
 * `Fórmulas Nivel de Riesgo y Probabilidad de Aprobación.xlsx`.
 *
 * APPROVAL PROBABILITY (Probabilidad de Aprobación)
 *   Sum of five weighted inputs:
 *     - Partido del Proponente:        GOBIERNO=3, OPOSICION_TERCIO=2, OPOSICION_MENOR=1
 *     - Proyectos aprobados:           MAS_DE_2=3, UNO=2, MENOS_DE_1=1
 *     - Apoyo del Poder Ejecutivo:     SI=3, NO=1
 *     - Apoyo de Stakeholders Clave:   SI=2, NO=1
 *     - Presión Social (opinión púb.): <6 => 1, 6–10 => 2, >10 => 3
 *   Bucket: sum < 6 => BAJA, 6–10 => MEDIA, > 10 => ALTA.
 *
 * BUSINESS RISK (Nivel de Riesgo)
 *   27-row lookup over three axes:
 *     Axis 1 (Partido):       GOBIERNO=1A, OPOSICION_TERCIO=1B, OPOSICION_MENOR=1C
 *     Axis 2 (Proyectos):     MAS_DE_2=2A, UNO=2B, MENOS_DE_1=2C
 *     Axis 3 (Probabilidad):  ALTA=3A, MEDIA=3B, BAJA=3C
 *   The table below is the exact ALTO/MEDIO/BAJO mapping from the workbook.
 */
import type {
  ApprovalProbability,
  PartyStrength,
  RiskLevel,
  ScoreInputs,
  ScoreResult,
  SponsorTrackRecord,
  YesNo,
} from "./types.js";

const PARTY_POINTS: Record<PartyStrength, number> = {
  GOBIERNO: 3,
  OPOSICION_TERCIO: 2,
  OPOSICION_MENOR: 1,
};

const SPONSOR_POINTS: Record<SponsorTrackRecord, number> = {
  MAS_DE_2: 3,
  UNO: 2,
  MENOS_DE_1: 1,
};

const EXECUTIVE_POINTS: Record<YesNo, number> = { SI: 3, NO: 1 };
const STAKEHOLDER_POINTS: Record<YesNo, number> = { SI: 2, NO: 1 };

/** Presión Social points from supporting public-opinion count. */
function socialPressurePoints(count: number): number {
  if (count < 6) return 1;
  if (count <= 10) return 2;
  return 3;
}

/** Raw approval score = sum of the five weighted inputs (range 5–14). */
export function approvalScore(inputs: ScoreInputs): number {
  return (
    PARTY_POINTS[inputs.party] +
    SPONSOR_POINTS[inputs.sponsorRecord] +
    EXECUTIVE_POINTS[inputs.executiveSupport] +
    STAKEHOLDER_POINTS[inputs.stakeholderSupport] +
    socialPressurePoints(inputs.socialPressureCount)
  );
}

/** Bucket the approval score into ALTA / MEDIA / BAJA. */
export function approvalProbability(score: number): ApprovalProbability {
  if (score < 6) return "BAJA";
  if (score <= 10) return "MEDIA";
  return "ALTA";
}

const PARTY_AXIS: Record<PartyStrength, "1A" | "1B" | "1C"> = {
  GOBIERNO: "1A",
  OPOSICION_TERCIO: "1B",
  OPOSICION_MENOR: "1C",
};

const SPONSOR_AXIS: Record<SponsorTrackRecord, "2A" | "2B" | "2C"> = {
  MAS_DE_2: "2A",
  UNO: "2B",
  MENOS_DE_1: "2C",
};

const PROBABILITY_AXIS: Record<ApprovalProbability, "3A" | "3B" | "3C"> = {
  ALTA: "3A",
  MEDIA: "3B",
  BAJA: "3C",
};

/** Exact 27-row risk matrix from the rubric workbook. Key = `${a1}-${a2}-${a3}`. */
const RISK_MATRIX: Record<string, RiskLevel> = {
  "1A-2A-3A": "ALTO",
  "1A-2B-3A": "ALTO",
  "1A-2C-3A": "MEDIO",
  "1A-2A-3B": "ALTO",
  "1A-2A-3C": "MEDIO",
  "1A-2B-3B": "MEDIO",
  "1A-2B-3C": "MEDIO",
  "1A-2C-3B": "MEDIO",
  "1A-2C-3C": "BAJO",
  "1B-2A-3A": "ALTO",
  "1B-2A-3B": "ALTO",
  "1B-2A-3C": "MEDIO",
  "1B-2B-3A": "ALTO",
  "1B-2B-3B": "MEDIO",
  "1B-2B-3C": "MEDIO",
  "1B-2C-3A": "MEDIO",
  "1B-2C-3B": "MEDIO",
  "1B-2C-3C": "BAJO",
  "1C-2A-3A": "MEDIO",
  "1C-2A-3B": "MEDIO",
  "1C-2A-3C": "BAJO",
  "1C-2B-3A": "MEDIO",
  "1C-2B-3B": "BAJO",
  "1C-2B-3C": "BAJO",
  "1C-2C-3A": "MEDIO",
  "1C-2C-3B": "BAJO",
  "1C-2C-3C": "BAJO",
};

/** Look up business risk from the three axes. */
export function riskLevel(
  party: PartyStrength,
  sponsorRecord: SponsorTrackRecord,
  probability: ApprovalProbability,
): RiskLevel {
  const key = `${PARTY_AXIS[party]}-${SPONSOR_AXIS[sponsorRecord]}-${PROBABILITY_AXIS[probability]}`;
  const level = RISK_MATRIX[key];
  if (!level) throw new Error(`No risk-matrix entry for ${key}`);
  return level;
}

/** Full scoring: approval probability + business risk from the five inputs. */
export function score(inputs: ScoreInputs): ScoreResult {
  const raw = approvalScore(inputs);
  const probability = approvalProbability(raw);
  return {
    approvalScore: raw,
    approvalProbability: probability,
    riskLevel: riskLevel(inputs.party, inputs.sponsorRecord, probability),
  };
}
