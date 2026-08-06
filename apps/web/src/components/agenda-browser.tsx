"use client";

/**
 * Searchable agenda view for the Diputados / Senado pages. Every stored official row is
 * retained; the UI only filters on the user's literal query and never collapses records
 * because their titles, dates, or committee names look similar.
 */
import { useMemo, useState } from "react";
import {
  ActivityInitiativeLinks,
  ProceduralMentionChip,
  ScopeChip,
  type ActivityItem,
} from "@/components/monitoring";
import { formatISODate } from "@/lib/format";
import { safeHttpUrl } from "@/lib/input";

export interface AgendaSection {
  key: string;
  title: string;
  items: ActivityItem[];
}

function rowTitle(item: ActivityItem, es: boolean): string {
  if (item.scope === "COMMITTEE") return item.body || (es ? "Comisión" : "Committee");
  if (item.scope === "ASAMBLEA") return es ? "Asamblea Nacional" : "National Assembly";
  return es ? "Orden del día — Pleno" : "Order of the day — Floor";
}

function AgendaRow({ item, es }: { item: ActivityItem; es: boolean }) {
  const statuses = item.statuses ?? [];
  const date = item.eventDate ? formatISODate(item.eventDate, es ? "es" : "en") : null;
  const agendaUrl = safeHttpUrl(item.agendaUrl);
  return (
    <div className="flex items-start gap-3 border-b px-4 py-3 last:border-0">
      <div className="pt-0.5">
        <ScopeChip scope={item.scope} lang={es ? "es" : "en"} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug">{rowTitle(item, es)}</div>
        <div
          className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"
          style={{ color: "var(--text-muted)" }}
        >
          {date && (
            <span className="tnum font-medium" style={{ color: "var(--text)" }}>
              {date}
            </span>
          )}
          {item.eventTime && (
            <span>
              · {es ? "Hora reportada" : "Reported time"}: {item.eventTime}
            </span>
          )}
          {item.kind && <span>· {item.kind}</span>}
          {item.initiativeCount > 0 && (
            <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-medium">
              {item.initiativeCount}{" "}
              {item.initiativeCount === 1
                ? es
                  ? "iniciativa"
                  : "initiative"
                : es
                  ? "iniciativas"
                  : "initiatives"}
            </span>
          )}
        </div>
        {statuses.length > 0 && (
          <div className="mt-1.5">
            <div
              className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
            >
              {es ? "Menciones procedimentales en la agenda" : "Procedural mentions in the agenda"}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {statuses.map((s, i) => (
                <ProceduralMentionChip key={i} raw={s} />
              ))}
            </div>
          </div>
        )}
        <ActivityInitiativeLinks initiatives={item.initiatives} lang={es ? "es" : "en"} />
      </div>
      {agendaUrl && (
        <a
          href={agendaUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 self-center rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors hover:bg-[var(--accent-soft)]"
          style={{ color: "var(--accent)", borderColor: "var(--accent)" }}
        >
          {es ? "Ver agenda" : "View agenda"}
        </a>
      )}
    </div>
  );
}

export function AgendaBrowser({
  sections,
  lang,
}: {
  sections: AgendaSection[];
  lang: "es" | "en";
}) {
  const es = lang === "es";
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();

  // Filter only. Source/database identity already handles exact idempotency.
  const prepared = useMemo(() => {
    const matches = (it: ActivityItem) =>
      !ql ||
      [
        it.body,
        it.description,
        it.kind,
        it.eventDate,
        rowTitle(it, es),
        ...(it.statuses ?? []),
      ].some((v) =>
        String(v ?? "")
          .toLowerCase()
          .includes(ql),
      );
    return sections.map((s) => {
      return { ...s, items: s.items.filter(matches) };
    });
  }, [sections, ql, es]);

  return (
    <div>
      {/* Search */}
      <div className="relative max-w-md">
        <label htmlFor="agenda-search" className="eyebrow mb-1.5 block">
          {es ? "Buscar agenda" : "Search agenda"}
        </label>
        <input
          id="agenda-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            es ? "Buscar comisión, fecha o estado…" : "Search committee, date or status…"
          }
          className="w-full rounded-lg border bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          style={{ borderColor: "var(--border)" }}
        />
      </div>

      <div className={`mt-4 grid grid-cols-1 gap-5 ${prepared.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {prepared.map((s) => (
          <div key={s.key} className="card overflow-hidden p-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">{s.title}</span>
              <span
                className="tnum text-[12px] font-semibold"
                style={{ color: "var(--text-muted)" }}
              >
                {s.items.length}
              </span>
            </div>
            {s.items.length === 0 ? (
              <div
                role="status"
                className="px-4 py-8 text-center text-sm"
                style={{ color: "var(--text-muted)" }}
              >
                {ql
                  ? es
                    ? "Sin coincidencias para la búsqueda."
                    : "No matches for your search."
                  : es
                    ? "Sin actividad reciente."
                    : "No recent activity."}
              </div>
            ) : (
              s.items.map((it) => <AgendaRow key={it.id} item={it} es={es} />)
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
