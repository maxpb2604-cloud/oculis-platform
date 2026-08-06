"use client";

import { useEffect, useState } from "react";

const TZ = "America/Santo_Domingo";

/**
 * Dominican Republic clock for the selected daily view. The clock describes the
 * current local time only; it does not imply that ingestion is streaming in real time.
 *
 * The time is rendered only after mount so the server and the client's first render
 * are identical. The date is seeded from `initialDate` to avoid a layout shift.
 */
export function LiveClock({ lang, initialDate }: { lang: "es" | "en"; initialDate: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: TZ,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(now)
    : "--:--:--";
  const [hh = "--", mm = "--", ss = "--"] = time.split(":");
  const date = now
    ? new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", {
        timeZone: TZ,
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(now)
    : initialDate;

  return (
    <div className="card elev flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex h-2.5 w-2.5 rounded-full"
            style={{ background: "var(--accent)" }}
            aria-hidden
          />
          <span className="eyebrow" style={{ color: "var(--accent)" }}>
            {lang === "es" ? "VISTA DIARIA" : "DAILY VIEW"}
          </span>
          <span className="eyebrow">· {lang === "es" ? "Hora RD" : "DR time"}</span>
        </div>
        <div className="serif mt-2 text-2xl font-semibold leading-tight first-letter:uppercase sm:text-[30px]">
          {date}
        </div>
      </div>

      <div
        className="font-mono text-5xl font-bold leading-none tracking-tight tabular-nums sm:text-6xl"
        style={{ color: "var(--text)" }}
        aria-label={`Hora ${time}`}
      >
        {hh}
        <span style={{ color: "var(--text-muted)" }}>:</span>
        {mm}
        <span style={{ color: "var(--danger)" }}>:{ss}</span>
      </div>
    </div>
  );
}
