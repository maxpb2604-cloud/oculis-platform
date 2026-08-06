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
import type { RawCommissionMembership, RawLegislator, RosterResult } from "./roster.js";

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
  private readonly profileCache = new Map<string, string>();

  async collect(): Promise<RosterResult> {
    this.profileCache.clear();
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
      try {
        const html = this.profileCache.get(card.slug) ?? (await fetchText(url, { headers: H }));
        this.profileCache.set(card.slug, html);
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
        representationLevel: null,
        period: null,
        photoUrl,
        email,
        phone,
        profession: null,
        sourceUrl: url,
        raw: {
          provenance: {
            sourceUrl: url,
            rosterUrl: `${ORIGIN}/senadores/`,
            provinceFromOfficialUrlSlug: card.slug,
          },
          explicit: { party, partyShort, role: card.role, email, phone, photoUrl },
        },
      });
    }
    if (legislators.length < 32) {
      gaps.push(
        `roster-senado: ${legislators.length} senadores; referencia constitucional esperada: 32.`,
      );
    }
    const memberships = await this.collectMemberships(gaps);
    // A membership is linked to a profile only on one exact normalized full-name match.
    let unresolved = 0;
    for (const m of memberships) {
      m.legislatorSourceId = matchCardSlug(m.legislatorName, cards);
      if (!m.legislatorSourceId) unresolved++;
    }
    if (unresolved > 0) {
      gaps.push(
        `roster-senado: ${unresolved} de ${memberships.length} membresías no tienen una coincidencia exacta y única de nombre; legislatorSourceId queda null.`,
      );
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
    if (cards.length >= 30) return cards;

    gaps.push(
      `roster-senado: ${cards.length} cards parseadas de /senadores/; usando respaldo de 32 fichas provinciales.`,
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
            const name = parseProfileName(html);
            if (!name) {
              failures.push(`${slug}: nombre no encontrado`);
              return null;
            }
            return { slug, name, role: null };
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
          cargo: lm[2]?.trim() || null,
          party: null,
          sourceUrl: url,
        });
      }
    }
    if (out.length === 0)
      gaps.push("roster-senado: la página devolvió 0 membresías de comisión parseables.");
    return out;
  }
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
  const matches = cards.filter((card) => normalizeRosterName(card.name) === key);
  return matches.length === 1 ? matches[0]!.slug : null;
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
