/**
 * Roster adapter for the Senado de la República (senadord.gob.do).
 *
 * Unlike the Diputados SIL API, the Senate exposes no JSON: its WP REST API is locked
 * (401) and the data is in server-rendered HTML (WordPress + Divi theme). We parse three
 * pages with regex (no HTML-parser dependency, matching the rest of this package):
 *   1. /senadores-2024-2028/                → 32 senator cards (name, province slug, board role)
 *   2. /provincia/{slug}/                    → that senator's party (one HTTP call each)
 *   3. /comisiones/lista-de-comisiones/      → every committee + its numbered member list w/ cargos
 *
 * Each of the 32 seats maps to exactly one province (31 provinces + Distrito Nacional),
 * so province comes straight from the card's slug — no geocoding needed.
 */
import { browserHeaders, fetchText } from "./http.js";
import type { RawCommissionMembership, RawLegislator, RosterResult } from "./roster.js";
import { REVIEWED_SENADO_SIL_PERSON_BRIDGE } from "./senado-sil.js";

const ORIGIN = "https://www.senadord.gob.do";
const H = browserHeaders({ Referer: `${ORIGIN}/` });
export const SENADO_ROSTER_URL = `${ORIGIN}/senadores-2024-2028/`;
const SENADO_ROSTER_PERIOD = "2024-2028";
const SENADO_COMMITTEES_URL = `${ORIGIN}/comisiones/lista-de-comisiones/`;

/** Province slug (from /provincia/{slug}) → display name aligned with the map dataset. */
const SLUG_TO_PROVINCE: Record<string, string> = {
  azua: "Azua",
  bahoruco: "Baoruco",
  barahona: "Barahona",
  dajabon: "Dajabón",
  "distrito-nacional": "Distrito Nacional",
  duarte: "Duarte",
  "el-seibo": "El Seibo",
  "elias-pina": "Elías Piña",
  espaillat: "Espaillat",
  "hato-mayor": "Hato Mayor",
  "hermanas-mirabal": "Hermanas Mirabal",
  independencia: "Independencia",
  "la-altagracia": "La Altagracia",
  "la-romana": "La Romana",
  "la-vega": "La Vega",
  "maria-trinidad-sanchez": "María Trinidad Sánchez",
  "monsenor-nouel": "Monseñor Nouel",
  "monte-plata": "Monte Plata",
  montecristi: "Montecristi",
  pedernales: "Pedernales",
  peravia: "Peravia",
  "puerto-plata": "Puerto Plata",
  samana: "Samaná",
  "san-cristobal": "San Cristóbal",
  "san-jose-de-ocoa": "San José de Ocoa",
  "san-juan": "San Juan",
  "san-pedro-de-macoris": "San Pedro de Macorís",
  "sanchez-ramirez": "Sánchez Ramírez",
  santiago: "Santiago",
  "santiago-rodriguez": "Santiago Rodríguez",
  "santo-domingo": "Santo Domingo",
  valverde: "Valverde",
};

interface Card {
  slug: string;
  name: string;
  role: string | null; // directive-board role from the card (Presidente, Vicepresidente…)
  /** Exact identity strings explicitly published for this same card/profile. */
  aliases?: string[];
}

export class SenadoRosterAdapter {
  readonly source = "roster-senado";
  private readonly profileCache = new Map<string, string>();

  async collect(): Promise<RosterResult> {
    this.profileCache.clear();
    const gaps: string[] = [];
    const cards = await this.collectCards(gaps);
    const legislators: RawLegislator[] = [];
    const resolvedCards: Card[] = [];
    for (const card of cards) {
      const province = SLUG_TO_PROVINCE[card.slug] ?? null;
      const url = `${ORIGIN}/provincia/${card.slug}/`;
      let party: string | null = null;
      let partyShort: string | null = null;
      let photoUrl: string | null = null;
      let email: string | null = null;
      let phone: string | null = null;
      let identityAliases = appendReviewedSenadoProfileAlias(
        card.slug,
        card.aliases?.length ? card.aliases : [card.name],
      );
      try {
        const html = this.profileCache.get(card.slug) ?? (await fetchText(url, { headers: H }));
        this.profileCache.set(card.slug, html);
        identityAliases = appendReviewedSenadoProfileAlias(card.slug, [
          ...identityAliases,
          ...parseProfileIdentityAliases(html),
        ]);
        const p = this.parseParty(html);
        party = p.party;
        partyShort = p.partyShort;
        photoUrl = parsePhoto(html);
        email = parseEmail(html);
        phone = parsePhone(html);
      } catch (e) {
        gaps.push(
          `roster-senado: no se pudo leer la ficha de ${card.name} (${(e as Error).message}).`,
        );
      }
      const fullName = selectCanonicalName(identityAliases) ?? card.name;
      resolvedCards.push({ ...card, name: fullName, aliases: identityAliases });
      legislators.push({
        sourceId: card.slug,
        source: this.source,
        chamber: "SENADO",
        fullName,
        province,
        circumscription: null,
        party,
        partyShort,
        role: card.role,
        representationLevel: null,
        period: SENADO_ROSTER_PERIOD,
        photoUrl,
        email,
        phone,
        profession: null,
        sourceUrl: url,
        raw: {
          provenance: {
            sourceUrl: url,
            rosterUrl: SENADO_ROSTER_URL,
            provinceFromOfficialUrlSlug: card.slug,
            rosterPeriod: SENADO_ROSTER_PERIOD,
          },
          explicit: {
            identityAliases,
            party,
            partyShort,
            role: card.role,
            email,
            phone,
            photoUrl,
          },
        },
      });
    }
    if (legislators.length !== 32) {
      gaps.push(
        `roster-senado: ${legislators.length} senadores; cardinalidad oficial esperada: exactamente 32.`,
      );
    }
    const memberships = await this.collectMemberships(gaps);
    // A membership is linked to a profile only on one exact normalized full-name match.
    let unresolved = 0;
    for (const m of memberships) {
      m.legislatorSourceId = matchCardSlug(m.legislatorName, resolvedCards);
      if (!m.legislatorSourceId) unresolved++;
    }
    if (unresolved > 0) {
      gaps.push(
        `roster-senado: ${unresolved} de ${memberships.length} membresías no tienen una coincidencia exacta y única de nombre; legislatorSourceId queda null.`,
      );
    }
    return { legislators, memberships, gaps };
  }

  /** Parse the current-period index into 32 cards (name, province slug, directive role). */
  private async collectCards(gaps: string[]): Promise<Card[]> {
    const html = await fetchText(SENADO_ROSTER_URL, { headers: H });
    const cards = parseSenadoRosterCards(html);
    if (cards.length === 32) return cards;

    gaps.push(
      `roster-senado: ${cards.length} tarjetas únicas parseadas de ${SENADO_ROSTER_URL}; usando respaldo de 32 fichas provinciales.`,
    );
    const fallback = await this.collectCardsFromProfiles(gaps);
    const merged = new Map(fallback.map((card) => [card.slug, card]));
    // Preserve directive-board roles from the index wherever that page still supplied one.
    for (const card of cards) {
      const recovered = merged.get(card.slug);
      merged.set(card.slug, recovered ? { ...recovered, role: card.role ?? recovered.role } : card);
    }
    return [...merged.values()];
  }

  /**
   * Stable fallback when the Divi cards index is broken: every Senate seat has a fixed
   * province URL. Fetch those 32 official profiles in small batches and derive the name
   * from their headings. The HTML is cached so the main enrichment pass does not refetch.
   */
  private async collectCardsFromProfiles(gaps: string[]): Promise<Card[]> {
    const slugs = Object.keys(SLUG_TO_PROVINCE);
    const cards: Card[] = [];
    const failures: string[] = [];
    const concurrency = 4;
    for (let index = 0; index < slugs.length; index += concurrency) {
      const batch = slugs.slice(index, index + concurrency);
      const rows = await Promise.all(
        batch.map(async (slug): Promise<Card | null> => {
          try {
            const html = await fetchText(`${ORIGIN}/provincia/${slug}/`, { headers: H });
            this.profileCache.set(slug, html);
            const aliases = parseProfileIdentityAliases(html);
            const name = selectCanonicalName(aliases);
            if (!name) {
              failures.push(`${slug}: nombre no encontrado`);
              return null;
            }
            return { slug, name, role: null, aliases };
          } catch (error) {
            failures.push(`${slug}: ${(error as Error).message}`);
            return null;
          }
        }),
      );
      cards.push(...rows.filter((row): row is Card => row !== null));
    }
    if (failures.length) {
      gaps.push(
        `roster-senado: fallaron ${failures.length} fichas del respaldo (${failures.slice(0, 3).join("; ")}${failures.length > 3 ? "; …" : ""}).`,
      );
    }
    return cards;
  }

  private parseParty(html: string): { party: string | null; partyShort: string | null } {
    // First "Partido <Nombre> (SIGLAS)" occurrence — robust per recon.
    const m = html.match(/Partido [A-Za-zÁÉÍÓÚÑáéíóúñ ]{3,60}?\(([A-Z]{2,6})\)/);
    if (!m) return { party: null, partyShort: null };
    return { party: m[0]!.replace(/\s+\([A-Z]{2,6}\)\s*$/, "").trim(), partyShort: m[1]! };
  }

  /** Parse /comisiones/lista-de-comisiones/ → one membership row per numbered entry. */
  private async collectMemberships(gaps: string[]): Promise<RawCommissionMembership[]> {
    const url = SENADO_COMMITTEES_URL;
    const html = await fetchText(url, { headers: H });
    const out = parseSenadoCommissionMemberships(html, url);
    if (out.length === 0)
      gaps.push("roster-senado: la página devolvió 0 membresías de comisión parseables.");
    if (!hasExplicitCommitteeEffectiveDate(html)) {
      gaps.push(
        "roster-senado: el listado HTML de comisiones no publica una fecha exacta de vigencia; no se infiere ni se fabrica una.",
      );
    }
    return out;
  }
}

/**
 * Parse the current Divi card modules. The official Peravia card currently contains an
 * invalid nested <h4><a><h4><a> tree, so parsing is anchored on each complete blurb module
 * and its unique province URL instead of assuming a perfectly nested heading.
 */
export function parseSenadoRosterCards(html: string): Card[] {
  const modules = [
    ...html.matchAll(
      /<div\b[^>]*class=["'][^"']*\bet_pb_blurb_\d+\b[^"']*\bet_pb_blurb\b[^"']*["'][^>]*>/gi,
    ),
  ];
  const bySlug = new Map<string, Card>();
  for (let index = 0; index < modules.length; index++) {
    const start = modules[index]!.index!;
    const end = index + 1 < modules.length ? modules[index + 1]!.index! : html.length;
    const block = html.slice(start, end);
    const slugs = new Set(
      [
        ...block.matchAll(
          /href=["'](?:https?:\/\/www\.senadord\.gob\.do)?\/provincia\/([a-z0-9-]+)\/?["']/gi,
        ),
      ]
        .map((match) => match[1]!.toLowerCase())
        .filter((slug) => slug in SLUG_TO_PROVINCE),
    );
    if (slugs.size !== 1) continue;
    const slug = [...slugs][0]!;
    if (bySlug.has(slug)) continue;
    const heading = block.match(
      /<h4\b[^>]*class=["'][^"']*\bet_pb_module_header\b[^"']*["'][^>]*>([\s\S]*?)<\/h4>/i,
    );
    const name = heading ? cleanName(heading[1]!) : null;
    if (!name) continue;
    const description = block.match(
      /<div\b[^>]*class=["'][^"']*\bet_pb_blurb_description\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    )?.[1];
    const roleMatch = description
      ? stripTags(description).match(
          /\b(VICE\s*PRESIDENT[EA]|PRESIDENT[EA]|SECRETARI[OA]|VOCAL|PORTAVOZ)\b/i,
        )
      : null;
    const role = roleMatch ? titleCase(roleMatch[1]!.replace(/\s+/g, " ")) : null;
    const imageAlt = block.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1];
    const aliases = [name];
    if (imageAlt) {
      const altName = cleanName(imageAlt);
      // Accept only a literal whole-name extension, never edit distance/token guessing.
      if (altName && isWholeNameExtension(name, altName)) aliases.push(altName);
    }
    bySlug.set(slug, { slug, name, role, aliases: uniqueNames(aliases) });
  }
  return [...bySlug.values()];
}

/** Parse only numbered membership lines inside each explicit commission toggle. */
export function parseSenadoCommissionMemberships(
  html: string,
  sourceUrl = SENADO_COMMITTEES_URL,
): RawCommissionMembership[] {
  const titles = [
    ...html.matchAll(
      /<h[1-6]\b[^>]*class=["'][^"']*\bet_pb_toggle_title\b[^"']*["'][^>]*>([\s\S]*?)<\/h[1-6]>/gi,
    ),
  ];
  const out: RawCommissionMembership[] = [];
  for (let index = 0; index < titles.length; index++) {
    const commissionName = titleCase(stripTags(titles[index]![1]!).trim());
    if (!commissionName) continue;
    const start = titles[index]!.index! + titles[index]![0]!.length;
    const end = index + 1 < titles.length ? titles[index + 1]!.index! : html.length;
    const text = stripTags(html.slice(start, end));
    for (const rawLine of text.split(/\n+/)) {
      const numbered = rawLine.trim().match(/^\d+\.\s*(.+)$/);
      if (!numbered) continue;
      let identity = numbered[1]!.trim();
      let cargo: string | null = null;
      const cargoMatch = identity.match(
        /,\s*(VICE\s*PRESIDENT[EA]|PRESIDENT[EA]|SECRETARI[OA]|MIEMBRO)\s*,?$/i,
      );
      if (cargoMatch) {
        cargo = cargoMatch[1]!.trim();
        identity = identity.slice(0, cargoMatch.index).trim();
      }
      const memberName = cleanName(identity.replace(/,\s*$/, ""));
      if (!memberName) continue;
      out.push({
        source: "roster-senado",
        chamber: "SENADO",
        commissionName,
        commissionSourceId: null,
        legislatorName: memberName,
        legislatorSourceId: null,
        cargo,
        party: null,
        sourceUrl,
      });
    }
  }
  return out;
}

/** Extract the senator's full name from a province profile without relying on Divi classes. */
export function parseProfileName(html: string): string | null {
  const candidates = [...html.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)]
    .map((match) => {
      const raw = stripTags(match[1]!).replace(/\s+/g, " ").trim();
      const after = stripTags(
        html.slice(
          (match.index ?? 0) + match[0].length,
          (match.index ?? 0) + match[0].length + 700,
        ),
      );
      return { raw, after };
    })
    .filter(
      ({ raw }) =>
        raw.length >= 7 &&
        raw.length <= 100 &&
        raw.trim().split(/\s+/).length >= 2 &&
        /^[\p{L}.'\- ]+$/u.test(raw) &&
        !/senado|senador|república|provincia|oficina|partido|comisión|transparencia/i.test(raw),
    );
  const contextual = candidates.filter(({ after }) =>
    /SENADOR(?:A)? DE LA REP[\u00daU]BLICA/i.test(after),
  );
  return contextual.length === 1 ? titleCase(contextual[0]!.raw) : null;
}

/** Exact first-party identity strings exposed in the profile heading and page title. */
export function parseProfileIdentityAliases(html: string): string[] {
  const aliases: string[] = [];
  const heading = parseProfileName(html);
  if (heading) aliases.push(heading);
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) {
    const visible = decodeEntities(stripTags(title)).replace(/\s+/g, " ").trim();
    const match = visible.match(/^Senado\s*\|\s*(.+?)\s*-\s*Senador(?:a)?\b/i);
    const titleName = match ? cleanName(match[1]!) : null;
    if (titleName) aliases.push(titleName);
  }
  // The first et_pb_image_0 inside a province profile is the senator portrait. Its
  // title/alt are explicit identity fields structurally attached to that one profile;
  // they are aliases, not fuzzy transformations. Duplicate aliases across profiles
  // still fail closed later in matchCardSlug.
  const portraitModule = html.match(
    /<div\b[^>]*class=["'][^"']*\bet_pb_image_0\b[^"']*["'][^>]*>([\s\S]{0,3000}?)<\/div>/i,
  )?.[1];
  const portraitTag = portraitModule?.match(/<img\b[^>]*>/i)?.[0];
  if (portraitTag) {
    for (const attribute of ["title", "alt"] as const) {
      const raw = portraitTag.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i"))?.[1];
      const portraitName = raw ? cleanName(raw) : null;
      if (portraitName) aliases.push(portraitName);
    }
  }
  return uniqueNames(aliases);
}

/**
 * Add only the profile-name aliases explicitly reviewed in the Senate SIL bridge for
 * this exact province slug. The SIL `officialName` is deliberately not an alias source:
 * it describes a separate catalog and may differ from public roster identity literals.
 * Duplicate bridge rows fail closed instead of choosing one.
 */
export function appendReviewedSenadoProfileAlias(
  rosterSourceId: string,
  aliases: readonly string[],
): string[] {
  const matches = REVIEWED_SENADO_SIL_PERSON_BRIDGE.filter(
    (row) => row.rosterSourceId === rosterSourceId,
  );
  const reviewedAliases =
    matches.length === 1
      ? (matches[0]!.profileNameAliases ?? []).map((alias) => alias.trim()).filter(Boolean)
      : [];
  if (reviewedAliases.length === 0) return uniqueNames(aliases);

  // `uniqueNames` intentionally folds accents for committee matching. Do not let that
  // erase reviewed literals: DB identity safety compares historical aliases with
  // conservative NFC/whitespace/case normalization only.
  const reviewedByKey = new Map(
    reviewedAliases.map((alias) => [exactIdentityAliasKey(alias), alias] as const),
  );
  const publishedAliases = aliases.filter(
    (alias) => !reviewedByKey.has(exactIdentityAliasKey(alias)),
  );
  return [...uniqueNames(publishedAliases), ...reviewedByKey.values()];
}

/**
 * The senator's profile photo: the first /wp-content/uploads/ JPEG/PNG that isn't a
 * logo, flag, gallery thumbnail (`-WxH.jpg`) or lightbox photo (`DSC_…`). The hero
 * portrait is rendered in a plain et_pb_image module and precedes those decorations.
 */
function parsePhoto(html: string): string | null {
  const re = /src="(https?:\/\/[^"]*?\/wp-content\/uploads\/[^"]+\.(?:jpe?g|png))"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const u = m[1]!;
    if (/logo|bandera|escudo|placeholder|default|avatar|[/-]dsc[_-]|-\d+x\d+\.[a-z]+$/i.test(u))
      continue;
    return u;
  }
  return null;
}

/** Province contact email (e.g. "santiago@senado.gob.do"), skipping the generic info@. */
function parseEmail(html: string): string | null {
  const re = /mailto:([A-Za-z0-9._%+-]+@senado\.gob\.do)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const e = m[1]!;
    if (/^info@/i.test(e)) continue;
    return e.toLowerCase();
  }
  return null;
}

/** Published contact phone ("Tel: (809) 532-5561"). The Senate publishes one switchboard
 *  number per province ficha — not a private line — so it is safe to surface. */
function parsePhone(html: string): string | null {
  const m = html.match(/Tel[:.]?\s*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  return m ? m[1]!.replace(/\s+/g, " ").trim() : null;
}

/** Case/accent/punctuation folding only; no token dropping or fuzzy comparison. */
export function normalizeRosterName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a committee membership only when its complete normalized name occurs once.
 */
export function matchCardSlug(memberName: string, cards: Card[]): string | null {
  const key = normalizeRosterName(memberName);
  if (!key) return null;
  const matches = cards.filter((card) =>
    uniqueNames([card.name, ...(card.aliases ?? [])]).some(
      (alias) => normalizeRosterName(alias) === key,
    ),
  );
  return matches.length === 1 ? matches[0]!.slug : null;
}

function cleanName(value: string): string | null {
  const visible = decodeEntities(stripTags(value)).replace(/\s+/g, " ").trim();
  if (
    visible.length < 5 ||
    visible.length > 120 ||
    visible.split(/\s+/).length < 2 ||
    !/^[\p{L}.'\- ]+$/u.test(visible)
  ) {
    return null;
  }
  return titleCase(visible);
}

function uniqueNames(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = normalizeRosterName(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function exactIdentityAliasKey(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("es-DO");
}

function selectCanonicalName(values: readonly string[]): string | null {
  return (
    uniqueNames(values).sort((left, right) => {
      const leftKey = normalizeRosterName(left);
      const rightKey = normalizeRosterName(right);
      const tokenDelta = rightKey.split(" ").length - leftKey.split(" ").length;
      return tokenDelta || rightKey.length - leftKey.length;
    })[0] ?? null
  );
}

function isWholeNameExtension(left: string, right: string): boolean {
  const a = normalizeRosterName(left);
  const b = normalizeRosterName(right);
  return a === b || a.startsWith(`${b} `) || b.startsWith(`${a} `);
}

/** The HTML has a last-modified timestamp, but no effective date for this composition. */
function hasExplicitCommitteeEffectiveDate(html: string): boolean {
  return /(?:vigente|vigencia|conformación|composición)\s+(?:desde|al|a partir del)\s+\d{1,2}[/-]\d{1,2}[/-]\d{4}/i.test(
    stripTags(html),
  );
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "\n")).replace(/[ \t]+/g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&aacute;/g, "á")
    .replace(/&eacute;/g, "é")
    .replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó")
    .replace(/&uacute;/g, "ú")
    .replace(/&ntilde;/g, "ñ")
    .replace(/&Aacute;/g, "Á")
    .replace(/&Eacute;/g, "É")
    .replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó")
    .replace(/&Uacute;/g, "Ú")
    .replace(/&Ntilde;/g, "Ñ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8217;/g, "'");
}

/** "RICARDO DE LOS SANTOS" → "Ricardo De Los Santos"; leaves already-mixed text alone. */
function titleCase(s: string): string {
  const trimmed = s.trim();
  // Mixed-case text (already has lowercase letters) is left untouched.
  if (/\p{Ll}/u.test(trimmed)) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/(^|[\s/.-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}
