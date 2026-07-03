"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { type Lang } from "@/lib/i18n";
import { BillSearchOverlay, Kbd, SearchIcon, type BillOption } from "@/components/bill-search-overlay";

/**
 * Top-of-feed search: the big prominent bar + the shared BillSearchOverlay it opens.
 * Picking a result filters the whole feed to that bill via the `initiativeCode` query
 * param. A second entry point (the compact button in the left filter column,
 * feed-bill-search.tsx) opens the same overlay via `openFeedSearch()`.
 */

export { SearchIcon };

const OPEN_EVENT = "oculis:feed-search-open";

/** Open the feed search overlay from anywhere on the page (e.g. the filter button). */
export function openFeedSearch() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_EVENT));
}

export function FeedSearch({ lang, activeLabel }: { lang: Lang; activeLabel?: string }) {
  const es = lang === "es";
  const router = useRouter();
  const sp = useSearchParams();
  const [open, setOpen] = useState(false);

  // Same URL-patching semantics as the left filter column: any interaction exits
  // the standalone "directory" view, and picking a bill clears sibling entity filters.
  const navigate = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(sp.toString());
      p.delete("view");
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") p.delete(k);
        else p.set(k, v);
      }
      const qs = p.toString();
      router.push(`/feed${qs ? `?${qs}` : ""}`);
    },
    [router, sp],
  );

  const select = useCallback(
    (opt: BillOption) => {
      navigate({ initiativeCode: opt.code, legislatorSourceId: null, commissionName: null });
    },
    [navigate],
  );

  const clear = useCallback(() => {
    navigate({ initiativeCode: null, legislatorSourceId: null, commissionName: null });
  }, [navigate]);

  // Listen for the global open event (from the compact filter-column button).
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  // "/" opens the search from anywhere on the page (unless typing in a field).
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const placeholder = es ? "Buscar iniciativa por palabra clave…" : "Search a bill by keyword…";

  return (
    <>
      <div className="flex items-stretch gap-2">
        <button
          onClick={() => setOpen(true)}
          aria-label={es ? "Abrir buscador de iniciativas" : "Open bill search"}
          className="group flex min-w-0 flex-1 items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors sm:px-5 sm:py-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", cursor: "pointer" }}
        >
          <SearchIcon
            size={20}
            style={{ color: activeLabel ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 }}
          />
          <span
            className="min-w-0 flex-1 truncate text-[15px] sm:text-base"
            style={{ color: activeLabel ? "var(--text)" : "var(--text-muted)", fontWeight: activeLabel ? 600 : 400 }}
          >
            {activeLabel ?? placeholder}
          </span>
          {!activeLabel && (
            <span className="hidden shrink-0 items-center gap-1 sm:flex">
              <Kbd>/</Kbd>
            </span>
          )}
        </button>
        {activeLabel && (
          <button
            onClick={clear}
            aria-label={es ? "Quitar filtro" : "Clear filter"}
            className="flex shrink-0 items-center justify-center rounded-2xl px-4 text-lg transition-colors hover:bg-[var(--surface-2)]"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer" }}
          >
            ✕
          </button>
        )}
      </div>
      <BillSearchOverlay
        lang={lang}
        open={open}
        onClose={() => setOpen(false)}
        onPick={select}
        showViewButton
        actionVerb="filter"
      />
    </>
  );
}
