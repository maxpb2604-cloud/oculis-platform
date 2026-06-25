/**
 * Roster adapter for the Senado de la República (senadord.gob.do).
 *
 * Unlike the Diputados SIL API, the Senate exposes no JSON: its WP REST API is locked
 * (401) and the data is in server-rendered HTML (WordPress + Divi theme). We parse three
 * pages with regex (no HTML-parser dependency, matching the rest of this package):
 *   1. /senadores/                          → 32 senator cards (name, province slug, board role)
 *   2. /provincia/{slug}/                    → that senator's party (one HTTP call each)
 *   3. /comisiones/lista-de-comisiones/      → every committee + its numbered member list w/ cargos
 *
 * Each of the 32 seats maps to exactly one province (31 provinces + Distrito Nacional),
 * so province comes straight from the card's slug — no geocoding needed.
 */
import { browserHeaders, fetchText } from "./http.js";
import { normalizeCargo, type RawCommissionMembership, type RawLegislator, type RosterResult } from "./roster.js";

const ORIGIN = "https://www.senadord.gob.do";
const H = browserHeaders({ Referer: `${ORIGIN}/` });

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
}

export class SenadoRosterAdapter {
  readonly source = "roster-senado";

  async collect(): Promise<RosterResult> {
    const gaps: string[] = [];
    const cards = await this.collectCards(gaps);
    const legislators: RawLegislator[] = [];
    for (const card of cards) {
      const province = SLUG_TO_PROVINCE[card.slug] ?? null;
      const url = `${ORIGIN}/provincia/${card.slug}/`;
      let party: string | null = null;
      let partyShort: string | null = null;
      let photoUrl: string | null = null;
      let email: string | null = null;
      let phone: string | null = null;
      let profession: string | null = null;
      try {
        const html = await fetchText(url, { headers: H });
        const p = this.parseParty(html);
        party = p.party;
        partyShort = p.partyShort;
        photoUrl = parsePhoto(html);
        email = parseEmail(html);
        phone = parsePhone(html);
        profession = parseProfession(html);
      } catch (e) {
        gaps.push(`roster-senado: no se pudo leer la ficha de ${card.name} (${(e as Error).message}).`);
      }
      legislators.push({
        sourceId: card.slug,
        source: this.source,
        chamber: "SENADO",
        fullName: card.name,
        province,
        circumscription: null,
        party,
        partyShort,
        role: card.role,
        representationLevel: "Provincial",
        period: "2024-2028",
        photoUrl,
        email,
        phone,
        profession,
        sourceUrl: url,
      });
    }
    if (legislators.length < 32) {
      gaps.push(`roster-senado: ${legislators.length} senadores (se esperan 32) — revisar la página /senadores/.`);
    }
    const memberships = await this.collectMemberships(gaps);
    // The committee page lists members by FULL legal name ("Ricardo De Los Santos Polanco")
    // while the roster cards use a shorter form ("Ricardo De Los Santos"). Resolve each
    // member to its senator card so the profile page can join committees by source id
    // (a plain normalized-name match fails on the extra surnames). Senate committees are
    // composed solely of senators, so every membership should resolve to one of the 32.
    let unresolved = 0;
    for (const m of memberships) {
      m.legislatorSourceId = matchCardSlug(m.legislatorName, cards);
      if (!m.legislatorSourceId) unresolved++;
    }
    if (unresolved > 0) {
      gaps.push(`roster-senado: ${unresolved} de ${memberships.length} membresías de comisión sin senador resuelto (revisar coincidencia de nombres).`);
    }
    return { legislators, memberships, gaps };
  }

  /** Parse the /senadores/ index into 32 cards (name, province slug, directive role). */
  private async collectCards(gaps: string[]): Promise<Card[]> {
    const html = await fetchText(`${ORIGIN}/senadores/`, { headers: H });
    const cards: Card[] = [];
    const re =
      /et_pb_module_header"><a href="\/provincia\/([^"]+)">([^<]+)<\/a><\/h4>([\s\S]*?)(?=et_pb_module_header"><a href="\/provincia\/|$)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const slug = m[1]!.trim();
      const name = decodeEntities(m[2]!.trim());
      const descMatch = m[3]!.match(/et_pb_blurb_description">([\s\S]*?)<\/div>/);
      let role: string | null = null;
      if (descMatch) {
        const lines = stripTags(descMatch[1]!)
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean);
        // First line is the board role (PRESIDENTE / VICE PRESIDENTE / SECRETARIO) when
        // present; the province line is uppercase too, so only keep known role words.
        if (lines[0] && /president|secretari|vocal|portavoz/i.test(lines[0])) {
          role = titleCase(lines[0]);
        }
      }
      cards.push({ slug, name, role });
    }
    if (cards.length === 0) gaps.push("roster-senado: 0 cards parseadas de /senadores/ — el selector pudo cambiar.");
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
    const url = `${ORIGIN}/comisiones/lista-de-comisiones/`;
    const html = await fetchText(url, { headers: H });
    const titles = [...html.matchAll(/et_pb_toggle_title">([\s\S]*?)<\/h\d>/g)];
    const out: RawCommissionMembership[] = [];
    for (let i = 0; i < titles.length; i++) {
      const name = titleCase(stripTags(titles[i]![1]!).trim());
      const start = titles[i]!.index! + titles[i]![0]!.length;
      const end = i + 1 < titles.length ? titles[i + 1]!.index! : html.length;
      const text = stripTags(html.slice(start, end));
      for (const line of text.split(/\n+/)) {
        const lm = line.trim().match(/^\d+\.\s*(.+?)(?:,\s*([A-Za-zÁÉÍÓÚÑáéíóúñ/.\- ]+))?$/);
        if (!lm) continue;
        const memberName = titleCase(decodeEntities(lm[1]!.trim()));
        if (!memberName) continue;
        out.push({
          source: this.source,
          chamber: "SENADO",
          commissionName: name,
          commissionSourceId: null,
          legislatorName: memberName,
          legislatorSourceId: null,
          cargo: normalizeCargo(lm[2] ?? null) ?? "Miembro",
          party: null,
          sourceUrl: url,
        });
      }
    }
    if (out.length === 0) gaps.push("roster-senado: 0 miembros de comisión parseados — revisar la página de comisiones.");
    return out;
  }
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
    if (/logo|bandera|escudo|placeholder|default|avatar|[/-]dsc[_-]|-\d+x\d+\.[a-z]+$/i.test(u)) continue;
    return u;
  }
  return null;
}

/** Province contact email (e.g. "santiago@senado.gob.do"), skipping the generic info@. */
function parseEmail(html: string): string | null {
  const re = /mailto:([A-Za-z0-9._%+\-]+@senado\.gob\.do)/gi;
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
  const m = html.match(/Tel[:.]?\s*(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/);
  return m ? m[1]!.replace(/\s+/g, " ").trim() : null;
}

/**
 * Profession/biography. The fichas carry no labelled "Profesión" field, only a free-form
 * biography that consistently opens with "Nació el…". We surface a trimmed excerpt of that
 * paragraph (the most reliable signal of background/profession), or null when absent.
 */
function parseProfession(html: string): string | null {
  const re = /et_pb_text_inner">([\s\S]*?)<\/div>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const txt = stripTags(m[1]!).replace(/\s+/g, " ").trim();
    // The bio paragraph reliably opens "Nació …" (note: JS \b is ASCII-only and won't
    // anchor after the accented "ó", so match the following space explicitly).
    if (/^Naci[oó]\s/.test(txt) && txt.length > 80) return txt.slice(0, 300).trim();
  }
  return null;
}

/** Connector words dropped when matching names (they carry no identity). */
const NAME_STOPWORDS = new Set(["de", "del", "la", "las", "los", "y", "da", "do"]);

/** Significant lowercased, accent-folded name tokens (given name + surnames). */
export function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !NAME_STOPWORDS.has(t));
}

/**
 * Resolve a committee member's full legal name to one of the senator cards (by slug).
 * Scores on overlapping significant tokens of length ≥3 (ignoring initials and connectors)
 * and requires at least 2 to match — typically a surname pair, which is highly specific
 * across only 32 senators. This tolerates given-name differences (a senator who goes by his
 * second name: card "Secundino Velázquez Pimentel" vs member "Augusto Velázquez Pimentel")
 * and spelling variants ("Ginnette"/"Ginette"). Returns null on an ambiguous tie so a single
 * shared surname can't mis-link.
 */
export function matchCardSlug(memberName: string, cards: Card[]): string | null {
  const mTokens = nameTokens(memberName).filter((t) => t.length >= 3);
  const mSet = new Set(mTokens);
  if (mSet.size < 1) return null;
  let best: string | null = null;
  let bestScore = 0;
  let tie = false;
  for (const c of cards) {
    const overlap = nameTokens(c.name).filter((t) => t.length >= 3 && mSet.has(t)).length;
    if (overlap < 2) continue;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = c.slug;
      tie = false;
    } else if (overlap === bestScore) {
      tie = true;
    }
  }
  if (best) return tie ? null : best;
  // Fallback for abbreviated/variant names (e.g. "Ginette A. Bournigal" vs card
  // "Ginnette Altagracia Bournigal"): a single distinctive SURNAME (≥6 chars) that belongs
  // to exactly one card is an unambiguous match. Skip the first token (the given name) so a
  // common given name like "Antonio" can't trigger a false link.
  for (const t of mTokens.slice(1)) {
    if (t.length < 6) continue;
    const owners = cards.filter((c) => nameTokens(c.name).includes(t));
    if (owners.length === 1) return owners[0]!.slug;
  }
  return null;
}

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "\n")).replace(/[ \t]+/g, " ");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&ntilde;/g, "ñ")
    .replace(/&Aacute;/g, "Á").replace(/&Eacute;/g, "É").replace(/&Iacute;/g, "Í")
    .replace(/&Oacute;/g, "Ó").replace(/&Uacute;/g, "Ú").replace(/&Ntilde;/g, "Ñ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#8217;/g, "'");
}

/** "RICARDO DE LOS SANTOS" → "Ricardo De Los Santos"; leaves already-mixed text alone. */
function titleCase(s: string): string {
  const trimmed = s.trim();
  // Mixed-case text (already has lowercase letters) is left untouched.
  if (/\p{Ll}/u.test(trimmed)) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/(^|[\s/.\-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}
