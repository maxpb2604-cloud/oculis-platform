"use client";

/**
 * Searchable agenda view for the Diputados / Senado pages. Every stored official row is
 * retained; the UI only filters on the user's literal query and never collapses records
 * because their titles, dates, or committee names look similar.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, MagnifyingGlass } from "@phosphor-icons/react";
import {
  ActivityInitiativeLinks,
  ProceduralMentionChip,
  ScopeChip,
  type ActivityItem,
} from "@/components/monitoring";
import { formatISODate, formatOfficialTime } from "@/lib/format";

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

function agendaDetailHref(item: ActivityItem, es: boolean): string {
  const params = new URLSearchParams();
  if (!es) params.set("lang", "en");
  if (item.eventDate) params.set("date", item.eventDate);
  if (item.chamber === "SENADO") params.set("chamber", "senado");
  const query = params.toString();
  return `/agenda/${item.id}${query ? `?${query}` : ""}`;
}

function AgendaRow({ item, es }: { item: ActivityItem; es: boolean }) {
  const statuses = item.statuses ?? [];
  const date = item.eventDate ? formatISODate(item.eventDate, es ? "es" : "en") : null;
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
              · {es ? "Hora reportada" : "Reported time"}:{" "}
              {formatOfficialTime(item.eventTime, es ? "es" : "en")}
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
      <Link
        href={agendaDetailHref(item, es)}
        className="inline-flex min-h-11 shrink-0 self-center items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold transition-colors hover:bg-[var(--accent-soft)]"
        style={{ color: "var(--accent)", borderColor: "var(--accent)" }}
      >
        {es ? "Ver detalle" : "View details"}
        <ArrowRight size={14} aria-hidden />
      </Link>
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
        <MagnifyingGlass
          size={18}
          className="pointer-events-none absolute bottom-3 left-3"
          style={{ color: "var(--text-muted)" }}
          aria-hidden
        />
        <input
          id="agenda-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            es ? "Buscar comisión, fecha o estado…" : "Search committee, date or status…"
          }
          className="min-h-11 w-full rounded-lg border bg-[var(--surface)] py-2 pl-10 pr-3 text-sm outline-none focus:border-[var(--accent)]"
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
