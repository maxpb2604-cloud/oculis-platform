/**
 * Feed scrapers — the news/social twin of the regulatory adapters.
 *
 * Three kinds of source feed the Congress timeline, all link-back-able and verifiable:
 *  - OFFICIAL: Senado + Cámara de Diputados news (their WordPress RSS).
 *  - NEWS: respected DR papers' RSS, keyword-filtered for Congress/legislation.
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
  category: string | null; // tagged later by the worker
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

const strip = (s: string) =>
  s
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
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
function rssDateToIso(d: string | null): string | null {
  if (!d) return null;
  const ms = Date.parse(d);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  const iso = d.match(/(\d{4}-\d{2}-\d{2})/);
  return iso ? `${iso[1]}T00:00:00.000Z` : null;
}

export interface RichRssItem {
  title: string;
  link: string | null;
  publishedAt: string | null;
  summary: string | null;
  imageUrl: string | null;
  author: string | null;
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
    const summary =
      tagText(b, "description") ??
      tagText(b, "summary") ??
      (content ? strip(content).slice(0, 400) : null);
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
      guid: tagText(b, "guid") ?? link,
    };
  });
}

/** Keep only items that actually concern Congress / legislation (for general press feeds). */
export const CONGRESS_RE =
  /\b(congreso|senad[oa]|senador|diputad|c[áa]mara\s+(de\s+)?diputad|legislaci|legislativ|ley(es)?|proyecto\s+de\s+ley|resoluci[óo]n|comisi[óo]n|pleno|bicameral|reglamento)\b/i;

export interface RssAdapterOpts {
  source: string;
  kind: FeedKind;
  feeds: string[];
  chamber?: string | null;
  category?: string | null;
  keywordFilter?: RegExp | null; // null = keep all (used for official sources)
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
    for (const feed of this.opts.feeds) {
      try {
        const rss = await readRichRss(feed);
        let kept = 0;
        for (const r of rss) {
          if (!r.title) continue;
          const text = `${r.title} ${r.summary ?? ""}`;
          if (this.opts.keywordFilter && !this.opts.keywordFilter.test(text)) continue;
          const sourceId = r.guid ?? r.link ?? r.title;
          if (seen.has(sourceId)) continue;
          seen.add(sourceId);
          kept++;
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
            raw: r,
          });
        }
        if (rss.length === 0) {
          gaps.push(`${this.source} · ${feed}: 0 ítems (verificar la URL del feed RSS).`);
        } else if (this.opts.keywordFilter && kept === 0) {
          gaps.push(`${this.source} · ${feed}: ${rss.length} ítems, ninguno sobre el Congreso.`);
        }
      } catch (err) {
        gaps.push(`${this.source} · ${feed}: ${(err as Error).message}`);
      }
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
      feeds: ["https://camaradediputados.gob.do/feed/", "https://www.diputadosrd.gob.do/feed/"],
    }),
  ];
}

/** Respected DR press — keyword-filtered to Congress/legislation to cut noise. */
export function pressFeedAdapters(): FeedAdapter[] {
  const k = CONGRESS_RE;
  return [
    new RssFeedAdapter({
      source: "feed-diariolibre",
      kind: "NEWS",
      keywordFilter: k,
      feeds: [
        "https://www.diariolibre.com/rss/portada.xml",
        "https://www.diariolibre.com/rss/actualidad.xml",
      ],
    }),
    new RssFeedAdapter({
      source: "feed-listin",
      kind: "NEWS",
      keywordFilter: k,
      feeds: ["https://listindiario.com/rss/lo-ultimo/", "https://listindiario.com/feed/"],
    }),
    new RssFeedAdapter({
      source: "feed-acento",
      kind: "NEWS",
      keywordFilter: k,
      feeds: ["https://acento.com.do/politica/feed/", "https://acento.com.do/feed/"],
    }),
    new RssFeedAdapter({
      source: "feed-elnacional",
      kind: "NEWS",
      keywordFilter: k,
      feeds: ["https://elnacional.com.do/feed/"],
    }),
    new RssFeedAdapter({
      source: "feed-hoy",
      kind: "NEWS",
      keywordFilter: k,
      feeds: ["https://hoy.com.do/feed/"],
    }),
    new RssFeedAdapter({
      source: "feed-elcaribe",
      kind: "NEWS",
      keywordFilter: k,
      feeds: ["https://www.elcaribe.com.do/feed/"],
    }),
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
              const key = t.attachments?.media_keys?.[0];
              items.push({
                source: this.source,
                sourceId: `x:${t.id}`,
                kind: "SOCIAL",
                title: text.split("\n")[0]!.slice(0, 160) || `Publicación de ${u.name}`,
                summary: text,
                imageUrl: key ? (media.get(key) ?? null) : null,
                url: `https://x.com/${u.username}/status/${t.id}`,
                author: u.name,
                handle: `@${u.username}`,
                platform: "X",
                category: null,
                publishedAt: t.created_at ?? null,
                chamber: acct?.chamber ?? null,
                initiativeCodes: extractCodes(text),
                raw: t,
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
    const res = await fetch(`https://api.twitter.com${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) throw new Error(`X API ${res.status} ${res.statusText}`);
    return res.json();
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
