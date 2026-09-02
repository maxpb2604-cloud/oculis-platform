"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowsClockwise, CaretDown } from "@phosphor-icons/react";
import { type Lang } from "@/lib/i18n";
import { feedSourceLabel } from "@/lib/source-labels";

interface SourceStatus {
  source: string;
  label: string;
  outcome: "RUNNING" | "COMPLETE" | "PARTIAL" | "FAILED" | null;
  seen: number;
  finishedAt: string | null;
  lastSuccessAt: string | null;
}

/** Human "hace X" / "X ago" from an ISO timestamp. */
function ago(iso: string | null, es: boolean): string {
  if (!iso) return es ? "nunca" : "never";
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1) return es ? "hace unos segundos" : "just now";
  if (mins < 60) return es ? `hace ${mins} min` : `${mins}m ago`;
  if (hrs < 24) return es ? `hace ${hrs} h` : `${hrs}h ago`;
  return es ? `hace ${days} d` : `${days}d ago`;
}

/**
 * Shows only stored execution facts for the registered feed sources. Refresh re-reads
 * the database; it does not run a collector.
 */
export function FeedFreshness({
  lang,
  newestSuccessAt,
  sources,
}: {
  lang: Lang;
  newestSuccessAt: string | null;
  sources: SourceStatus[];
}) {
  const es = lang === "es";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  // Re-render every 60s so the relative time stays current without a reload.
  const [, setTick] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={boxRef} className="relative flex items-center justify-between gap-3 border-y py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: "var(--accent)" }}
          aria-hidden
        />
        <span style={{ color: "var(--text-muted)" }}>
          {newestSuccessAt ? (
            <>
              <span className="sm:hidden">{es ? "Actualizada" : "Updated"}</span>
              <span className="hidden sm:inline">
                {es ? "Información actualizada" : "Information updated"}
              </span>{" "}
              <strong style={{ color: "var(--text)", fontWeight: 600 }}>
                {ago(newestSuccessAt, es)}
              </strong>
            </>
          ) : es ? (
            "Las fuentes todavía no tienen una actualización completa registrada"
          ) : (
            "No feed source has a recorded complete run"
          )}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="feed-source-status"
          className="rounded px-1.5 text-[12px] underline-offset-2 hover:underline"
          style={{ color: "var(--text-muted)", cursor: "pointer" }}
        >
          <span className="inline-flex items-center gap-1">
            {es ? `${sources.length} fuentes` : `${sources.length} sources`}
            <CaretDown size={12} aria-hidden />
          </span>
        </button>
      </div>

      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors hover:bg-[var(--surface-2)]"
        style={{
          border: "1px solid var(--border)",
          color: "var(--text)",
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        <ArrowsClockwise size={15} className={pending ? "animate-spin" : ""} aria-hidden />
        {pending ? (es ? "Recargando…" : "Refreshing…") : es ? "Recargar" : "Refresh"}
      </button>

      {open && (
        <div
          id="feed-source-status"
          className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-lg p-2 shadow-lg"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="eyebrow mb-1.5 px-1">{es ? "Estado de fuentes" : "Source status"}</div>
          <ul className="flex flex-col">
            {sources.map((s) => {
              const outcome = outcomeLabel(s.outcome, es);
              return (
                <li
                  key={s.source}
                  className="flex items-center justify-between gap-2 rounded px-1 py-1 text-[12px]"
                >
                  <span
                    className="flex items-center gap-1.5 truncate"
                    style={{ color: "var(--text)" }}
                  >
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: "var(--accent)" }}
                    />
                    <span className="truncate">{feedSourceLabel(s.source, lang, s.label)}</span>
                  </span>
                  <span className="shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {outcome}
                    {s.lastSuccessAt
                      ? ` · ${es ? "actualizada" : "updated"} ${ago(s.lastSuccessAt, es)}`
                      : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function outcomeLabel(outcome: SourceStatus["outcome"], es: boolean): string {
  if (outcome === "RUNNING") return es ? "Actualizando" : "Updating";
  if (outcome === "COMPLETE") return es ? "Disponible" : "Available";
  if (outcome === "PARTIAL") return es ? "Actualización parcial" : "Partially updated";
  if (outcome === "FAILED") return es ? "No disponible" : "Unavailable";
  return es ? "Sin actualización" : "Not updated";
}
