"use client";

import { useEffect, useState } from "react";
import { CalendarBlank, Clock } from "@phosphor-icons/react";

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
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const time = now
    ? new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", {
        timeZone: TZ,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(now)
    : "--:--";
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3">
      <div className="flex min-w-0 items-center gap-3">
        <CalendarBlank size={22} style={{ color: "var(--accent)" }} aria-hidden />
        <div className="min-w-0">
          <span className="eyebrow block">{lang === "es" ? "Fecha actual" : "Current date"}</span>
          <span className="serif block truncate text-lg font-semibold first-letter:uppercase">
            {date}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
        <Clock size={18} aria-hidden />
        <span>{lang === "es" ? "Hora de República Dominicana" : "Dominican Republic time"}</span>
        <strong
          className="tnum text-base"
          style={{ color: "var(--text)" }}
          aria-label={`${lang === "es" ? "Hora" : "Time"} ${time}`}
        >
          {time}
        </strong>
      </div>
    </div>
  );
}
