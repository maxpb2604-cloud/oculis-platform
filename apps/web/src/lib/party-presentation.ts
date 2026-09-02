export type PartyPresentationLanguage = "es" | "en";

export type PartyPresentationKind = "party" | "institution" | "independent" | "unknown" | "missing";

export type PartyPresentation = {
  acronym: string | null;
  fullName: string | null;
  label: string;
  kind: PartyPresentationKind;
  isKnown: boolean;
  isMissing: boolean;
  color: string;
};

type KnownPartyPresentation = {
  acronym: string;
  fullName: string;
  kind: Exclude<PartyPresentationKind, "unknown" | "missing">;
  aliases?: readonly string[];
};

const KNOWN_PARTY_PRESENTATIONS: readonly KnownPartyPresentation[] = [
  { acronym: "ALPAIS", fullName: "Partido Alianza País", kind: "party", aliases: ["Alianza País"] },
  { acronym: "DXC", fullName: "Dominicanos por el Cambio", kind: "party" },
  { acronym: "FA", fullName: "Frente Amplio", kind: "party" },
  {
    acronym: "FP",
    fullName: "Fuerza del Pueblo",
    kind: "party",
    aliases: ["Partido Fuerza del Pueblo"],
  },
  { acronym: "IND", fullName: "Independiente", kind: "independent" },
  { acronym: "JCE", fullName: "Junta Central Electoral", kind: "institution" },
  { acronym: "JS", fullName: "Partido Justicia Social", kind: "party" },
  { acronym: "MODA", fullName: "Movimiento Democrático Alternativo", kind: "party" },
  { acronym: "OD", fullName: "Opción Democrática", kind: "party" },
  { acronym: "PCR", fullName: "Partido Cívico Renovador", kind: "party" },
  { acronym: "PE", fullName: "Poder Ejecutivo", kind: "institution" },
  { acronym: "PLD", fullName: "Partido de la Liberación Dominicana", kind: "party" },
  { acronym: "PLR", fullName: "Partido Liberal Reformista", kind: "party" },
  { acronym: "PPG", fullName: "Partido Primero La Gente", kind: "party" },
  {
    acronym: "PQDC",
    fullName: "Partido Quisqueyano Demócrata Cristiano",
    kind: "party",
  },
  { acronym: "PRD", fullName: "Partido Revolucionario Dominicano", kind: "party" },
  { acronym: "PRM", fullName: "Partido Revolucionario Moderno", kind: "party" },
  { acronym: "PRSC", fullName: "Partido Reformista Social Cristiano", kind: "party" },
  { acronym: "SCJ", fullName: "Suprema Corte de Justicia", kind: "institution" },
] as const;

const clean = (value?: string | null) => value?.trim().replace(/\s+/g, " ") || null;

const normalizeForMatch = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const knownByAcronym = new Map<string, KnownPartyPresentation>(
  KNOWN_PARTY_PRESENTATIONS.map((presentation) => [presentation.acronym, presentation]),
);

const knownByFullName = new Map<string, KnownPartyPresentation>();
for (const presentation of KNOWN_PARTY_PRESENTATIONS) {
  knownByFullName.set(normalizeForMatch(presentation.fullName), presentation);
  for (const alias of presentation.aliases ?? []) {
    knownByFullName.set(normalizeForMatch(alias), presentation);
  }
}

const findByAcronym = (value?: string | null) => {
  const candidate = clean(value)?.toLocaleUpperCase("es");
  return candidate ? knownByAcronym.get(candidate) : undefined;
};

const findByFullName = (value?: string | null) => {
  const candidate = clean(value);
  return candidate ? knownByFullName.get(normalizeForMatch(candidate)) : undefined;
};

const looksLikeAcronym = (value: string) => /^[\p{L}\d]{1,12}$/u.test(value);

type ParsedValue = {
  acronym: string | null;
  fullName: string | null;
  known: KnownPartyPresentation | null;
};

const parseValue = (value?: string | null, suppliedFullName?: string | null): ParsedValue => {
  const rawValue = clean(value);
  const rawFullName = clean(suppliedFullName);

  const knownFromValue = rawValue
    ? (findByAcronym(rawValue) ?? findByFullName(rawValue))
    : undefined;
  const knownFromFullName = rawFullName
    ? (findByAcronym(rawFullName) ?? findByFullName(rawFullName))
    : undefined;
  const directKnown = knownFromValue ?? knownFromFullName;

  if (directKnown) {
    return {
      acronym: directKnown.acronym,
      fullName: directKnown.fullName,
      known: directKnown,
    };
  }

  const parenthetical = rawValue?.match(/^(.+?)\s*\(([^()]*)\)\s*$/);
  if (parenthetical) {
    const outer = clean(parenthetical[1]);
    const inner = clean(parenthetical[2]);
    const outerKnown = findByAcronym(outer) ?? findByFullName(outer);
    const innerKnown = findByAcronym(inner) ?? findByFullName(inner);
    const formattedKnown = outerKnown ?? innerKnown;

    if (formattedKnown) {
      return {
        acronym: formattedKnown.acronym,
        fullName: formattedKnown.fullName,
        known: formattedKnown,
      };
    }

    if (outer && inner) {
      if (looksLikeAcronym(outer)) {
        return {
          acronym: outer.toLocaleUpperCase("es"),
          fullName: rawFullName ?? inner,
          known: null,
        };
      }
      if (looksLikeAcronym(inner)) {
        return {
          acronym: inner.toLocaleUpperCase("es"),
          fullName: rawFullName ?? outer,
          known: null,
        };
      }
    }
  }

  if (rawValue && looksLikeAcronym(rawValue)) {
    return {
      acronym: rawValue.toLocaleUpperCase("es"),
      fullName: rawFullName,
      known: null,
    };
  }

  return {
    acronym: null,
    fullName: rawFullName ?? rawValue,
    known: null,
  };
};

const neutralSlot = (value: string) => {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return (hash % 6) + 1;
};

const colorFor = (parsed: ParsedValue, isMissing: boolean) => {
  if (isMissing) return "var(--party-missing-fill)";
  if (parsed.known?.acronym === "PRM") return "var(--party-prm-fill)";
  if (parsed.known?.acronym === "FP") return "var(--party-fp-fill)";
  if (parsed.known?.acronym === "PLD") return "var(--party-pld-fill)";
  if (parsed.known?.kind === "institution") return "var(--party-institution-fill)";
  if (parsed.known?.kind === "independent") return "var(--party-independent-fill)";

  const stableKey = parsed.acronym ?? parsed.fullName ?? "missing";
  return `var(--party-neutral-${neutralSlot(normalizeForMatch(stableKey))}-fill)`;
};

export function resolvePartyPresentation(
  value?: string | null,
  fullName?: string | null,
  lang: PartyPresentationLanguage = "es",
): PartyPresentation {
  const parsed = parseValue(value, fullName);
  const isMissing = parsed.acronym === null && parsed.fullName === null;
  const missingLabel = lang === "en" ? "Party not reported" : "Partido no informado";
  const missingFullName = lang === "en" ? "full name not reported" : "nombre completo no informado";

  let label = missingLabel;
  if (parsed.acronym && parsed.fullName) {
    label = `${parsed.acronym} (${parsed.fullName})`;
  } else if (parsed.acronym) {
    label = `${parsed.acronym} (${missingFullName})`;
  } else if (parsed.fullName) {
    label = parsed.fullName;
  }

  return {
    acronym: parsed.acronym,
    fullName: parsed.fullName,
    label,
    kind: isMissing ? "missing" : (parsed.known?.kind ?? "unknown"),
    isKnown: parsed.known !== null,
    isMissing,
    color: colorFor(parsed, isMissing),
  };
}

export function partyDisplayLabel(
  value?: string | null,
  fullName?: string | null,
  lang: PartyPresentationLanguage = "es",
): string {
  return resolvePartyPresentation(value, fullName, lang).label;
}

export function partyColor(value?: string | null, isMissing = false): string {
  const parsed = parseValue(value);
  const missing = isMissing || (parsed.acronym === null && parsed.fullName === null);
  return colorFor(parsed, missing);
}
