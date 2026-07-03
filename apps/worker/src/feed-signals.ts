/**
 * Legislative-signal feed cards — the "before the news" edge. Turns data the platform
 * already holds (recent deposits, committee/plenary agenda, status changes) into feed
 * items. Lives in the worker (not the pure scrapers) because it reads the DB.
 *
 * Deterministic sourceIds (`deposit:<id>`, `activity:<id>`, `status:<id>`) keep these
 * idempotent through `upsertFeedItem`.
 */
import {
  listActivity,
  listRecentInitiatives,
  listRecentStatusEvents,
  type Database,
} from "@oculis/db";
import { extractCodes, type RawFeedItem } from "@oculis/scrapers";

export async function buildLegislativeSignals(
  db: Database,
  opts: { sinceDays?: number } = {},
): Promise<RawFeedItem[]> {
  const sinceDays = opts.sinceDays ?? 14;
  const fromDate = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const items: RawFeedItem[] = [];

  // 1. Recent deposits → "Nueva iniciativa" — same sinceDays window the other two
  // signal types respect. listRecentInitiatives only sorts by filed_at, so filter
  // here: keep deposits filed within the window (filedAt is a yyyy-mm-dd string;
  // rows without one can't be dated and are skipped — otherwise a historical
  // backfill floods the feed with up to 60 ancient "new initiative" cards).
  const deposits = (await listRecentInitiatives(db, { limit: 60 })).filter(
    (d) => d.filedAt !== null && d.filedAt >= fromDate,
  );
  for (const d of deposits) {
    items.push({
      source: "feed-legislative",
      sourceId: `deposit:${d.id}`,
      kind: "LEGISLATIVE",
      title: `Nueva iniciativa: ${d.title}`,
      summary: [d.code, d.category, d.status].filter(Boolean).join(" · ") || null,
      imageUrl: null,
      url: d.sourceUrl ?? null,
      author: d.sponsor ?? null,
      handle: null,
      platform: "WEB",
      category: d.category ?? null,
      publishedAt: d.filedAt ? `${d.filedAt}T08:00:00.000Z` : null,
      chamber: null,
      initiativeCodes: d.code ? [d.code] : [],
      raw: d,
    });
  }

  // 2. Recent committee / plenary agenda activity
  const activity = await listActivity(db, { dateFrom: fromDate, limit: 80 });
  for (const a of activity) {
    const scopeLabel =
      a.scope === "COMMITTEE" ? "Comisión" : a.scope === "PLENARY" ? "Pleno" : "Asamblea";
    items.push({
      source: "feed-legislative",
      sourceId: `activity:${a.id}`,
      kind: "LEGISLATIVE",
      title: `${scopeLabel}: ${a.body ?? a.description.slice(0, 80)}`,
      summary: a.description,
      imageUrl: null,
      url: a.agendaUrl ?? null,
      author: null,
      handle: null,
      platform: "WEB",
      category: null,
      publishedAt: a.eventDate ? `${a.eventDate}T09:00:00.000Z` : null,
      chamber: a.chamber ?? null,
      initiativeCodes: extractCodes(a.description),
      raw: a,
    });
  }

  // 3. Recent status changes → "<iniciativa> → <estado>"
  const statuses = await listRecentStatusEvents(db, { sinceDays, limit: 80 });
  for (const s of statuses) {
    items.push({
      source: "feed-legislative",
      sourceId: `status:${s.id}`,
      kind: "LEGISLATIVE",
      title: `${s.title} → ${s.status}`,
      summary: [s.code, s.status].filter(Boolean).join(" · ") || null,
      imageUrl: null,
      url: null,
      author: null,
      handle: null,
      platform: "WEB",
      category: s.category ?? null,
      publishedAt: s.createdAt ?? (s.eventDate ? `${s.eventDate}T10:00:00.000Z` : null),
      chamber: s.chamber ?? null,
      initiativeCodes: s.code ? [s.code] : [],
      raw: s,
    });
  }

  return items;
}
