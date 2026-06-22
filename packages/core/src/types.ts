/**
 * Canonical domain types for Oculis Auribus.
 *
 * Terminology follows the original Spanish-language Excel workbooks
 * (`Monitoreo Legislativo`, `Monitoreo Regulatorio`) and the rubric in
 * `Fórmulas Nivel de Riesgo y Probabilidad de Aprobación.xlsx`.
 */

/** Level used for risk (Nivel de Riesgo) — ALTO / MEDIO / BAJO. */
export type RiskLevel = "ALTO" | "MEDIO" | "BAJO";

/** Level used for approval probability (Probabilidad de Aprobación) — ALTA / MEDIA / BAJA. */
export type ApprovalProbability = "ALTA" | "MEDIA" | "BAJA";

/** Which discriminates a legislative vs a regulatory initiative. */
export type InitiativeKind = "LEGISLATIVE" | "REGULATORY";

/** Chamber of the National Congress. */
export type Chamber = "SENADO" | "DIPUTADOS";

/**
 * Party position of the sponsor relative to the chamber.
 * Axis 1 of the risk matrix ("Partido del Proponente").
 */
export type PartyStrength =
  | "GOBIERNO" // Partido de gobierno (ruling party)
  | "OPOSICION_TERCIO" // Oposición con >= 1/3 de su cámara
  | "OPOSICION_MENOR"; // Oposición con < 1/3 de su cámara

/**
 * Sponsor's historical track record of approved bills.
 * Axis 2 of the risk matrix ("Cantidad de proyectos aprobados por el proponente").
 */
export type SponsorTrackRecord =
  | "MAS_DE_2" // > de 2 proyectos aprobados
  | "UNO" // 1 proyecto aprobado
  | "MENOS_DE_1"; // < de 1 proyecto aprobado

/** Yes/No judgment inputs. */
export type YesNo = "SI" | "NO";

/**
 * The five inputs that feed the approval-probability score and (with the
 * resulting probability) the business-risk matrix.
 *
 * `party` and `sponsorRecord` are auto-derivable from scraped data; the other
 * three are analyst-judgment fields that Claude estimates and an analyst may
 * override (see plan: hybrid scoring).
 */
export interface ScoreInputs {
  /** Partido del Proponente. */
  party: PartyStrength;
  /** Cantidad de proyectos aprobados por el proponente. */
  sponsorRecord: SponsorTrackRecord;
  /** Apoyo del Poder Ejecutivo. */
  executiveSupport: YesNo;
  /** Apoyo de Stakeholders Clave. */
  stakeholderSupport: YesNo;
  /**
   * Presión Social — number of supporting public-opinion mentions/signals.
   * Bucketed as < 6, 6–10, > 10 per the rubric.
   */
  socialPressureCount: number;
}

/** Result of scoring an initiative. */
export interface ScoreResult {
  approvalProbability: ApprovalProbability;
  approvalScore: number;
  riskLevel: RiskLevel;
}
