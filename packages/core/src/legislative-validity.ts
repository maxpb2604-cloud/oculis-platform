/**
 * Constitutional lifecycle of a Dominican legislative initiative.
 *
 * "VIGENTE" and "NO_VIGENTE" are deliberately reserved for legislative
 * initiatives. Regulatory consultations use OPEN/CLOSED terminology elsewhere.
 */

export type OrdinaryLegislature = Readonly<{ year: number; term: "PLO" | "SLO" }>;

export type LegislativeValidity =
  | {
      state: "VIGENTE" | "NO_VIGENTE";
      basis: "OFFICIAL" | "CALCULATED";
      reason: "SOURCE_REPORTS_PERIMIDA" | "SOURCE_EXPIRATION_DATE" | "TWO_ORDINARY_LEGISLATURES";
      expiresAt: string | null;
      startLegislature: string | null;
      endLegislature: string | null;
    }
  | {
      state: "CONCLUIDA";
      basis: "OFFICIAL";
      reason: "TERMINAL_STATUS";
      expiresAt: null;
      startLegislature: null;
      endLegislature: null;
    }
  | {
      state: "POR_CONFIRMAR";
      basis: "CALCULATED";
      reason:
        | "MISSING_FILING_LEGISLATURE"
        | "CONFLICTING_FILING_EVIDENCE"
        | "LEGAL_EXCEPTION_REVIEW";
      expiresAt: null;
      startLegislature: string | null;
      endLegislature: null;
    };

export interface LegislativeValidityInput {
  filedAt?: string | null;
  legislature?: string | null;
  expiresAt?: string | null;
  condition?: string | null;
  status?: string | null;
}

function normalized(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es-DO");
}

export function validISODate(value: string | null | undefined): string | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? `${match[1]}-${match[2]}-${match[3]}`
    : null;
}

export function addUtcDays(year: number, monthIndex: number, day: number, days: number): string {
  return new Date(Date.UTC(year, monthIndex, day + days)).toISOString().slice(0, 10);
}

export function parseOrdinaryLegislature(
  value: string | null | undefined,
): OrdinaryLegislature | null {
  const match = normalized(value)
    .toUpperCase()
    .match(/^(\d{4})-(PLO|SLO)$/);
  return match?.[1] && match[2]
    ? { year: Number(match[1]), term: match[2] as "PLO" | "SLO" }
    : null;
}

/** Ordinary legislature containing the filing date; recess dates remain unresolved. */
export function ordinaryLegislatureForDate(
  value: string | null | undefined,
): OrdinaryLegislature | null {
  const date = validISODate(value);
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  const ploStart = `${year}-02-27`;
  const ploEnd = addUtcDays(year, 1, 27, 149);
  if (date >= ploStart && date <= ploEnd) return { year, term: "PLO" };

  const sloStart = `${year}-08-16`;
  if (date >= sloStart) return { year, term: "SLO" };

  const priorSloEnd = addUtcDays(year - 1, 7, 16, 149);
  if (date <= priorSloEnd) return { year: year - 1, term: "SLO" };
  return null;
}

export function ordinaryLegislatureCode(value: OrdinaryLegislature): string {
  return `${value.year}-${value.term}`;
}

/** Closing date of the second ordinary legislature, counting the filing term as first. */
export function secondLegislatureClosingDate(start: OrdinaryLegislature): {
  date: string;
  endLegislature: string;
} {
  if (start.term === "PLO") {
    return {
      date: addUtcDays(start.year, 7, 16, 149),
      endLegislature: `${start.year}-SLO`,
    };
  }
  const nextYear = start.year + 1;
  return {
    date: addUtcDays(nextYear, 1, 27, 149),
    endLegislature: `${nextYear}-PLO`,
  };
}

function terminalStatus(value: string | null | undefined): boolean {
  return /^(?:promulgad[oa]|rechazad[oa]|retirad[oa]|convertid[oa] en ley)(?:\b|\s|[.:;-])/.test(
    normalized(value),
  );
}

function perempted(value: string | null | undefined): boolean {
  return /^(?:perimid[oa]|no vigente)(?:\b|\s|[.:;-])/.test(normalized(value));
}

/**
 * Classify a legislative initiative as of an exact Dominican calendar date.
 *
 * A reintroduction is a new legislative filing and is therefore evaluated from
 * its own filing date/legislature. It does not make the older, perempted record
 * current again.
 */
export function classifyLegislativeValidity(
  input: LegislativeValidityInput,
  asOf: string,
): LegislativeValidity {
  const today = validISODate(asOf);
  if (!today) throw new Error("asOf must be an exact ISO calendar date (YYYY-MM-DD)");

  if (terminalStatus(input.status) || terminalStatus(input.condition)) {
    return {
      state: "CONCLUIDA",
      basis: "OFFICIAL",
      reason: "TERMINAL_STATUS",
      expiresAt: null,
      startLegislature: null,
      endLegislature: null,
    };
  }
  if (perempted(input.status) || perempted(input.condition)) {
    return {
      state: "NO_VIGENTE",
      basis: "OFFICIAL",
      reason: "SOURCE_REPORTS_PERIMIDA",
      expiresAt: validISODate(input.expiresAt),
      startLegislature: null,
      endLegislature: null,
    };
  }

  const publishedExpiry = validISODate(input.expiresAt);
  if (publishedExpiry) {
    return {
      state: today <= publishedExpiry ? "VIGENTE" : "NO_VIGENTE",
      basis: "OFFICIAL",
      reason: "SOURCE_EXPIRATION_DATE",
      expiresAt: publishedExpiry,
      startLegislature: null,
      endLegislature: null,
    };
  }

  const reported = parseOrdinaryLegislature(input.legislature);
  const fromFilingDate = ordinaryLegislatureForDate(input.filedAt);
  if (
    reported &&
    fromFilingDate &&
    ordinaryLegislatureCode(reported) !== ordinaryLegislatureCode(fromFilingDate)
  ) {
    return {
      state: "POR_CONFIRMAR",
      basis: "CALCULATED",
      reason: "CONFLICTING_FILING_EVIDENCE",
      expiresAt: null,
      startLegislature: ordinaryLegislatureCode(reported),
      endLegislature: null,
    };
  }

  const start = reported ?? fromFilingDate;
  if (!start) {
    return {
      state: "POR_CONFIRMAR",
      basis: "CALCULATED",
      reason: "MISSING_FILING_LEGISLATURE",
      expiresAt: null,
      startLegislature: null,
      endLegislature: null,
    };
  }

  // The 2020 emergency extensions require case-by-case review; do not manufacture
  // an expiry date from the ordinary 150-day calendar.
  if (start.year === 2020) {
    return {
      state: "POR_CONFIRMAR",
      basis: "CALCULATED",
      reason: "LEGAL_EXCEPTION_REVIEW",
      expiresAt: null,
      startLegislature: ordinaryLegislatureCode(start),
      endLegislature: null,
    };
  }

  const expiry = secondLegislatureClosingDate(start);
  return {
    state: today <= expiry.date ? "VIGENTE" : "NO_VIGENTE",
    basis: "CALCULATED",
    reason: "TWO_ORDINARY_LEGISLATURES",
    expiresAt: expiry.date,
    startLegislature: ordinaryLegislatureCode(start),
    endLegislature: expiry.endLegislature,
  };
}
