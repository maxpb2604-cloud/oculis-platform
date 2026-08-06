"use client";

/**
 * Oculis Auribus date-range picker — a "Personalizar período" button that opens a popover
 * calendar (month nav + click-to-select range + hover preview) plus quick presets.
 * On apply it navigates to the page with ?from=&to= so the server filters the feed to
 * that window. Native to the Oculis Auribus design tokens; no external date/UI dependencies.
 */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { langParam, langQuery } from "@/lib/i18n";

const DR_TZ = "America/Santo_Domingo";
const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const todayInDR = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: DR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export function RangePicker({
  initialFrom,
  initialTo,
  lang,
  basePath = "/hoy",
}: {
  initialFrom?: string | null;
  initialTo?: string | null;
  lang: "es" | "en";
  basePath?: string;
}) {
  const router = useRouter();
  const es = lang === "es";
  const locale = es ? "es-DO" : "en-US";
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<string | null>(initialFrom ?? null);
  const [end, setEnd] = useState<string | null>(initialTo ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState<Date>(() =>
    startOfMonth(fromISO(initialFrom ?? todayInDR())),
  );
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const monthLabelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const todayISO = todayInDR();

  const grid = useMemo(() => {
    const first = startOfMonth(view);
    const offset = (first.getDay() + 6) % 7; // Monday-first
    const gridStart = addDays(first, -offset);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [view]);
  const fullDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
    [locale],
  );

  function pickDay(iso: string) {
    if (!start || (start && end)) {
      setStart(iso);
      setEnd(null);
    } else if (fromISO(iso) >= fromISO(start)) {
      setEnd(iso);
    } else {
      setEnd(start);
      setStart(iso);
    }
  }

  // Effective range for highlighting (handles the "selecting second date" hover preview).
  const lo = start && end ? start : start && hover ? (hover < start ? hover : start) : start;
  const hi = start && end ? end : start && hover ? (hover < start ? start : hover) : start;
  const inRange = (iso: string) => !!(lo && hi && iso >= lo && iso <= hi);

  const apply = (f: string, t: string) => {
    setOpen(false);
    router.push(`${basePath}?from=${f}&to=${t}${langParam(lang)}`);
  };
  const applySelection = () => {
    if (!start) return;
    apply(start, end ?? start);
  };
  const clearRange = () => {
    setOpen(false);
    router.push(`${basePath}${langQuery(lang)}`);
  };

  const presets: { label: string; from: string; to: string }[] = (() => {
    const t = todayInDR();
    const now = fromISO(t);
    return [
      { label: es ? "Hoy" : "Today", from: t, to: t },
      { label: es ? "Ayer" : "Yesterday", from: toISO(addDays(now, -1)), to: toISO(addDays(now, -1)) },
      { label: es ? "Últimos 7 días" : "Last 7 days", from: toISO(addDays(now, -6)), to: t },
      { label: es ? "Últimos 30 días" : "Last 30 days", from: toISO(addDays(now, -29)), to: t },
      { label: es ? "Este mes" : "This month", from: toISO(startOfMonth(now)), to: t },
    ];
  })();

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(fromISO(iso));
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(view);
  const weekdays = es ? ["L", "M", "M", "J", "V", "S", "D"] : ["M", "T", "W", "T", "F", "S", "S"];
  const hasActive = !!(initialFrom && initialTo);

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={dialogId}
        className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]"
        style={{ cursor: "pointer", color: hasActive ? "var(--accent)" : "var(--text)", borderColor: hasActive ? "var(--accent)" : "var(--border)" }}
      >
        <CalIcon />
        {hasActive ? `${fmt(initialFrom!)} – ${fmt(initialTo!)}` : es ? "Personalizar período" : "Custom range"}
        <ChevronDown open={open} />
      </button>

      {open && (
        <div
          id={dialogId}
          role="dialog"
          aria-labelledby={monthLabelId}
          className="absolute right-0 top-11 z-30 w-[min(300px,calc(100vw-2rem))] rounded-xl border p-3 shadow-xl sm:left-0 sm:right-auto"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          {/* Quick presets */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                type="button"
                key={p.label}
                onClick={() => apply(p.from, p.to)}
                className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors hover:bg-[var(--accent-soft)]"
                style={{ cursor: "pointer", background: "var(--surface-2)", color: "var(--text-muted)" }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Month header */}
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => setView(addMonths(view, -1))} aria-label={es ? "Mes anterior" : "Previous month"}
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--surface-2)]" style={{ cursor: "pointer" }}>
              <Chevron dir="left" />
            </button>
            <span id={monthLabelId} className="text-sm font-semibold first-letter:uppercase">{monthLabel}</span>
            <button type="button" onClick={() => setView(addMonths(view, 1))} aria-label={es ? "Mes siguiente" : "Next month"}
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-[var(--surface-2)]" style={{ cursor: "pointer" }}>
              <Chevron dir="right" />
            </button>
          </div>

          {/* Weekday row */}
          <div className="mb-1 grid grid-cols-7 text-center text-[10px] font-semibold uppercase" style={{ color: "var(--text-muted)" }}>
            {weekdays.map((w, i) => (
              <div key={i} aria-hidden="true">{w}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5" onMouseLeave={() => setHover(null)}>
            {grid.map((d) => {
              const iso = toISO(d);
              const inMonth = d.getMonth() === view.getMonth();
              const isEdge = iso === start || iso === end;
              const within = inRange(iso);
              const isToday = iso === todayISO;
              const accessibleDate = fullDateFormatter.format(d);
              return (
                <button
                  type="button"
                  key={iso}
                  onClick={() => pickDay(iso)}
                  onMouseEnter={() => setHover(iso)}
                  aria-label={accessibleDate}
                  aria-pressed={within}
                  aria-current={isToday ? "date" : undefined}
                  className="flex h-9 items-center justify-center text-[13px] transition-colors"
                  style={{
                    cursor: "pointer",
                    background: isEdge ? "var(--accent)" : within ? "var(--accent-soft)" : "transparent",
                    color: isEdge ? "#fff" : inMonth ? "var(--text)" : "var(--text-muted)",
                    borderRadius: isEdge ? 8 : within ? 0 : 8,
                    boxShadow: isToday && !isEdge ? "inset 0 0 0 1px var(--accent)" : "none",
                    opacity: inMonth ? 1 : 0.45,
                  }}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-3 flex items-center justify-between border-t pt-3" style={{ borderColor: "var(--border)" }}>
            <span className="text-[12px]" aria-live="polite" style={{ color: "var(--text-muted)" }}>
              {start ? (end ? `${fmt(start)} – ${fmt(end)}` : fmt(start)) : es ? "Selecciona un rango" : "Pick a range"}
            </span>
            <div className="flex items-center gap-2">
              {hasActive && (
                <button type="button" onClick={clearRange} className="text-[12px] font-medium underline" style={{ cursor: "pointer", color: "var(--text-muted)" }}>
                  {es ? "limpiar" : "clear"}
                </button>
              )}
              <button
                type="button"
                onClick={applySelection}
                disabled={!start}
                className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
                style={{ cursor: start ? "pointer" : "not-allowed", background: "var(--accent)" }}
              >
                {es ? "Aplicar" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CalIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}
function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transition: "transform .15s", transform: open ? "rotate(180deg)" : "none" }}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "left" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} />
    </svg>
  );
}
