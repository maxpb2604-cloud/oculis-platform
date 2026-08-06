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
import type { RawFeedItem } from "@oculis/scrapers";

export async function buildLegislativeSignals(
  db: Database,
  opts: { sinceDays?: number } = {},
): Promise<RawFeedItem[]> {
  const sinceDays = opts.sinceDays ?? 14;
  const fromDate = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10);
  const items: RawFeedItem[] = [];

  // 1. Recent deposits. A filing date is date-only, so it stays in the factual
  // summary instead of being converted into an invented publication timestamp.
  const deposits = await listRecentInitiatives(db, { limit: 60, dateFrom: fromDate });
  for (const d of deposits) {
    items.push({
      source: "feed-legislative",
      sourceId: `deposit:${d.id}`,
      kind: "LEGISLATIVE",
      title: `Iniciativa: ${d.title}`,
      summary:
        [d.code, d.filedAt ? `Fecha de depósito: ${d.filedAt}` : null, d.status]
          .filter(Boolean)
          .join(" · ") || null,
      imageUrl: null,
      url: d.sourceUrl ?? null,
      author: d.sponsor ?? null,
      handle: null,
      platform: "WEB",
      category: null,
      publishedAt: null,
      chamber: d.chamber,
      initiativeCodes: d.code ? [d.code] : [],
      raw: {
        payload: d,
        provenance: { process: "feed-legislative", evidence: "initiative row" },
      },
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
      title: `${scopeLabel}: ${a.body ?? a.description}`,
      summary:
        [a.eventDate ? `Fecha oficial: ${a.eventDate}` : null, a.description]
          .filter(Boolean)
          .join(" · ") || null,
      imageUrl: null,
      url: a.agendaUrl ?? null,
      author: null,
      handle: null,
      platform: "WEB",
      category: null,
      publishedAt: null,
      chamber: a.chamber ?? null,
      initiativeCodes: a.initiatives.map((initiative) => initiative.code),
      raw: {
        payload: a,
        provenance: { process: "feed-legislative", evidence: "activity event" },
      },
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
      summary:
        [
          s.code,
          s.status,
          s.eventDate ? `Fecha oficial: ${s.eventDate}` : `Observado por Oculis: ${s.observedAt}`,
        ]
          .filter(Boolean)
          .join(" · ") || null,
      imageUrl: null,
      url: s.sourceUrl,
      author: null,
      handle: null,
      platform: "WEB",
      category: null,
      publishedAt: null,
      chamber: s.chamber ?? null,
      initiativeCodes: s.code ? [s.code] : [],
      raw: {
        payload: s,
        provenance: {
          process: "feed-legislative",
          evidence: s.evidenceType,
          source: s.source,
          sourceUrl: s.sourceUrl,
          observedAt: s.observedAt,
        },
      },
    });
  }

  return items;
}
