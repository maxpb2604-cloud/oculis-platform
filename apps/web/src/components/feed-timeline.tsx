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
  if (!d) return "not-reported";
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
  if (!d) return lang === "es" ? "No informado" : "Not reported";
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
    <div className="flex items-center gap-3 border-b pb-2 pt-6 first:pt-0">
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
    <div className="flex gap-3 border-b py-5" aria-hidden>
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
  const [loadError, setLoadError] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const cursorRef = useRef(nextCursor);
  const loadingRef = useRef(false);
  const requestRef = useRef<AbortController | null>(null);
  const yesterday = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  // Server re-renders on filter navigation → reset the list.
  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    loadingRef.current = false;
    cursorRef.current = nextCursor;
    setItems(initial);
    setCursor(nextCursor);
    setLoading(false);
    setLoadError(false);
  }, [initial, nextCursor]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const loadMore = useCallback(async () => {
    const currentCursor = cursorRef.current;
    if (!currentCursor || loadingRef.current) return;

    loadingRef.current = true;
    setLoading(true);
    setLoadError(false);

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, String(value));
    }
    params.set("cursorAt", currentCursor.sortAt);
    params.set("cursorId", String(currentCursor.id));

    const ctrl = new AbortController();
    requestRef.current?.abort();
    requestRef.current = ctrl;

    try {
      const response = await fetch(`/api/feed?${params.toString()}`, { signal: ctrl.signal });
      if (!response.ok) throw new Error(`Feed request failed with ${response.status}`);

      const data = (await response.json()) as {
        items?: FeedListItem[];
        nextCursor?: FeedCursor | null;
      };
      const incoming = Array.isArray(data.items) ? data.items : [];
      setItems((previous) => {
        const seen = new Set(previous.map((item) => `${item.source}:${item.id}`));
        const unique = incoming.filter((item) => {
          const key = `${item.source}:${item.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        return unique.length ? [...previous, ...unique] : previous;
      });

      const followingCursor = data.nextCursor ?? null;
      cursorRef.current = followingCursor;
      setCursor(followingCursor);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setLoadError(true);
    } finally {
      if (requestRef.current === ctrl) {
        requestRef.current = null;
        loadingRef.current = false;
        setLoading(false);
      }
    }
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
    <div className="flex flex-col">
      {items.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-xl border p-10 text-center text-sm"
          role="status"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="serif text-base font-semibold" style={{ color: "var(--text)" }}>
            {hasFilters
              ? es
                ? "Sin publicaciones para estos filtros"
                : "No posts match these filters"
              : es
                ? "Esta conexión todavía no contiene publicaciones"
                : "This connection does not contain posts yet"}
          </span>
          <span className="max-w-md text-[13px]">
            {hasFilters
              ? es
                ? "Prueba otra combinación o limpia los filtros para volver al feed completo."
                : "Try another combination or clear the filters to return to the complete feed."
              : es
                ? "Las publicaciones aparecerán cuando las fuentes seleccionadas informen una actualización."
                : "Posts will appear when the selected sources report an update."}
          </span>
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
            const displayTime = it.publishedAt ?? it.observedAt;
            const k = dayKey(displayTime);
            if (k !== lastDay) {
              lastDay = k;
              out.push(
                <DayDivider
                  key={`day-${k}-${it.id}`}
                  label={dayHeading(displayTime, lang, today, yesterday)}
                />,
              );
            }
            out.push(<FeedCard key={`${it.source}-${it.id}`} item={it} lang={lang} />);
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
      {loadError && (
        <div
          className="mt-4 flex items-center justify-between gap-3 rounded-lg border p-3 text-sm"
          role="alert"
        >
          <span style={{ color: "var(--danger)" }}>
            {es ? "No se pudieron cargar más publicaciones." : "More posts could not be loaded."}
          </span>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold"
          >
            {es ? "Reintentar" : "Try again"}
          </button>
        </div>
      )}
      {cursor && !loading && !loadError && (
        <div ref={sentinel} className="py-4 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
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
