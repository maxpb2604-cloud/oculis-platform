"use client";

import { type Lang } from "@/lib/i18n";
import { openFeedSearch, SearchIcon } from "@/components/feed-search-overlay";

/**
 * Compact secondary entry point in the left filter column. It no longer holds an
 * inline typeahead — the real search lives in the big top-of-feed bar + overlay
 * (feed-search-overlay.tsx). This button just opens that overlay so the search is
 * reachable from the filters too.
 */
export function FeedBillSearch({ lang }: { lang: Lang }) {
  const es = lang === "es";
  return (
    <div className="card p-3">
      <div className="eyebrow mb-2">{es ? "Buscar iniciativa" : "Search a bill"}</div>
      <button
        onClick={() => openFeedSearch()}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-[var(--surface-2)]"
        style={{
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          color: "var(--text-muted)",
          cursor: "pointer",
        }}
      >
        <SearchIcon size={14} style={{ flexShrink: 0 }} />
        <span>{es ? "Palabra clave…" : "Keyword…"}</span>
      </button>
    </div>
  );
}
