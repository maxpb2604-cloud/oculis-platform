/**
 * Shared types for the legislator-roster adapters (Diputados + Senado).
 *
 * These describe the *elected membership* of Congress — every senator and deputy and the
 * composition of each committee — which is distinct from the bills (`RawInitiative`) and
 * the daily agenda activity (`RawActivityEvent`). The ingestion worker upserts these into
 * the `legislators` and `commission_members` tables.
 */

/** One elected legislator (senator or deputy), source-agnostic. */
export interface RawLegislator {
  /** Stable id within the source (API id for Diputados, province slug for Senado). */
  sourceId: string;
  /** Adapter key: "roster-diputados" | "roster-senado". */
  source: string;
  chamber: "DIPUTADOS" | "SENADO";
  fullName: string;
  /** Represented province (Senate: exactly one per province + Distrito Nacional). */
  province: string | null;
  circumscription: string | null;
  party: string | null;
  partyShort: string | null;
  /** Directive-board role (e.g. "Presidente del Senado"), else null. */
  role: string | null;
  representationLevel: string | null;
  period: string | null;
  photoUrl: string | null;
  email: string | null;
  phone: string | null;
  profession: string | null;
  sourceUrl: string | null;
  raw?: unknown;
}

/** One person's seat on one committee, with their role (cargo). */
export interface RawCommissionMembership {
  source: string;
  chamber: "DIPUTADOS" | "SENADO";
  commissionName: string;
  commissionSourceId: string | null;
  legislatorName: string;
  legislatorSourceId: string | null;
  /** Normalized to: Presidente | Vicepresidente | Secretario | Miembro. */
  cargo: string | null;
  party: string | null;
  sourceUrl: string | null;
}

export interface RosterResult {
  legislators: RawLegislator[];
  memberships: RawCommissionMembership[];
  /** Reconciliation / health notes (e.g. "esperados 32, encontrados 30"). */
  gaps: string[];
}

/** Normalize the many cargo spellings ("Vice-Presidente/a", "VICEPRESIDENTE") to one of four. */
export function normalizeCargo(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z]/g, "");
  if (s.includes("vicepresident")) return "Vicepresidente";
  if (s.includes("president")) return "Presidente";
  if (s.includes("secretari")) return "Secretario";
  if (s.includes("miembro")) return "Miembro";
  return null;
}
