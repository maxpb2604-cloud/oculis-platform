import type { SilProponente } from "@oculis/scrapers";

export interface InitiativeProponentFact {
  name: string;
  firstNames: string | null;
  lastNames: string | null;
  legislatorId: number | null;
  principal: boolean | null;
  role: string | null;
  representationLevel: string | null;
  representationStatus: string | null;
  representationStart: string | null;
  representationEnd: string | null;
  representationPeriod: string | null;
  party: string | null;
  partyName: string | null;
  partyId: number | null;
  province: string | null;
  constituency: string | null;
}

export interface InitiativeSourceCoverage {
  detail: boolean;
  proponents: boolean;
  history: boolean;
  commissions: boolean;
  documents: boolean;
  activities: boolean;
  votes: boolean;
}

export interface ExplicitLegislatureCountingFacts {
  initiated: string | null;
  initiatedAt: string | null;
  legislature: string | null;
  expiresAt: string | null;
}

export interface InitiativePublicActivity {
  id: number;
  description: string;
  date: string | null;
  type: string | null;
  location: string | null;
  commissionId: number | null;
}

export interface InitiativePublicVote {
  id: number;
  title: string | null;
  motion: string | null;
  date: string | null;
  voteNumber: string | null;
  sessionId: number | null;
  sessionNumber: string | null;
  totalVotes: number | null;
  yesVotes: number | null;
  noVotes: number | null;
  abstentions: number | null;
  delegates: number | null;
  present: number | null;
  absent: number | null;
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function positiveInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function isoDate(value: unknown): string | null {
  const literal = clean(value);
  const match = literal?.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? `${match[1]}-${match[2]}-${match[3]}`
    : null;
}

/**
 * Recover exact Senate Ficha fields from the archived official payload while older rows
 * await their next enrichment cycle. This is a literal read, not an inference: it accepts
 * only the typed Ficha object stored by the Senate adapter and never derives a start from
 * the filing date, status, title, or legislature code.
 */
export function explicitLegislatureCountingFacts(
  raw: unknown,
  source: string,
): ExplicitLegislatureCountingFacts {
  const empty: ExplicitLegislatureCountingFacts = {
    initiated: null,
    initiatedAt: null,
    legislature: null,
    expiresAt: null,
  };
  if (source !== "senado-sil" || !raw || typeof raw !== "object") return empty;
  const payload = (raw as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return empty;
  const ficha = (payload as { ficha?: unknown }).ficha;
  if (!ficha || typeof ficha !== "object") return empty;
  const facts = ficha as Record<string, unknown>;
  const initiated = clean(facts.legislatureCountingStarted);

  return {
    initiated: /^(?:si|sí|no)$/i.test(initiated ?? "") ? initiated : null,
    initiatedAt: isoDate(facts.legislatureCountingStartedAt),
    legislature: clean(facts.legislature),
    expiresAt: isoDate(facts.expiresAt),
  };
}

function archivedCollection(raw: unknown, key: string): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  const payload = (raw as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return [];
  const value = (payload as Record<string, unknown>)[key];
  return Array.isArray(value) ? value : [];
}

function proponentName(proponent: SilProponente): string | null {
  return (
    clean(proponent.nombreCompleto) ??
    clean([proponent.nombres, proponent.apellidos].filter(Boolean).join(" "))
  );
}

/** Read every user-relevant public proponent fact archived from the official source. */
export function explicitProponents(raw: unknown): InitiativeProponentFact[] {
  if (!raw || typeof raw !== "object") return [];
  const payload = (raw as { payload?: unknown }).payload;
  if (!payload || typeof payload !== "object") return [];
  const candidate = payload as { proponents?: unknown; proponentes?: unknown };
  const rows = Array.isArray(candidate.proponents)
    ? candidate.proponents
    : Array.isArray(candidate.proponentes)
      ? candidate.proponentes
      : [];

  return rows.flatMap((value): InitiativeProponentFact[] => {
    if (!value || typeof value !== "object") return [];
    const proponent = value as SilProponente;
    const name = proponentName(proponent);
    if (!name) return [];
    const representation = proponent.representacion;
    return [
      {
        name,
        firstNames: clean(proponent.nombres),
        lastNames: clean(proponent.apellidos),
        legislatorId: positiveInteger(proponent.legisladorId),
        principal: typeof proponent.principal === "boolean" ? proponent.principal : null,
        role: clean(representation?.funcion) ?? clean(proponent.cargo),
        representationLevel: clean(representation?.nivelRepresentacion),
        representationStatus: clean(representation?.ejercicio),
        representationStart: clean(representation?.inicio),
        representationEnd: clean(representation?.fin),
        representationPeriod: clean(representation?.periodo),
        party: clean(representation?.partido?.siglas) ?? clean(representation?.partido?.nombre),
        partyName: clean(representation?.partido?.nombre),
        partyId: positiveInteger(representation?.partido?.id),
        province: clean(representation?.provincia),
        constituency: clean(representation?.circunscripcion),
      },
    ];
  });
}

/** Commission activity rows published on the official initiative record. */
export function explicitInitiativeActivities(raw: unknown): InitiativePublicActivity[] {
  return archivedCollection(raw, "actividades").flatMap((value): InitiativePublicActivity[] => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const id = positiveInteger(row.id);
    const description = clean(row.actividad);
    if (id == null || description == null) return [];
    return [
      {
        id,
        description,
        date: clean(row.fecha),
        type: clean(row.tipo),
        location: clean(row.ubicacion),
        commissionId: positiveInteger(row.comisionId),
      },
    ];
  });
}

/** Plenary vote summaries published on the official initiative record. */
export function explicitInitiativeVotes(raw: unknown): InitiativePublicVote[] {
  return archivedCollection(raw, "votaciones").flatMap((value): InitiativePublicVote[] => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const id = positiveInteger(row.id);
    if (id == null) return [];
    const votes =
      row.votos && typeof row.votos === "object" ? (row.votos as Record<string, unknown>) : {};
    const attendance =
      row.asistencias && typeof row.asistencias === "object"
        ? (row.asistencias as Record<string, unknown>)
        : {};
    const session =
      row.sesion && typeof row.sesion === "object" ? (row.sesion as Record<string, unknown>) : {};
    return [
      {
        id,
        title: clean(row.titulo),
        motion: clean(row.mocion),
        date: clean(row.fecha),
        voteNumber: clean(row.numeroVotacion),
        sessionId: positiveInteger(row.sesionId) ?? positiveInteger(session.id),
        sessionNumber: clean(session.numero) ?? clean(row.numeroSesion),
        totalVotes: nonNegativeInteger(votes.cantidadTotalVotos),
        yesVotes: nonNegativeInteger(votes.cantidadVotosSi),
        noVotes: nonNegativeInteger(votes.cantidadVotosNo),
        abstentions: nonNegativeInteger(votes.cantidadVotosAbastencion),
        delegates: nonNegativeInteger(attendance.cantidadDelegados),
        present: nonNegativeInteger(attendance.cantidadPresentes),
        absent: nonNegativeInteger(attendance.cantidadAusentes),
      },
    ];
  });
}

/**
 * Distinguish an official collection that was observed empty from one Oculis never
 * reached. The provenance list contains only endpoints successfully observed by the
 * ingestion path; an endpoint failure therefore remains false instead of becoming a
 * fabricated empty answer.
 */
export function initiativeSourceCoverage(raw: unknown, source: string): InitiativeSourceCoverage {
  const empty: InitiativeSourceCoverage = {
    detail: false,
    proponents: false,
    history: false,
    commissions: false,
    documents: false,
    activities: false,
    votes: false,
  };
  if (!raw || typeof raw !== "object") return empty;
  const provenance = (raw as { provenance?: unknown }).provenance;
  if (!provenance || typeof provenance !== "object") return empty;
  const values = (provenance as { endpoints?: unknown }).endpoints;
  const endpoints = Array.isArray(values)
    ? values.flatMap((value) => (typeof value === "string" ? [value.toLowerCase()] : []))
    : [];
  const has = (fragment: string) => endpoints.some((endpoint) => endpoint.includes(fragment));

  if (source === "sil-diputados") {
    return {
      detail: has("iniciativa/iniciativa/"),
      proponents: has("iniciativa/proponentes"),
      history: has("iniciativa/historicos"),
      commissions: has("iniciativa/comisiones"),
      documents: has("iniciativa/documentos"),
      activities: has("iniciativa/actividades"),
      votes: has("iniciativa/votaciones"),
    };
  }
  if (source === "senado-sil" && has("wfilemaster/ficha.aspx")) {
    return { ...empty, detail: true, proponents: true, history: true, commissions: true };
  }
  return empty;
}
