"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { type Lang } from "@/lib/i18n";

/**
 * Flagship initiative search for /feed. A big, prominent bar at the top of the
 * feed opens a large overlay (command-palette style) where a keyword search
 * lists the FULL set of matching PDL (proyectos de ley) with room to read each
 * bill's complete title, code, chamber and status. Picking a result filters the
 * whole feed to that bill via the `initiativeCode` query param.
 *
 * Entry points: the big top bar rendered here, plus a compact button in the left
 * filter column (see feed-bill-search.tsx) that dispatches `openFeedSearch()`.
 */

const OPEN_EVENT = "oculis:feed-search-open";

/** Open the feed search overlay from anywhere on the page (e.g. the filter button). */
export function openFeedSearch() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_EVENT));
}

interface BillOption {
  id: number;
  code: string;
  title: string;
  status: string | null;
  chamber: string | null;
}

const MAX_RESULTS = 40;

export function SearchIcon({
  size = 18,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex min-w-[1.4em] items-center justify-center rounded px-1 py-0.5 text-[10px] font-medium not-italic"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        color: "var(--text-muted)",
        fontFamily: "var(--font-mono)",
      }}
    >
      {children}
    </kbd>
  );
}

/**
 * Top-of-feed hero: the big search bar + the overlay it opens. When a bill filter
 * is active the bar shows that bill's name as its value (with a ✕ to clear) so the
 * most prominent element on the page always reflects the current filter.
 */
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
    (code: string) => {
      navigate({ initiativeCode: code, legislatorSourceId: null, commissionName: null });
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
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            cursor: "pointer",
          }}
        >
          <SearchIcon
            size={20}
            style={{ color: activeLabel ? "var(--accent)" : "var(--text-muted)", flexShrink: 0 }}
          />
          <span
            className="min-w-0 flex-1 truncate text-[15px] sm:text-base"
            style={{
              color: activeLabel ? "var(--text)" : "var(--text-muted)",
              fontWeight: activeLabel ? 600 : 400,
            }}
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
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        )}
      </div>
      <FeedSearchOverlay lang={lang} open={open} onClose={() => setOpen(false)} onSelect={select} />
    </>
  );
}

function FeedSearchOverlay({
  lang,
  open,
  onClose,
  onSelect,
}: {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  onSelect: (code: string) => void;
}) {
  const es = lang === "es";
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<BillOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false); // a real query (≥2 chars) has been issued
  const [active, setActive] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const pressStartedOnBackdrop = useRef(false);

  const shown = useMemo(() => options.slice(0, MAX_RESULTS), [options]);

  // Reset transient state whenever the overlay closes so it opens fresh.
  useEffect(() => {
    if (open) return;
    setQuery("");
    setOptions([]);
    setLoading(false);
    setSearched(false);
    setActive(0);
  }, [open]);

  // On open: remember opener, focus the input, lock body scroll; restore on close.
  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.();
    };
  }, [open]);

  // Debounced search with abort-on-supersede (a slow earlier response must never
  // clobber a newer keystroke's results / loading state).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setOptions([]);
      setLoading(false);
      setSearched(false);
      return;
    }
    setLoading(true);
    setSearched(true);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/feed/bills?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        const data = await res.json();
        if (ctrl.signal.aborted) return; // superseded by a newer keystroke
        setOptions(data.items ?? []);
        setActive(0);
        setLoading(false);
      } catch {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, open]);

  // Keep the keyboard-active row scrolled into view.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = useCallback(
    (code: string) => {
      onClose();
      onSelect(code);
    },
    [onClose, onSelect],
  );

  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (shown.length) setActive((i) => (i + 1) % shown.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (shown.length) setActive((i) => (i - 1 + shown.length) % shown.length);
      return;
    }
    if (e.key === "Enter") {
      const o = shown[active];
      if (o) {
        e.preventDefault();
        pick(o.code);
      }
      return;
    }
    if (e.key === "Tab") {
      const panel = panelRef.current;
      if (!panel) return;
      const f = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const chamberLabel = (c: string | null) =>
    c === "SENADO"
      ? es
        ? "Senado"
        : "Senate"
      : c === "DIPUTADOS"
        ? es
          ? "Diputados"
          : "Deputies"
        : c;

  if (!open) return null;

  const trimmed = query.trim();
  const showPrompt = trimmed.length < 2;
  const showSkeleton = !showPrompt && loading && shown.length === 0;
  const showEmpty = !showPrompt && !loading && searched && shown.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col sm:items-center sm:justify-start sm:px-4 sm:pt-[7vh]"
      style={{ background: "var(--modal-overlay)", backdropFilter: "blur(2px)" }}
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressStartedOnBackdrop.current) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={es ? "Buscar iniciativa" : "Search a bill"}
        onKeyDown={onPanelKeyDown}
        className="elev flex h-[100dvh] w-full flex-col overflow-hidden sm:h-auto sm:max-h-[85vh] sm:max-w-3xl sm:rounded-2xl"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        {/* Big input row */}
        <div
          className="flex items-center gap-3 px-4 py-3.5 sm:px-5 sm:py-4"
          style={{ borderBottom: "1px solid var(--border)" }}
        >
          <SearchIcon size={22} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={es ? "Escribe una palabra clave…" : "Type a keyword…"}
            aria-label={es ? "Buscar iniciativa" : "Search a bill"}
            role="combobox"
            aria-expanded={shown.length > 0}
            aria-controls="feed-search-list"
            aria-activedescendant={shown[active] ? `feed-search-opt-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            className="min-w-0 flex-1 bg-transparent text-lg outline-none sm:text-xl"
            style={{ color: "var(--text)" }}
          />
          <button
            onClick={onClose}
            aria-label={es ? "Cerrar" : "Close"}
            className="flex shrink-0 items-center justify-center rounded-lg p-1.5 text-lg transition-colors hover:bg-[var(--surface-2)]"
            style={{ color: "var(--text-muted)", cursor: "pointer" }}
          >
            ✕
          </button>
        </div>

        {/* Results */}
        <div
          id="feed-search-list"
          ref={listRef}
          role="listbox"
          aria-label={es ? "Resultados" : "Results"}
          className="flex-1 overflow-y-auto px-2 py-2 sm:px-3"
        >
          {showPrompt && (
            <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
              <SearchIcon size={30} style={{ color: "var(--border-strong)" }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {es
                  ? "Escribe al menos 2 letras para buscar iniciativas."
                  : "Type at least 2 letters to search bills."}
              </p>
            </div>
          )}

          {showSkeleton &&
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-2 rounded-xl px-3 py-4 sm:px-4">
                <div className="skeleton h-4 w-4/5 rounded" />
                <div className="skeleton h-3 w-1/3 rounded" />
              </div>
            ))}

          {showEmpty && (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                {es ? "Sin resultados para" : "No results for"} “{trimmed}”.
              </p>
            </div>
          )}

          {shown.map((o, idx) => {
            const isActive = idx === active;
            return (
              <div
                key={o.id}
                data-idx={idx}
                id={`feed-search-opt-${idx}`}
                role="option"
                aria-selected={isActive}
                onMouseMove={() => setActive(idx)}
                onClick={(e) => {
                  // Clicks on the "ver iniciativa" affordance open the bubble (via the
                  // global data-initiative-id host) instead of filtering the feed.
                  if ((e.target as HTMLElement).closest("[data-initiative-id]")) return;
                  pick(o.code);
                }}
                className="flex cursor-pointer flex-col gap-2 rounded-xl px-3 py-3.5 sm:px-4"
                style={{ background: isActive ? "var(--surface-2)" : "transparent" }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className="text-[15px] font-medium leading-snug sm:text-base"
                    style={{ color: "var(--text)" }}
                  >
                    {o.title}
                  </span>
                  <button
                    data-initiative-id={o.id}
                    tabIndex={-1}
                    onClick={() => onClose()}
                    className="shrink-0 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--surface)]"
                    style={{
                      borderColor: "var(--border)",
                      color: "var(--accent)",
                      cursor: "pointer",
                    }}
                  >
                    {es ? "Ver iniciativa" : "View bill"}
                  </button>
                </div>
                <div
                  className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  <span style={{ fontFamily: "var(--font-mono)" }}>{o.code}</span>
                  {o.chamber && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{chamberLabel(o.chamber)}</span>
                    </>
                  )}
                  {o.status && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{o.status}</span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Keyboard hints (desktop) */}
        <div
          className="hidden items-center gap-4 px-5 py-2.5 text-[11px] sm:flex"
          style={{ borderTop: "1px solid var(--border)", color: "var(--text-muted)" }}
        >
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            {es ? "navegar" : "navigate"}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            {es ? "filtrar" : "filter"}
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>esc</Kbd>
            {es ? "cerrar" : "close"}
          </span>
          {shown.length > 0 && (
            <span className="ml-auto tnum">
              {shown.length}
              {options.length > MAX_RESULTS ? "+" : ""} {es ? "resultados" : "results"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
