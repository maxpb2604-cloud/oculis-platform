/**
 * Feed scrapers — the news/social twin of the regulatory adapters.
 *
 * Three kinds of source feed the Congress timeline, all link-back-able and verifiable:
 *  - OFFICIAL: Senado + Cámara de Diputados news (their WordPress RSS).
 *  - NEWS: source-scoped DR press feeds and an explicit Congress search feed.
 *  - SOCIAL: X / Instagram via a CREDENTIAL-GATED adapter driven by the curated
 *    account registry (`feed_accounts`). With no API token it returns nothing (the
 *    accounts remain a browsable directory); with a token it pulls recent posts.
 *
 * The "before the news" legislative-signal cards (deposits / agenda / status changes)
 * are produced in the worker (`feed-signals.ts`) because they read the DB — adapters
 * here stay pure (no DB), mirroring the `SourceAdapter` contract in `types.ts`.
 *
 * NOTE: the RSS URLs below follow each site's WordPress/CMS conventions but should be
 * treated as verify-on-first-run — a wrong path surfaces as a "0 ítems" gap (never a
 * crash), so the daily run keeps going and the gap is visible in `ingestion_runs`.
 */
import { extractCodes } from "./codes.js";
import { fetchText } from "./http.js";

export type FeedKind = "NEWS" | "OFFICIAL" | "SOCIAL" | "LEGISLATIVE";
export type FeedPlatform = "X" | "INSTAGRAM" | "RSS" | "WEB";

/** Canonical, source-agnostic feed item (pure — no DB types). */
export interface RawFeedItem {
  source: string; // adapter key, e.g. "feed-senado", "feed-diariolibre", "feed-x"
  sourceId: string; // stable id within the source (guid / link / status id)
  kind: FeedKind;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  url: string | null;
  author: string | null;
  handle: string | null; // @handle for social
  platform: FeedPlatform;
  category: string | null; // source-reported only; worker leaves its taxonomy null
  publishedAt: string | null; // ISO datetime
  chamber: string | null; // SENADO | DIPUTADOS | null
  initiativeCodes: string[]; // official codes mentioned (resolved to ids in the worker)
  raw: unknown;
}

export interface FeedAdapter {
  readonly source: string;
  readonly kind: FeedKind;
  collect(): Promise<{ items: RawFeedItem[]; gaps: string[] }>;
}

// --- RSS/Atom reader with image + author extraction (no XML dependency) ---

/** Named HTML entities common in DR-Spanish RSS (accents, punctuation, symbols). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  aacute: "á",
  eacute: "é",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  Aacute: "Á",
  Eacute: "É",
  Iacute: "Í",
  Oacute: "Ó",
  Uacute: "Ú",
  ntilde: "ñ",
  Ntilde: "Ñ",
  uuml: "ü",
  Uuml: "Ü",
  ccedil: "ç",
  Ccedil: "Ç",
  iquest: "¿",
  iexcl: "¡",
  ordf: "ª",
  ordm: "º",
  deg: "°",
  middot: "·",
  laquo: "«",
  raquo: "»",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  euro: "€",
  trade: "™",
  copy: "©",
  reg: "®",
};

function decodeOnce(s: string): string {
  return s
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => safeCodePoint(parseInt(n, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}
/** Decode numeric (&#243; / &#xF3;) and named (&aacute;) HTML entities — twice, to
 *  handle the double-encoding some feeds emit (e.g. "&amp;#37;" → "&#37;" → "%"). */
function decodeEntities(s: string): string {
  const once = decodeOnce(s);
  return /&(#\d|#x|[a-zA-Z]+;)/.test(once) ? decodeOnce(once) : once;
}
function safeCodePoint(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return "";
  try {
    return String.fromCodePoint(n);
  } catch {
    return "";
  }
}

const strip = (s: string) =>
  decodeEntities(s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

function tagText(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? strip(m[1]!) : null;
}
function rawTag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1]! : null;
}
function tagAttr(block: string, name: string, attr: string): string | null {
  const m = block.match(new RegExp(`<${name}\\b[^>]*?\\b${attr}=["']([^"']+)["']`, "i"));
  return m ? m[1]! : null;
}
function firstImg(html: string | null): string | null {
  if (!html) return null;
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1]! : null;
}
function enclosureImage(block: string): string | null {
  const m =
    block.match(/<enclosure\b[^>]*type=["']image[^"']*["'][^>]*url=["']([^"']+)["']/i) ??
    block.match(/<enclosure\b[^>]*url=["']([^"']+)["'][^>]*type=["']image/i);
  return m ? m[1]! : null;
}
export function rssDateToIso(d: string | null): string | null {
  if (!d) return null;
  const hasExplicitTime = /(?:T|\s)\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?/i.test(d);
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2}|\b(?:GMT|UTC)\b)\s*$/i.test(d);
  if (!hasExplicitTime || !hasExplicitZone) return null;
  const ms = Date.parse(d);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  return null;
}

export interface RichRssItem {
  title: string;
  link: string | null;
  publishedAt: string | null;
  summary: string | null;
  imageUrl: string | null;
  author: string | null;
  /** Literal RSS/Atom <source> label, when the feed supplies one. */
  feedSource: string | null;
  guid: string | null;
}

/** Read an RSS or Atom feed, extracting title/link/date/summary/image/author per item. */
export async function readRichRss(url: string): Promise<RichRssItem[]> {
  const xml = await fetchText(url, {
    timeoutMs: 20_000,
    headers: {
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
  });
  return parseRichRssXml(xml);
}

/** Pure RSS parser used by adapters and factual-integrity tests. */
export function parseRichRssXml(xml: string): RichRssItem[] {
  const blocks = [
    ...[...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]),
    ...[...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]),
  ];
  return blocks.map((b): RichRssItem => {
    const content =
      rawTag(b, "content:encoded") ?? rawTag(b, "description") ?? rawTag(b, "summary");
    const image =
      tagAttr(b, "media:content", "url") ??
      tagAttr(b, "media:thumbnail", "url") ??
      enclosureImage(b) ??
      firstImg(content);
    const link = tagText(b, "link") || tagAttr(b, "link", "href");
    // Description/summary are explicit source fields. Full article content is not
    // repackaged or truncated into a synthetic summary when those fields are absent.
    const summary = tagText(b, "description") ?? tagText(b, "summary");
    return {
      title: tagText(b, "title") ?? "",
      link,
      publishedAt: rssDateToIso(
        tagText(b, "pubDate") ??
          tagText(b, "dc:date") ??
          tagText(b, "published") ??
          tagText(b, "updated"),
      ),
      summary,
      imageUrl: image,
      author: tagText(b, "dc:creator") ?? tagText(b, "author"),
      feedSource: tagText(b, "source"),
      guid: tagText(b, "guid") ?? link,
    };
  });
}

/**
 * Stable dedup key from an article URL: lowercases the host and drops only the
 * client-side fragment. Query parameters remain part of source identity because
 * distinct official URLs must not be collapsed. Used instead of the RSS `<guid>`
 * because some sources rotate their guid across publish cycles (e.g. Diario
 * Libre emits a fresh UUID guid for the same article over time), which defeated
 * the `(source, sourceId)` uniqueness and re-inserted every article each run.
 * The URL's permanent article id is the durable identity.
 */
export function canonicalLink(link: string | null): string | null {
  if (!link) return null;
  try {
    const u = new URL(link);
    u.hostname = u.hostname.toLowerCase();
    u.hash = "";
    return u.toString();
  } catch {
    return link;
  }
}

export interface RssAdapterOpts {
  source: string;
  kind: FeedKind;
  feeds: string[];
  chamber?: string | null;
  category?: string | null;
}

/** Generic RSS-backed feed adapter; one instance per outlet (may read several feeds). */
export class RssFeedAdapter implements FeedAdapter {
  readonly source: string;
  readonly kind: FeedKind;
  constructor(private readonly opts: RssAdapterOpts) {
    this.source = opts.source;
    this.kind = opts.kind;
  }

  async collect(): Promise<{ items: RawFeedItem[]; gaps: string[] }> {
    const items: RawFeedItem[] = [];
    const gaps: string[] = [];
    const seen = new Set<string>();
    let successfulFeeds = 0;
    for (const feed of this.opts.feeds) {
      try {
        const rss = await readRichRss(feed);
        successfulFeeds++;
        for (const r of rss) {
          if (!r.title) continue;
          const text = `${r.title} ${r.summary ?? ""}`;
          // Key on the canonical URL (stable) before the guid (some sources rotate it).
          const sourceId = canonicalLink(r.link) ?? r.guid ?? r.title;
          if (seen.has(sourceId)) continue;
          seen.add(sourceId);
          items.push({
            source: this.source,
            sourceId,
            kind: this.kind,
            title: r.title,
            summary: r.summary,
            imageUrl: r.imageUrl,
            url: r.link,
            author: r.author,
            handle: null,
            platform: "RSS",
            category: this.opts.category ?? null,
            publishedAt: r.publishedAt,
            chamber: this.opts.chamber ?? null,
            initiativeCodes: extractCodes(text),
            raw: { payload: r, provenance: { feedUrl: feed } },
          });
        }
        if (rss.length === 0) {
          gaps.push(`${this.source} · ${feed}: 0 ítems (verificar la URL del feed RSS).`);
        }
      } catch (err) {
        gaps.push(`${this.source} · ${feed}: ${(err as Error).message}`);
      }
    }
    if (successfulFeeds === 0) {
      throw new Error(gaps.join(" | ") || `${this.source}: no feed could be read`);
    }
    return { items, gaps };
  }
}

/**
 * Google News RSS adapter — the reliable path for outlets whose own RSS is dead/redirected
 * (Listín, Acento, El Nacional, Hoy, El Caribe). Queries Google News restricted to DR sites
 * + Congress terms, so results are recent, DR-specific, and source-attributed. The item's
 * outlet comes from the RSS `<source>` element and is stored as `author` (shown on the
 * card). Items older than ~5 weeks are dropped (Google sometimes mixes in stale results).
 */
export class GoogleNewsAdapter implements FeedAdapter {
  readonly source: string;
  readonly kind: FeedKind = "NEWS";
  constructor(private readonly opts: { source: string; query: string }) {
    this.source = opts.source;
  }

  async collect(): Promise<{ items: RawFeedItem[]; gaps: string[] }> {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(this.opts.query)}&hl=es-419&gl=DO&ceid=DO:es-419`;
    const items: RawFeedItem[] = [];
    const gaps: string[] = [];
    const cutoff = Date.now() - 35 * 86_400_000;
    try {
      const rss = await readRichRss(url);
      const seen = new Set<string>();
      for (const r of rss) {
        if (!r.title) continue;
        if (r.publishedAt && Date.parse(r.publishedAt) < cutoff) continue; // drop stale
        const outlet = r.feedSource;
        const title = r.title;
        const sourceId = canonicalLink(r.link) ?? r.guid ?? title;
        if (seen.has(sourceId)) continue;
        seen.add(sourceId);
        items.push({
          source: this.source,
          sourceId,
          kind: "NEWS",
          title,
          summary: null, // Google News descriptions are just a link, not a usable summary
          imageUrl: null,
          url: r.link,
          author: outlet,
          handle: null,
          platform: "RSS",
          category: null,
          publishedAt: r.publishedAt,
          chamber: null,
          initiativeCodes: extractCodes(title),
          raw: { payload: r, provenance: { feedUrl: url, query: this.opts.query } },
        });
      }
      if (rss.length === 0) gaps.push(`${this.source}: 0 ítems de Google News.`);
    } catch (err) {
      throw new Error(`${this.source}: ${(err as Error).message}`);
    }
    return { items, gaps };
  }
}

/** Official chamber news — everything they publish is in scope (no keyword filter). */
export function officialFeedAdapters(): FeedAdapter[] {
  return [
    new RssFeedAdapter({
      source: "feed-senado",
      kind: "OFFICIAL",
      chamber: "SENADO",
      feeds: [
        "https://www.senadord.gob.do/category/noticias/feed/",
        "https://www.senadord.gob.do/feed/",
      ],
    }),
    new RssFeedAdapter({
      source: "feed-diputados",
      kind: "OFFICIAL",
      chamber: "DIPUTADOS",
      feeds: ["https://camaradediputados.gob.do/feed/"],
    }),
  ];
}

/**
 * Respected DR press. Diario Libre's own RSS still works (direct article links); the other
 * outlets (Listín, Acento, El Nacional, Hoy, El Caribe…) killed/redirected their feeds, so
 * a single Google-News adapter — restricted to those DR sites + Congress terms — supplies
 * recent, source-attributed Congress news from them. The worker persists the query output as-is.
 */
export function pressFeedAdapters(): FeedAdapter[] {
  const sites = [
    "listindiario.com",
    "acento.com.do",
    "elnacional.com.do",
    "hoy.com.do",
    "elcaribe.com.do",
    "n.com.do",
    "eldia.com.do",
    // Additional reputable DR outlets for broader Congress coverage.
    // (Diario Libre is intentionally excluded — it has its own RSS adapter above;
    //  Google News would store a news.google.com redirect URL that can't dedup against it.)
    "elnuevodiario.com.do",
    "almomento.net",
    "cdn.com.do",
    "z101digital.com",
    "proceso.com.do",
  ]
    .map((s) => `site:${s}`)
    .join(" OR ");
  const terms =
    '(congreso OR senado OR senador OR diputados OR "cámara de diputados" OR legislación OR legislativo OR gabinete)';
  return [
    new RssFeedAdapter({
      source: "feed-diariolibre",
      kind: "NEWS",
      // This source labels the section itself; persist it as-is without a worker
      // topic decision over article text.
      feeds: ["https://www.diariolibre.com/rss/politica.xml"],
    }),
    // 30-day window (matches the adapter's 35-day staleness cutoff) for more depth.
    new GoogleNewsAdapter({ source: "feed-prensa", query: `(${sites}) ${terms} when:30d` }),
  ];
}

/** RSS/official adapters (social is wired separately — it needs the registry + creds). */
export function feedAdapters(): FeedAdapter[] {
  return [...officialFeedAdapters(), ...pressFeedAdapters()];
}

// --- Social (credential-gated) ---

export interface SocialAccount {
  handle: string;
  name: string;
  legislatorSourceId?: string | null;
  chamber?: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * X / Twitter adapter. Reads X_BEARER_TOKEN; with no token it returns nothing and a
 * "directory mode" gap (the accounts still show as a follow list in the UI). With a
 * token it pulls each account's recent tweets via the X API v2. Pure: the worker passes
 * the account list in (read from `feed_accounts`).
 */
export class XSocialAdapter {
  readonly source = "feed-x";
  readonly kind: FeedKind = "SOCIAL";
  constructor(private readonly token = process.env.X_BEARER_TOKEN) {}

  async collect(accounts: SocialAccount[]): Promise<{ items: RawFeedItem[]; gaps: string[] }> {
    if (accounts.length === 0) {
      return {
        items: [],
        gaps: ["feed-x · no hay cuentas activas con evidencia de verificación."],
      };
    }
    if (!this.token) {
      return {
        items: [],
        gaps: ["feed-x · X_BEARER_TOKEN no configurado — modo directorio (sin publicaciones)."],
      };
    }
    const items: RawFeedItem[] = [];
    const gaps: string[] = [];
    const handles = accounts.map((a) => a.handle.replace(/^@/, "")).filter(Boolean);
    for (let i = 0; i < handles.length; i += 100) {
      const batch = handles.slice(i, i + 100);
      try {
        const userRes = await this.api(
          `/2/users/by?usernames=${batch.join(",")}&user.fields=name,username,profile_image_url`,
        );
        for (const u of (userRes?.data ?? []) as any[]) {
          const acct = accounts.find(
            (a) => a.handle.replace(/^@/, "").toLowerCase() === String(u.username).toLowerCase(),
          );
          try {
            const tw = await this.api(
              `/2/users/${u.id}/tweets?max_results=5&exclude=retweets,replies&tweet.fields=created_at&expansions=attachments.media_keys&media.fields=url,preview_image_url`,
            );
            const media = new Map<string, string>();
            for (const m of (tw?.includes?.media ?? []) as any[]) {
              media.set(m.media_key, m.url ?? m.preview_image_url ?? "");
            }
            for (const t of (tw?.data ?? []) as any[]) {
              const text = String(t.text ?? "");
              if (!text.trim()) continue;
              const key = t.attachments?.media_keys?.[0];
              items.push({
                source: this.source,
                sourceId: `x:${t.id}`,
                kind: "SOCIAL",
                title: text,
                summary: null,
                imageUrl: key ? (media.get(key) ?? null) : null,
                url: `https://x.com/${u.username}/status/${t.id}`,
                author: u.name,
                handle: `@${u.username}`,
                platform: "X",
                category: null,
                publishedAt: t.created_at ?? null,
                chamber: acct?.chamber ?? null,
                initiativeCodes: extractCodes(text),
                raw: {
                  payload: t,
                  provenance: { api: "X API v2", account: `@${u.username}` },
                },
              });
            }
          } catch (err) {
            gaps.push(`feed-x · @${u.username}: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        gaps.push(`feed-x · lote ${i / 100 + 1}: ${(err as Error).message}`);
      }
    }
    return { items, gaps };
  }

  private async api(path: string): Promise<any> {
    // X API v2 (Basic tier) rate-limits the user-timeline endpoint hard. Retry
    // 429s honoring the reset header (up to ~2 short waits) before giving up, and
    // give clear messages for auth/tier problems so the gap is actionable.
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://api.twitter.com${path}`, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      if (res.ok) return res.json();
      if (res.status === 429 && attempt < 2) {
        const reset = Number(res.headers.get("x-rate-limit-reset")) * 1000;
        const waitMs = Math.min(Math.max(reset - Date.now(), 1000), 60_000) || 5000;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      if (res.status === 401)
        throw new Error("401 token inválido o vencido (revisa X_BEARER_TOKEN)");
      if (res.status === 402)
        throw new Error("402 se requieren créditos de X API (cuenta pay-per-use sin saldo)");
      if (res.status === 403)
        throw new Error("403 acceso denegado — el plan de la app de X no cubre este endpoint");
      if (res.status === 429) throw new Error("429 límite de tasa de X agotado (reintentar luego)");
      throw new Error(`X API ${res.status} ${res.statusText}`);
    }
  }
}

/** Instagram adapter stub — Meta Graph API requires business accounts + app review. */
export class InstagramSocialAdapter {
  readonly source = "feed-instagram";
  readonly kind: FeedKind = "SOCIAL";
  async collect(_accounts: SocialAccount[]): Promise<{ items: RawFeedItem[]; gaps: string[] }> {
    return {
      items: [],
      gaps: ["feed-instagram · requiere Meta Graph API (cuentas business) — modo directorio."],
    };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
