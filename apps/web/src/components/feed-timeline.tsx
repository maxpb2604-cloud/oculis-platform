"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang } from "@/lib/i18n";
import type { FeedListItem, FeedCursor, FeedFilters } from "@/lib/data";
import { FeedCard } from "@/components/feed-card";

/** Center column: the chronological feed with keyset pagination + infinite scroll. */
export function FeedTimeline({
  lang,
  initial,
  nextCursor,
  filters,
}: {
  lang: Lang;
  initial: FeedListItem[];
  nextCursor: FeedCursor | null;
  filters: FeedFilters;
}) {
  const es = lang === "es";
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);

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
        items.map((it) => <FeedCard key={`${it.source}-${it.id}`} item={it} lang={lang} />)
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
