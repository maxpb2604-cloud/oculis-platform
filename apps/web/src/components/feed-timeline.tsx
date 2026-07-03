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

/** Placeholder card shown while a page of items is being fetched. */
function SkeletonCard() {
  return (
    <div className="card flex gap-3 p-3.5" aria-hidden>
      <div className="hidden h-[84px] w-[112px] shrink-0 rounded-lg sm:block skeleton" />
      <div className="min-w-0 flex-1">
        <div className="mb-2 h-3 w-28 rounded skeleton" />
        <div className="mb-1.5 h-4 w-3/4 rounded skeleton" />
        <div className="h-3 w-full rounded skeleton" />
        <div className="mt-1 h-3 w-2/3 rounded skeleton" />
      </div>
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
  const hasFilters = Object.values(filters).some(Boolean);
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  // Request generation: bumped on every filter/data reset so a page fetched for
  // the PREVIOUS filter set is dropped instead of appended into the new list.
  const generation = useRef(0);
  // Prevents overlapping page loads (state `loading` lags behind by a render).
  const inFlight = useRef(false);
  const yesterday = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  // Server re-renders on filter navigation → reset the list.
  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    setItems(initial);
    setCursor(nextCursor);
    setLoading(false);
  }, [initial, nextCursor]);

  const loadMore = useCallback(async () => {
    if (!cursor || inFlight.current) return;
    inFlight.current = true;
    const gen = generation.current;
    setLoading(true);
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, String(v));
    if (cursor.publishedAt) p.set("cursorAt", cursor.publishedAt);
    p.set("cursorId", String(cursor.id));
    try {
      const res = await fetch(`/api/feed?${p.toString()}`);
      const data = await res.json();
      if (generation.current !== gen) return; // stale: filters changed mid-flight
      setItems((prev) => [...prev, ...(data.items ?? [])]);
      setCursor(data.nextCursor ?? null);
    } catch {
      /* network error — keep the current list; the sentinel allows a retry */
    } finally {
      if (generation.current === gen) {
        inFlight.current = false;
        setLoading(false);
      }
    }
  }, [cursor, filters]);

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
          className="card flex flex-col items-center gap-3 p-10 text-center text-sm"
          role="status"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="text-2xl" aria-hidden>
            🗞️
          </span>
          <span>{es ? "Sin publicaciones para estos filtros." : "No posts for these filters."}</span>
          {hasFilters && (
            <a
              href={es ? "/feed" : "/feed?lang=en"}
              className="rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text)" }}
            >
              {es ? "Quitar filtros" : "Clear filters"}
            </a>
          )}
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
            out.push(
              <FeedCard
                key={`${it.source}-${it.id}`}
                item={it}
                lang={lang}
                activeFilters={filters}
              />,
            );
          }
          return out;
        })()
      )}
      {loading && (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      )}
      {cursor && !loading && (
        <div ref={sentinel} className="py-4 text-center">
          <button
            onClick={loadMore}
            className="rounded-lg border px-4 py-2 text-sm transition-colors hover:bg-[var(--surface-2)]"
            style={{ cursor: "pointer", color: "var(--text-muted)" }}
          >
            {es ? "Cargar más" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
