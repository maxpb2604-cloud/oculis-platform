import type { Lang } from "./i18n";

/**
 * Presentation data for Oculis' compact editorial movement headline. The
 * official title is deliberately returned
 * untouched so the initiative record can continue to show its source text.
 */
export interface HomeMovementHeadline {
  /** Procedural event, normalized only when its meaning is known. */
  movement: string;
  /** A compact display-only subject derived from the current display title. */
  subject: string;
  /** Language of both movement and subject; prevents mixed-language headlines. */
  headlineLanguage: Lang;
  /** Exact official Spanish title supplied by the source. */
  officialTitle: string;
  /** Exact source status, when one was supplied. Never translated or rewritten. */
  officialStatus: string | null;
}

export interface HomeMovementHeadlineInput {
  /** Exact title published by the official source. */
  sourceTitle: string;
  /** Localized title chosen for the current UI, if it has been reviewed. */
  displayTitle?: string | null;
  /** Exact procedural status published by the source. */
  status?: string | null;
  /** Feed signal identifier; only the exact `deposit:<numeric id>` form is classified. */
  sourceId?: string | null;
  /** Requested interface language. */
  lang: Lang;
  /** Actual language of `displayTitle`, including a declared Spanish fallback. */
  displayLanguage?: Lang;
}

const MAX_SUBJECT_LENGTH = 105;

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function lookupKey(value: string): string {
  return compactWhitespace(value).toLocaleLowerCase("es");
}

function capitalizeFirst(value: string): string {
  return value ? `${value.slice(0, 1).toLocaleUpperCase("es")}${value.slice(1)}` : value;
}

function stripKnownLegalPrefix(value: string, language: Lang): string {
  const spanishPrefixes = [
    /^resoluci[oó]n aprobatoria del\s+/i,
    /^proyecto de resoluci[oó]n de la c[aá]mara de diputados\s+mediante la cual\s+/i,
    /^proyecto de resoluci[oó]n\s+mediante la cual\s+/i,
    /^proyecto de ley\s+(?:que\s+|mediante el cual\s+|mediante la cual\s+)/i,
    /^resoluci[oó]n\s+que\s+/i,
  ];
  const englishPrefixes = [
    /^resolution approving(?: the)?\s+/i,
    /^draft resolution of the chamber of deputies\s+that\s+/i,
    /^draft resolution\s+that\s+/i,
    /^bill\s+(?:that\s+|which\s+|to\s+)/i,
  ];
  const prefixes = language === "en" ? englishPrefixes : spanishPrefixes;

  for (const prefix of prefixes) {
    if (prefix.test(value)) return compactWhitespace(value.replace(prefix, ""));
  }

  if (language === "es") {
    const uppercaseSource = value === value.toLocaleUpperCase("es");
    if (/^proyecto de ley\s+/i.test(value)) {
      return compactWhitespace(
        value.replace(/^proyecto de ley\s+/i, uppercaseSource ? "LEY " : "Ley "),
      );
    }
    if (/^proyecto de resoluci[oó]n\s+/i.test(value)) {
      return compactWhitespace(
        value.replace(
          /^proyecto de resoluci[oó]n\s+/i,
          uppercaseSource ? "RESOLUCIÓN " : "Resolución ",
        ),
      );
    }
  }

  return value;
}

function safeClauseSubject(value: string, language: Lang): string {
  const boundaries =
    language === "en"
      ? [
          /,\s*entered into\b/i,
          /,\s*executed by\b/i,
          /,\s*represented by\b/i,
          /,\s*through\b/i,
          /,\s*for the purposes of\b/i,
        ]
      : [
          /,\s*del\s+\d{1,2}\s+de\s+[a-záéíóúñ]+\s+de\s+\d{4}\b/i,
          /,\s*suscrit[oa]\b/i,
          /,\s*celebrad[oa]\b/i,
          /,\s*representad[oa]\b/i,
          /,\s*a trav[eé]s de\b/i,
          /,\s*mediante el cual\b/i,
          /,\s*mediante la cual\b/i,
          /,\s*para los fines\b/i,
        ];

  const boundary = boundaries
    .map((pattern) => pattern.exec(value)?.index)
    .filter((index): index is number => index != null)
    .sort((left, right) => left - right)[0];

  if (boundary != null) return value.slice(0, boundary).trim();

  const firstComma = /,\s+/.exec(value)?.index ?? -1;
  const commaWouldHideRequestedAction = /^(?:solicita\b|resolution requesting\b)/i.test(value);
  if (!commaWouldHideRequestedAction && firstComma >= 24 && firstComma <= MAX_SUBJECT_LENGTH) {
    return value.slice(0, firstComma).trim();
  }

  return value;
}

function shortenAtWordBoundary(value: string): string {
  if (value.length <= MAX_SUBJECT_LENGTH) return value;

  const punctuation = [";", ":", "."]
    .map((token) => value.lastIndexOf(token, MAX_SUBJECT_LENGTH))
    .filter((index) => index >= Math.floor(MAX_SUBJECT_LENGTH * 0.55))
    .sort((left, right) => right - left)[0];
  const wordBoundary = value.lastIndexOf(" ", MAX_SUBJECT_LENGTH);
  const end = punctuation ?? (wordBoundary > 0 ? wordBoundary : MAX_SUBJECT_LENGTH);
  return `${value.slice(0, end).replace(/[\s,;:]+$/, "")}…`;
}

function extractRequestedObject(value: string, language: Lang): string {
  if (language === "en" && /^resolution requesting\b/i.test(value)) {
    const incorporated = /\bto incorporate\s+(.+)$/i.exec(value)?.[1];
    if (incorporated) return compactWhitespace(incorporated);
  }
  if (language === "es" && /^solicita\b/i.test(value)) {
    const incorporation = /,\s*(la incorporaci[oó]n de\s+.+)$/i.exec(value)?.[1];
    if (incorporation) return compactWhitespace(incorporation);
  }
  return value;
}

/**
 * Removes a deliberately small, anchored set of legal wrappers. It never
 * rewrites names, numbers, or negations and signals any remaining cutoff.
 */
export function homeMovementSubject(value: string, language: Lang): string {
  const compact = compactWhitespace(value);
  if (!compact) return "";

  const withoutPrefix = stripKnownLegalPrefix(compact, language);
  const focusedSubject = extractRequestedObject(withoutPrefix, language);
  const concise = safeClauseSubject(focusedSubject, language);

  return capitalizeFirst(shortenAtWordBoundary(concise));
}

function isDepositSignal(sourceId: string | null | undefined): boolean {
  return /^deposit:\d+$/.test(sourceId?.trim() ?? "");
}

function knownMovement(status: string, language: Lang): string | null {
  const labels: Readonly<Record<string, Readonly<Record<Lang, string>>>> = {
    depositado: { es: "Iniciativa depositada", en: "Initiative filed" },
    depositada: { es: "Iniciativa depositada", en: "Initiative filed" },
    "aprobada en primera lectura": {
      es: "Aprobada en primera lectura",
      en: "Approved in first reading",
    },
    "en auditoría legislativa": {
      es: "En auditoría legislativa",
      en: "Under legislative review",
    },
    "sobre la mesa para única discusión": {
      es: "Sobre la mesa para única discusión",
      en: "Tabled for single reading",
    },
    "auditado en única discusión": {
      es: "Auditado en única discusión",
      en: "Audited in single reading",
    },
    "certificado en única discusión": {
      es: "Certificado en única discusión",
      en: "Certified in single reading",
    },
    "despachado única lectura": {
      es: "Despachado en única lectura",
      en: "Dispatched after single reading",
    },
    "firmado presidencia y secretarios en única": {
      es: "Firmado por la Presidencia y las secretarías en única lectura",
      en: "Signed by the President and Secretaries after single reading",
    },
  };

  return labels[lookupKey(status)]?.[language] ?? null;
}

function movementPresentation(
  status: string | null,
  sourceId: string | null | undefined,
  language: Lang,
): string {
  if (isDepositSignal(sourceId) || ["depositado", "depositada"].includes(lookupKey(status ?? ""))) {
    return language === "es" ? "Iniciativa depositada" : "Initiative filed";
  }

  if (status) {
    const known = knownMovement(status, language);
    if (known) return known;

    // An unknown source status remains literal in Spanish. In English, avoid
    // mixing a reviewed English title with an untranslated Spanish procedure.
    if (language === "es") return compactWhitespace(status);
  }

  return language === "es" ? "Actualización oficial" : "Official update";
}

/**
 * Builds display-only copy; it has no data side effects and never changes
 * the exact title or status stored in the legislative catalogue.
 */
export function homeMovementHeadline(input: HomeMovementHeadlineInput): HomeMovementHeadline {
  const officialTitle = compactWhitespace(input.sourceTitle);
  const displayTitle = compactWhitespace(input.displayTitle || officialTitle);
  const officialStatus = input.status == null ? null : compactWhitespace(input.status) || null;
  const statusHasReviewedEnglishLabel =
    officialStatus == null ||
    ["depositado", "depositada"].includes(lookupKey(officialStatus)) ||
    knownMovement(officialStatus, "en") != null;
  const canUseEnglish =
    input.lang === "en" &&
    input.displayLanguage === "en" &&
    Boolean(displayTitle) &&
    statusHasReviewedEnglishLabel;
  const headlineLanguage: Lang = canUseEnglish ? "en" : "es";
  const subjectSource = headlineLanguage === "en" ? displayTitle : officialTitle;

  return {
    movement: movementPresentation(officialStatus, input.sourceId, headlineLanguage),
    subject: homeMovementSubject(subjectSource, headlineLanguage),
    headlineLanguage,
    officialTitle,
    officialStatus,
  };
}
