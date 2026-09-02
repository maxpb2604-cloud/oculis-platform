import type { Lang } from "@/lib/i18n";

type BilingualLabel = Readonly<Record<Lang, string>>;

/**
 * Normalize only for matching. Every helper below is presentation-only: it never
 * rewrites a stored value, and unknown source values are returned verbatim.
 */
function lookupKey(value: string): string {
  return value.trim().toLocaleLowerCase("es");
}

const INITIATIVE_CHAMBERS: Readonly<Record<string, BilingualLabel>> = {
  diputados: {
    es: "Cámara de Diputados",
    en: "Chamber of Deputies",
  },
  senado: {
    es: "Senado de la República",
    en: "Senate of the Republic",
  },
};

/** Human-readable chamber name for a source-literal initiative chamber code. */
export function initiativeChamberLabel(
  value: string | null | undefined,
  lang: Lang,
): string | null {
  if (value == null) return null;
  return INITIATIVE_CHAMBERS[lookupKey(value)]?.[lang] ?? value;
}

const ENGLISH_OFFICIAL_STATUSES: Readonly<Record<string, string>> = {
  depositado: "Filed",
  vigente: "Active",
  "sobre la mesa para única discusión": "Tabled for single reading",
  "auditado en única discusión": "Audited in single reading",
  "certificado en única discusión": "Certified in single reading",
  "despachado única lectura": "Dispatched after single reading",
  "firmado presidencia y secretarios en única":
    "Signed by the President and Secretaries after single reading",
};

/**
 * Translate only audited, source-literal procedural statuses for display. Spanish
 * and unknown values are returned exactly as received.
 */
export function officialStatusLabel(value: string | null | undefined, lang: Lang): string | null {
  if (value == null) return null;
  if (lang === "es") return value;
  return ENGLISH_OFFICIAL_STATUSES[lookupKey(value)] ?? value;
}

const ENGLISH_LEGISLATOR_ROLES: Readonly<Record<string, string>> = {
  diputado: "Deputy",
  diputada: "Deputy",
  "diputado/a": "Deputy",
  senador: "Senator",
  senadora: "Senator",
  "senador/a": "Senator",
};

function chamberRoleFallback(chamber: string | null | undefined, lang: Lang): string {
  if (!chamber) return "";
  const chamberKey = lookupKey(chamber);
  if (chamberKey === "senado") return lang === "es" ? "Senador" : "Senator";
  if (chamberKey === "diputados") return lang === "es" ? "Diputado" : "Deputy";
  return "";
}

/**
 * Legislator role with a chamber-based fallback when the source does not publish a
 * role. A non-empty unknown role remains untouched.
 */
export function legislatorRoleLabel(
  value: string | null | undefined,
  chamber: string | null | undefined,
  lang: Lang,
): string {
  if (!value?.trim()) return chamberRoleFallback(chamber, lang);
  if (lang === "es") return value;
  return ENGLISH_LEGISLATOR_ROLES[lookupKey(value)] ?? value;
}

/** Translate source-literal constituency labels without changing unknown values. */
export function circumscriptionLabel(value: string | null | undefined, lang: Lang): string | null {
  if (value == null) return null;
  if (lang === "es") return value;

  const key = lookupKey(value);
  if (key === "no aplica") return "Not applicable";

  const circumscription = /^circunscripción\s+(\d+)$/.exec(key);
  return circumscription?.[1] ? `Constituency ${circumscription[1]}` : value;
}

const ENGLISH_REPRESENTATION_LEVELS: Readonly<Record<string, string>> = {
  provincial: "Provincial",
  nacional: "National",
};

/** Translate a known representation level for display only. */
export function representationLevelLabel(
  value: string | null | undefined,
  lang: Lang,
): string | null {
  if (value == null) return null;
  if (lang === "es") return value;
  return ENGLISH_REPRESENTATION_LEVELS[lookupKey(value)] ?? value;
}

const ENGLISH_COMMITTEE_ROLES: Readonly<Record<string, string>> = {
  presidente: "Chair",
  presidenta: "Chair",
  "presidente/a": "Chair",
  "vice-presidente": "Vice Chair",
  "vice-presidenta": "Vice Chair",
  "vice-presidente/a": "Vice Chair",
  vicepresidente: "Vice Chair",
  vicepresidenta: "Vice Chair",
  "vicepresidente/a": "Vice Chair",
  secretario: "Secretary",
  secretaria: "Secretary",
  "secretario/a": "Secretary",
  miembro: "Member",
};

/** Translate known committee offices while preserving every unknown source value. */
export function committeeRoleLabel(value: string | null | undefined, lang: Lang): string | null {
  if (value == null) return null;
  if (lang === "es") return value;
  return ENGLISH_COMMITTEE_ROLES[lookupKey(value)] ?? value;
}
