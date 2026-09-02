/**
 * Presentation-only resolution of procedural location and constitutional expiry.
 *
 * Canonical source fields remain untouched. Every non-source value carries an
 * explicit OBSERVED or DERIVED basis so the UI/API cannot present it as a chamber-
 * published fact.
 */

export type ProceduralChamber = "DIPUTADOS" | "SENADO";
export type ProceduralFactBasis = "OFFICIAL" | "OBSERVED" | "DERIVED";

export interface InitiativeProceduralEvent {
  source: string;
  status: string;
  eventDate?: string | null;
  observedAt?: string | null;
  evidenceType?: string | null;
  sourceEventId?: string | number | null;
}

export interface InitiativeProceduralFactsInput {
  type?: string | null;
  status?: string | null;
  expiresAt?: string | null;
  initiated?: string | null;
  initiatedAt?: string | null;
  legislature?: string | null;
  currentChamber?: string | null;
  currentBody?: string | null;
  sourceChamber?: string | null;
  originChamber?: string | null;
  events?: readonly InitiativeProceduralEvent[];
}

export type ResolvedCurrentLocation =
  | {
      state: "CHAMBER";
      basis: "OFFICIAL" | "OBSERVED";
      chamber: ProceduralChamber;
      reason:
        | "SOURCE_PUBLISHED_CURRENT_CHAMBER"
        | "LATEST_OFFICIAL_CHAMBER_MOVEMENT"
        | "SOURCE_CORPUS";
      evidenceStatus: string | null;
      evidenceDate: string | null;
      evidenceSource: string | null;
    }
  | {
      state: "OTHER_BODY";
      basis: "OFFICIAL";
      body: string;
      reason: "SOURCE_PUBLISHED_CURRENT_BODY";
    }
  | {
      state: "IN_TRANSIT";
      basis: "OBSERVED";
      reason: "DISPATCHED_WITHOUT_PUBLISHED_DESTINATION";
      evidenceStatus: string;
      evidenceDate: string | null;
    }
  | {
      state: "PROCEDURE_CONCLUDED";
      basis: "OFFICIAL";
      reason: "TERMINAL_STATUS";
      status: string;
    }
  | {
      state: "UNRESOLVED";
      basis: "OBSERVED";
      reason: "NO_CHAMBER_EVIDENCE" | "ORIGIN_ONLY_NOT_CURRENT_EVIDENCE";
    };

export type ResolvedInitiativeExpiration =
  | {
      state: "SOURCE_PUBLISHED";
      basis: "OFFICIAL";
      date: string;
      reason: "SOURCE_EXPIRATION_FIELD" | "SOURCE_PEREMPTION_EVENT";
      legalBasis: readonly string[];
      sourceEventId: string | number | null;
    }
  | {
      state: "PROJECTED";
      basis: "DERIVED";
      date: string;
      reason: "TWO_ORDINARY_LEGISLATURES";
      startLegislature: string;
      endLegislature: string;
      startEvidenceDate: string | null;
      legalBasis: readonly ["CRD-89", "CRD-100", "CRD-104"];
      methodVersion: "oculis-constitutional-expiry-v1";
    }
  | {
      state: "COUNT_NOT_STARTED";
      basis: "OFFICIAL";
      reason: "SOURCE_REPORTS_NOT_INITIATED";
    }
  | {
      state: "RULE_NOT_APPLICABLE";
      basis: "DERIVED";
      reason: "TYPE_NOT_COVERED_BY_TWO_LEGISLATURE_RULE";
    }
  | {
      state: "PROCEDURE_CONCLUDED";
      basis: "OFFICIAL";
      reason: "TERMINAL_STATUS";
      status: string;
    }
  | {
      state: "EXPIRED_DATE_UNPUBLISHED";
      basis: "OFFICIAL";
      reason: "SOURCE_REPORTS_PEREMPTION_WITHOUT_DATE";
      status: string;
    }
  | {
      state: "REVIEW_REQUIRED";
      basis: "DERIVED";
      reason:
        | "COUNT_START_NOT_PUBLISHED"
        | "TYPE_NOT_PUBLISHED_OR_RECOGNIZED"
        | "INVALID_OR_EXTRAORDINARY_LEGISLATURE"
        | "CONFLICTING_START_EVIDENCE"
        | "BICAMERAL_START_NOT_LINKED"
        | "LEGAL_EXCEPTION_REVIEW";
    };

export interface InitiativeProceduralFacts {
  currentLocation: ResolvedCurrentLocation;
  expiration: ResolvedInitiativeExpiration;
}

const LEGAL_BASIS = ["CRD-89", "CRD-100", "CRD-104"] as const;

function normalized(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-DO");
}

function chamber(value: string | null | undefined): ProceduralChamber | null {
  const key = normalized(value);
  if (key === "diputados" || key === "camara de diputados" || key === "cámara de diputados") {
    return "DIPUTADOS";
  }
  if (key === "senado" || key === "senado de la republica" || key === "senado de la república") {
    return "SENADO";
  }
  return null;
}

function chamberForSource(source: string): ProceduralChamber | null {
  if (source === "sil-diputados") return "DIPUTADOS";
  if (source === "senado-sil") return "SENADO";
  return null;
}

function isoDate(value: string | null | undefined): string | null {
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

function addUtcDays(year: number, monthIndex: number, day: number, days: number): string {
  const result = new Date(Date.UTC(year, monthIndex, day + days));
  return result.toISOString().slice(0, 10);
}

type OrdinaryLegislature = { year: number; term: "PLO" | "SLO" };

function parseOrdinaryLegislature(value: string | null | undefined): OrdinaryLegislature | null {
  const match = normalized(value)
    .toUpperCase()
    .match(/^(\d{4})-(PLO|SLO)$/);
  return match?.[1] && match[2]
    ? { year: Number(match[1]), term: match[2] as "PLO" | "SLO" }
    : null;
}

function legislatureForDate(value: string): OrdinaryLegislature | null {
  const parsed = isoDate(value);
  if (!parsed) return null;
  const year = Number(parsed.slice(0, 4));
  const date = parsed;
  const ploStart = `${year}-02-27`;
  const ploEnd = addUtcDays(year, 1, 27, 149);
  if (date >= ploStart && date <= ploEnd) return { year, term: "PLO" };

  const sloStart = `${year}-08-16`;
  if (date >= sloStart) return { year, term: "SLO" };

  const priorSloEnd = addUtcDays(year - 1, 7, 16, 149);
  if (date <= priorSloEnd) return { year: year - 1, term: "SLO" };
  return null;
}

function legislatureCode(value: OrdinaryLegislature): string {
  return `${value.year}-${value.term}`;
}

function projectedExpiry(start: OrdinaryLegislature): {
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
  const status = normalized(value);
  return /^(promulgad[oa]|rechazad[oa]|retirad[oa]|convertid[oa] en ley)$/.test(status);
}

function peremptedStatus(value: string | null | undefined): boolean {
  return /^perimid[oa]$/.test(normalized(value));
}

function dispatchedStatus(value: string | null | undefined): boolean {
  return /^despachad[oa](?:\b|$)/.test(normalized(value));
}

function normalizedType(value: string | null | undefined): string {
  return normalized(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function recognizedBillType(value: string | null | undefined): boolean {
  const type = normalizedType(value);
  return type === "proyecto de ley" || type.startsWith("proyecto de ley ");
}

function recognizedNonBillType(value: string | null | undefined): boolean {
  const type = normalizedType(value);
  return [
    "resolucion",
    "proyecto de resolucion",
    "contrato",
    "convenio",
    "nombramiento",
    "designacion",
    "prestamo",
    "acuerdo",
    "tratado",
  ].some((known) => type === known || type.startsWith(`${known} `));
}

function eventTimestamp(event: InitiativeProceduralEvent): string {
  return event.eventDate ?? event.observedAt ?? "";
}

function latestEvent(
  events: readonly InitiativeProceduralEvent[],
): InitiativeProceduralEvent | null {
  return [...events].sort((a, b) => eventTimestamp(b).localeCompare(eventTimestamp(a)))[0] ?? null;
}

function resolveCurrentLocation(input: InitiativeProceduralFactsInput): ResolvedCurrentLocation {
  const explicitChamber = chamber(input.currentChamber);
  if (explicitChamber) {
    return {
      state: "CHAMBER",
      basis: "OFFICIAL",
      chamber: explicitChamber,
      reason: "SOURCE_PUBLISHED_CURRENT_CHAMBER",
      evidenceStatus: null,
      evidenceDate: null,
      evidenceSource: null,
    };
  }
  if (input.currentBody?.trim()) {
    return {
      state: "OTHER_BODY",
      basis: "OFFICIAL",
      body: input.currentBody.trim(),
      reason: "SOURCE_PUBLISHED_CURRENT_BODY",
    };
  }
  if (terminalStatus(input.status) || peremptedStatus(input.status)) {
    return {
      state: "PROCEDURE_CONCLUDED",
      basis: "OFFICIAL",
      reason: "TERMINAL_STATUS",
      status: input.status?.trim() ?? "",
    };
  }

  const events = input.events ?? [];
  const mostRecent = latestEvent(events);
  if (mostRecent && dispatchedStatus(mostRecent.status)) {
    return {
      state: "IN_TRANSIT",
      basis: "OBSERVED",
      reason: "DISPATCHED_WITHOUT_PUBLISHED_DESTINATION",
      evidenceStatus: mostRecent.status,
      evidenceDate: isoDate(mostRecent.eventDate ?? mostRecent.observedAt),
    };
  }
  if (dispatchedStatus(input.status)) {
    return {
      state: "IN_TRANSIT",
      basis: "OBSERVED",
      reason: "DISPATCHED_WITHOUT_PUBLISHED_DESTINATION",
      evidenceStatus: input.status?.trim() ?? "",
      evidenceDate: mostRecent ? isoDate(mostRecent.eventDate ?? mostRecent.observedAt) : null,
    };
  }
  if (mostRecent) {
    const eventChamber = chamberForSource(mostRecent.source);
    if (eventChamber) {
      return {
        state: "CHAMBER",
        basis: "OBSERVED",
        chamber: eventChamber,
        reason: "LATEST_OFFICIAL_CHAMBER_MOVEMENT",
        evidenceStatus: mostRecent.status,
        evidenceDate: isoDate(mostRecent.eventDate ?? mostRecent.observedAt),
        evidenceSource: mostRecent.source,
      };
    }
  }
  const corpusChamber = chamber(input.sourceChamber);
  if (corpusChamber) {
    return {
      state: "CHAMBER",
      basis: "OBSERVED",
      chamber: corpusChamber,
      reason: "SOURCE_CORPUS",
      evidenceStatus: input.status?.trim() || null,
      evidenceDate: null,
      evidenceSource: null,
    };
  }
  const origin = chamber(input.originChamber);
  if (origin) {
    return {
      state: "UNRESOLVED",
      basis: "OBSERVED",
      reason: "ORIGIN_ONLY_NOT_CURRENT_EVIDENCE",
    };
  }
  return { state: "UNRESOLVED", basis: "OBSERVED", reason: "NO_CHAMBER_EVIDENCE" };
}

function resolveExpiration(input: InitiativeProceduralFactsInput): ResolvedInitiativeExpiration {
  const publishedDate = isoDate(input.expiresAt);
  if (publishedDate) {
    return {
      state: "SOURCE_PUBLISHED",
      basis: "OFFICIAL",
      date: publishedDate,
      reason: "SOURCE_EXPIRATION_FIELD",
      legalBasis: [],
      sourceEventId: null,
    };
  }

  const peremptionEvents = [...(input.events ?? [])].filter((event) =>
    peremptedStatus(event.status),
  );
  const peremptionEvent = peremptionEvents
    .filter((event) => isoDate(event.eventDate))
    .sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""))[0];
  const peremptionDate = peremptionEvent ? isoDate(peremptionEvent.eventDate) : null;
  if (peremptionEvent && peremptionDate) {
    return {
      state: "SOURCE_PUBLISHED",
      basis: "OFFICIAL",
      date: peremptionDate,
      reason: "SOURCE_PEREMPTION_EVENT",
      legalBasis: [],
      sourceEventId: peremptionEvent.sourceEventId ?? null,
    };
  }
  if (peremptedStatus(input.status) || peremptionEvents.length > 0) {
    return {
      state: "EXPIRED_DATE_UNPUBLISHED",
      basis: "OFFICIAL",
      reason: "SOURCE_REPORTS_PEREMPTION_WITHOUT_DATE",
      status: input.status?.trim() || peremptionEvents[0]?.status || "",
    };
  }
  if (terminalStatus(input.status)) {
    return {
      state: "PROCEDURE_CONCLUDED",
      basis: "OFFICIAL",
      reason: "TERMINAL_STATUS",
      status: input.status?.trim() ?? "",
    };
  }
  if (!recognizedBillType(input.type) && recognizedNonBillType(input.type)) {
    return {
      state: "RULE_NOT_APPLICABLE",
      basis: "DERIVED",
      reason: "TYPE_NOT_COVERED_BY_TWO_LEGISLATURE_RULE",
    };
  }
  if (!recognizedBillType(input.type)) {
    return {
      state: "REVIEW_REQUIRED",
      basis: "DERIVED",
      reason: "TYPE_NOT_PUBLISHED_OR_RECOGNIZED",
    };
  }

  const initiated = normalized(input.initiated);
  if (initiated === "no") {
    if (input.initiatedAt) {
      return {
        state: "REVIEW_REQUIRED",
        basis: "DERIVED",
        reason: "CONFLICTING_START_EVIDENCE",
      };
    }
    return {
      state: "COUNT_NOT_STARTED",
      basis: "OFFICIAL",
      reason: "SOURCE_REPORTS_NOT_INITIATED",
    };
  }
  // A yes/no flag proves only whether the count has started. It does not prove which
  // ordinary legislature was the first countable one. The projection therefore
  // requires the source-published start date; the generic `legislature` field alone
  // must never become a hidden substitute for the consideration/admission event.
  if (!input.initiatedAt) {
    return {
      state: "REVIEW_REQUIRED",
      basis: "DERIVED",
      reason: "COUNT_START_NOT_PUBLISHED",
    };
  }

  const source = chamber(input.sourceChamber);
  const origin = chamber(input.originChamber);
  if (source && origin && source !== origin) {
    return {
      state: "REVIEW_REQUIRED",
      basis: "DERIVED",
      reason: "BICAMERAL_START_NOT_LINKED",
    };
  }

  const reportedLegislature = parseOrdinaryLegislature(input.legislature);
  const dateLegislature = input.initiatedAt ? legislatureForDate(input.initiatedAt) : null;
  if (input.initiatedAt && !dateLegislature) {
    return {
      state: "REVIEW_REQUIRED",
      basis: "DERIVED",
      reason: "INVALID_OR_EXTRAORDINARY_LEGISLATURE",
    };
  }
  if (!reportedLegislature && !dateLegislature) {
    return {
      state: "REVIEW_REQUIRED",
      basis: "DERIVED",
      reason: "INVALID_OR_EXTRAORDINARY_LEGISLATURE",
    };
  }
  if (
    reportedLegislature &&
    dateLegislature &&
    legislatureCode(reportedLegislature) !== legislatureCode(dateLegislature)
  ) {
    return {
      state: "REVIEW_REQUIRED",
      basis: "DERIVED",
      reason: "CONFLICTING_START_EVIDENCE",
    };
  }

  const start = reportedLegislature ?? dateLegislature!;
  if (start.year === 2020) {
    return {
      state: "REVIEW_REQUIRED",
      basis: "DERIVED",
      reason: "LEGAL_EXCEPTION_REVIEW",
    };
  }
  const projection = projectedExpiry(start);
  return {
    state: "PROJECTED",
    basis: "DERIVED",
    date: projection.date,
    reason: "TWO_ORDINARY_LEGISLATURES",
    startLegislature: legislatureCode(start),
    endLegislature: projection.endLegislature,
    startEvidenceDate: isoDate(input.initiatedAt),
    legalBasis: LEGAL_BASIS,
    methodVersion: "oculis-constitutional-expiry-v1",
  };
}

export function initiativeProceduralFacts(
  input: InitiativeProceduralFactsInput,
): InitiativeProceduralFacts {
  return {
    currentLocation: resolveCurrentLocation(input),
    expiration: resolveExpiration(input),
  };
}
