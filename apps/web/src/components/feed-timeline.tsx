"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang } from "@/lib/i18n";
import type { FeedListItem, FeedCursor, FeedFilters } from "@/lib/data";
import { FeedCard } from "@/components/feed-card";

const DR_TZ = "America/Santo_Domingo";

/** Parse an ISO/timestamp string to a Date, treating naive timestamps as UTC. */
function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  let s = iso.replace(" ", "T");
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(s)) s += "Z";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** Day bucket key (YYYY-MM-DD in DR time) for grouping the feed by day. */
function dayKey(iso: string | null): string {
  const d = toDate(iso);
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
/** Readable divider label: "Hoy" / "Ayer" (once mounted) else the full date. */
function dayHeading(
  iso: string | null,
  lang: Lang,
  today: string | null,
  yest: string | null,
): string {
  const k = dayKey(iso);
  if (today && k === today) return lang === "es" ? "Hoy" : "Today";
  if (yest && k === yest) return lang === "es" ? "Ayer" : "Yesterday";
  const d = toDate(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", {
    timeZone: DR_TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(d);
}

/** Small day separator between cards. */
function DayDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 px-1 pb-0.5 pt-1.5 first:pt-0">
      <span className="eyebrow shrink-0" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span className="h-px flex-1" style={{ background: "var(--border)" }} />
    </div>
  );
}

/** Center column: the chronological feed with keyset pagination + infinite scroll. */
export function FeedTimeline({
  lang,
  initial,
  nextCursor,
  filters,
  today,
}: {
  lang: Lang;
  initial: FeedListItem[];
  nextCursor: FeedCursor | null;
  filters: FeedFilters;
  today: string; // DR today (YYYY-MM-DD) from the server — deterministic, hydration-safe
}) {
  const es = lang === "es";
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const yesterday = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  // Server re-renders on filter navigation → reset the list.
  useEffect(() => {
    setItems(initial);
    setCursor(nextCursor);
  }, [initial, nextCursor]);

  const loadMore = useCallback(async () => {
    setCursor((cur) => {
      if (!cur) return cur;
      setLoading(true);
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) if (v) p.set(k, String(v));
      if (cur.publishedAt) p.set("cursorAt", cur.publishedAt);
      p.set("cursorId", String(cur.id));
      fetch(`/api/feed?${p.toString()}`)
        .then((r) => r.json())
        .then((data) => {
          setItems((prev) => [...prev, ...(data.items ?? [])]);
          setCursor(data.nextCursor ?? null);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
      return cur;
    });
  }, [filters]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loading) loadMore();
      },
      { rootMargin: "500px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore, loading]);

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <div
          className="card p-10 text-center text-sm"
          role="status"
          style={{ color: "var(--text-muted)" }}
        >
          {es ? "Sin publicaciones para estos filtros." : "No posts for these filters."}
        </div>
      ) : (
        (() => {
          const out: React.ReactNode[] = [];
          let lastDay: string | null = null;
          for (const it of items) {
            const k = dayKey(it.publishedAt);
            if (k !== lastDay) {
              lastDay = k;
              out.push(
                <DayDivider
                  key={`day-${k}-${it.id}`}
                  label={dayHeading(it.publishedAt, lang, today, yesterday)}
                />,
              );
            }
            out.push(<FeedCard key={`${it.source}-${it.id}`} item={it} lang={lang} />);
          }
          return out;
        })()
      )}
      {cursor && (
        <div ref={sentinel} className="py-4 text-center">
          <button
            onClick={loadMore}
            disabled={loading}
            className="rounded-lg border px-4 py-2 text-sm transition-colors hover:bg-[var(--surface-2)]"
            style={{ cursor: "pointer", color: "var(--text-muted)" }}
          >
            {loading ? (es ? "Cargando…" : "Loading…") : es ? "Cargar más" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
