/**
 * Canonical domain types for Oculis Auribus.
 *
 * Only factual discriminators reported by source adapters live in the core domain.
 */

/** Which discriminates a legislative vs a regulatory initiative. */
export type InitiativeKind = "LEGISLATIVE" | "REGULATORY";

/** Chamber of the National Congress. */
export type Chamber = "SENADO" | "DIPUTADOS";
