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
import { type Lang } from "@/lib/i18n";

/**
 * Shared "search a bill by keyword" overlay — the same command-palette experience
 * used by /feed and /iniciativas. A big autofocus input queries the smart keyword
 * engine (/api/feed/bills — Spanish FTS + synonyms + typo tolerance) and lists the
 * FULL matching set with room to read each bill's complete title, code, chamber and
 * status. Picking a result calls `onPick(option)`; the page decides what that does
 * (feed → filter to the bill; iniciativas → open the bill's bubble).
 */

export interface BillOption {
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

export function Kbd({ children }: { children: React.ReactNode }) {
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

export function BillSearchOverlay({
  lang,
  open,
  onClose,
  onPick,
  /** Per-row secondary "Ver iniciativa" button (feed uses it; iniciativas opens on row click). */
  showViewButton = true,
  /** Keyboard-hint verb for the primary action. */
  actionVerb = "filter",
}: {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  onPick: (opt: BillOption) => void;
  showViewButton?: boolean;
  actionVerb?: "filter" | "open";
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
    (opt: BillOption) => {
      onClose();
      onPick(opt);
    },
    [onClose, onPick],
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
        pick(o);
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
  const actionLabel =
    actionVerb === "open" ? (es ? "abrir" : "open") : es ? "filtrar" : "filter";

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
            aria-controls="bill-search-list"
            aria-activedescendant={shown[active] ? `bill-search-opt-${active}` : undefined}
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
          id="bill-search-list"
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
                id={`bill-search-opt-${idx}`}
                role="option"
                aria-selected={isActive}
                onMouseMove={() => setActive(idx)}
                onClick={(e) => {
                  // A click on the "ver iniciativa" affordance opens the bubble via the
                  // global data-initiative-id host — don't also run the primary action.
                  if ((e.target as HTMLElement).closest("[data-initiative-id]")) return;
                  pick(o);
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
                  {showViewButton && (
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
                  )}
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
            {actionLabel}
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
