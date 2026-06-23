"use client";

/**
 * Searchable, de-duplicated agenda view for the Diputados / Senado pages. Replaces the
 * flat repetitive list: each session/committee shows once, as a clean row with a single
 * "Ver agenda" button (the source PDF) — no repeated description spam. A live search box
 * filters across committee name, date, kind and reading statuses.
 */
import { useMemo, useState } from "react";
import { ScopeChip, StatusChip, type ActivityItem } from "@/components/monitoring";

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
  const date = item.eventDate
    ? `${item.eventDate.slice(8, 10)}/${item.eventDate.slice(5, 7)}/${item.eventDate.slice(0, 4)}`
    : null;
  return (
    <div className="flex items-start gap-3 border-b px-4 py-3 last:border-0">
      <div className="pt-0.5"><ScopeChip scope={item.scope} /></div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug">{rowTitle(item, es)}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          {date && <span className="tnum font-medium" style={{ color: "var(--text)" }}>{date}</span>}
          {item.kind && <span>· {item.kind}</span>}
          {item.initiativeCount > 0 && (
            <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-medium">
              {item.initiativeCount} {item.initiativeCount === 1 ? (es ? "iniciativa" : "initiative") : (es ? "iniciativas" : "initiatives")}
            </span>
          )}
        </div>
        {statuses.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {statuses.map((s, i) => <StatusChip key={i} raw={s} />)}
          </div>
        )}
      </div>
      {item.agendaUrl && (
        <a href={item.agendaUrl} target="_blank" rel="noreferrer"
          className="shrink-0 self-center rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-colors hover:bg-[var(--accent-soft)]"
          style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>
          {es ? "Ver agenda ↗" : "View agenda ↗"}
        </a>
      )}
    </div>
  );
}

export function AgendaBrowser({ sections, lang }: { sections: AgendaSection[]; lang: "es" | "en" }) {
  const es = lang === "es";
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();

  // De-duplicate (same body + date + kind appears once) then filter by the query.
  const prepared = useMemo(() => {
    const matches = (it: ActivityItem) =>
      !ql ||
      [it.body, it.description, it.kind, it.eventDate, rowTitle(it, es), ...(it.statuses ?? [])]
        .some((v) => String(v ?? "").toLowerCase().includes(ql));
    return sections.map((s) => {
      const seen = new Set<string>();
      const items: ActivityItem[] = [];
      for (const it of s.items) {
        const k = `${it.body}|${it.eventDate}|${it.kind}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (matches(it)) items.push(it);
      }
      return { ...s, items };
    });
  }, [sections, ql, es]);

  return (
    <div>
      {/* Search */}
      <div className="relative max-w-md">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={es ? "Buscar comisión, fecha o estado…" : "Search committee, date or status…"}
          className="w-full rounded-lg border bg-[var(--surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
          style={{ borderColor: "var(--border)" }}
        />
      </div>

      <div className={`mt-4 grid grid-cols-1 gap-5 ${prepared.length > 1 ? "lg:grid-cols-2" : ""}`}>
        {prepared.map((s) => (
          <div key={s.key} className="card overflow-hidden p-0">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold">{s.title}</span>
              <span className="tnum text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>{s.items.length}</span>
            </div>
            {s.items.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
                {ql ? (es ? "Sin coincidencias para la búsqueda." : "No matches for your search.") : (es ? "Sin actividad reciente." : "No recent activity.")}
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
