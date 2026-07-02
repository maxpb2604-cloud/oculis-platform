"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { type Lang } from "@/lib/i18n";

interface SourceStatus {
  source: string;
  label: string;
  ok: boolean | null;
  seen: number;
  finishedAt: string | null;
  lastSuccessAt: string | null;
}

/** Human "hace X" / "X ago" from an ISO timestamp. `now` is null before mount. */
function ago(iso: string | null, es: boolean, now: number | null): string {
  if (now === null) return "…"; // stable SSR/hydration placeholder
  if (!iso) return es ? "nunca" : "never";
  const secs = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  if (mins < 1) return es ? "hace unos segundos" : "just now";
  if (mins < 60) return es ? `hace ${mins} min` : `${mins}m ago`;
  if (hrs < 24) return es ? `hace ${hrs} h` : `${hrs}h ago`;
  return es ? `hace ${days} d` : `${days}d ago`;
}

/**
 * Slim "última actualización" bar: shows how fresh the feed data is, a per-source
 * status popover, and a refresh that re-reads the latest data from the DB (the
 * scrapers run on a schedule; this reloads what they've ingested).
 */
export function FeedFreshness({
  lang,
  updatedAt,
  sources,
}: {
  lang: Lang;
  updatedAt: string | null;
  sources: SourceStatus[];
}) {
  const es = lang === "es";
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  // "now" is only known on the client: null during SSR/hydration (stable
  // placeholder), then set on mount and refreshed every 60s so the relative
  // time stays current without a reload — and without hydration mismatches.
  const [now, setNow] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const anyDown = sources.some((s) => s.ok === false);
  const stale = updatedAt ? now !== null && now - new Date(updatedAt).getTime() > 12 * 3600_000 : true;
  // Neutral dot until mounted — the status depends on the client clock.
  const dot =
    now === null ? "var(--border)" : anyDown ? "#e0654d" : stale ? "#d9a441" : "#3fb950";

  return (
    <div
      ref={boxRef}
      className="card relative flex items-center justify-between gap-3 px-3 py-2"
    >
      <div className="flex items-center gap-2 text-[13px]">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ background: dot }}
          aria-hidden
        />
        <span style={{ color: "var(--text-muted)" }}>
          {es ? "Actualizado" : "Updated"}{" "}
          <strong style={{ color: "var(--text)", fontWeight: 600 }}>
            {ago(updatedAt, es, now)}
          </strong>
        </span>
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded px-1.5 text-[12px] underline-offset-2 hover:underline"
          style={{ color: "var(--text-muted)", cursor: "pointer" }}
        >
          {es ? `${sources.length} fuentes` : `${sources.length} sources`}
        </button>
      </div>

      <button
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors hover:bg-[var(--surface-2)]"
        style={{
          border: "1px solid var(--border)",
          color: "var(--text)",
          cursor: pending ? "default" : "pointer",
          opacity: pending ? 0.6 : 1,
        }}
      >
        <span className={pending ? "animate-spin" : ""} aria-hidden>
          ↻
        </span>
        {pending ? (es ? "Actualizando…" : "Refreshing…") : es ? "Actualizar" : "Refresh"}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-lg p-2 shadow-lg"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="eyebrow mb-1.5 px-1">{es ? "Estado de fuentes" : "Source status"}</div>
          <ul className="flex flex-col">
            {sources.map((s) => {
              const c = s.ok === false ? "#e0654d" : s.ok ? "#3fb950" : "#d9a441";
              return (
                <li
                  key={s.source}
                  className="flex items-center justify-between gap-2 rounded px-1 py-1 text-[12px]"
                >
                  <span className="flex items-center gap-1.5 truncate" style={{ color: "var(--text)" }}>
                    <span
                      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: c }}
                    />
                    <span className="truncate">{s.label}</span>
                  </span>
                  <span className="shrink-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {s.seen} · {ago(s.lastSuccessAt, es, now)}
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
