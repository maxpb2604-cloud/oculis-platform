"use client";

/**
 * Committee "bubbles" for the Diputados / Senado pages. Each committee is one bubble
 * showing a brief of its recent agenda (last few days). Clicking opens a large modal
 * ("huge bubble") with the full agenda by day, statuses, initiatives and a members
 * section. Membership isn't in the open SIL feed yet, so that section is honestly
 * marked pending rather than faked.
 */
import { useEffect, useMemo, useState } from "react";
import { StatusChip, type ActivityItem } from "@/components/monitoring";

interface Group {
  name: string;
  meetings: ActivityItem[];
  count: number;
  latest: string | null;
  initiatives: number;
}

const fmtDM = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
const fmtFull = (iso: string | null, locale: string) =>
  iso ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso + "T12:00:00")) : "";

export function CommitteeBubbles({ items, lang, chamber }: { items: ActivityItem[]; lang: "es" | "en"; chamber: string }) {
  const es = lang === "es";
  const locale = es ? "es-DO" : "en-US";
  const [q, setQ] = useState("");
  const [openName, setOpenName] = useState<string | null>(null);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const it of items) {
      const name = (it.body || "—").trim();
      let arr = map.get(name);
      if (!arr) {
        arr = [];
        map.set(name, arr);
      }
      arr.push(it);
    }
    return [...map.entries()]
      .map(([name, arr]): Group => {
        const seen = new Set<string>();
        const meetings = arr
          .filter((it) => {
            const k = `${it.eventDate}|${it.description}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          })
          .sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""));
        return {
          name,
          meetings,
          count: meetings.length,
          latest: meetings[0]?.eventDate ?? null,
          initiatives: meetings.reduce((n, m) => n + m.initiativeCount, 0),
        };
      })
      .sort((a, b) => (b.latest ?? "").localeCompare(a.latest ?? "") || b.count - a.count);
  }, [items]);

  const ql = q.trim().toLowerCase();
  const filtered = ql ? groups.filter((g) => g.name.toLowerCase().includes(ql)) : groups;
  const open = openName ? groups.find((g) => g.name === openName) ?? null : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenName(null);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div>
      {/* Search committees */}
      <div className="relative max-w-md">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={es ? "Buscar comisión…" : "Search committee…"}
          className="w-full rounded-lg border bg-[var(--surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
          style={{ borderColor: "var(--border)" }}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="card mt-4 px-4 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          {ql ? (es ? "Sin comisiones que coincidan." : "No matching committees.") : (es ? "Sin actividad de comisiones." : "No committee activity.")}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((g) => (
            <button
              key={g.name}
              onClick={() => setOpenName(g.name)}
              className="card group flex flex-col gap-3 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ cursor: "pointer" }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold leading-snug">{g.name}</span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                  {g.count}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {g.meetings.slice(0, 3).map((m, i) => (
                  <div key={i} className="flex gap-2 text-[12px]">
                    <span className="tnum shrink-0 font-semibold" style={{ color: "var(--accent)" }}>{fmtDM(m.eventDate)}</span>
                    <span className="line-clamp-1" style={{ color: "var(--text-muted)" }}>{m.description || (es ? "(sin detalle)" : "(no detail)")}</span>
                  </div>
                ))}
              </div>
              <div className="mt-auto flex items-center justify-between pt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                <span>{g.initiatives > 0 ? `${g.initiatives} ${es ? "iniciativas" : "initiatives"}` : (es ? "agenda" : "agenda")}</span>
                <span className="font-semibold group-hover:underline" style={{ color: "var(--accent)" }}>{es ? "Ver más →" : "Read more →"}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* "Huge bubble" modal */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(8,12,18,0.5)", backdropFilter: "blur(3px)" }}
          onClick={() => setOpenName(null)}
        >
          <div
            className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border shadow-2xl"
            style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b px-6 py-4">
              <div className="min-w-0">
                <div className="eyebrow">{chamber} · {es ? "Comisión" : "Committee"}</div>
                <h3 className="serif mt-1 text-xl font-semibold leading-tight">{open.name}</h3>
                <div className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                  {open.count} {es ? "reuniones" : "meetings"} · {open.initiatives} {es ? "iniciativas" : "initiatives"}
                  {open.latest && ` · ${es ? "última" : "latest"} ${fmtFull(open.latest, locale)}`}
                </div>
              </div>
              <button onClick={() => setOpenName(null)} aria-label={es ? "Cerrar" : "Close"}
                className="shrink-0 rounded-full px-2 py-1 text-lg leading-none hover:bg-[var(--surface-2)]" style={{ cursor: "pointer" }}>
                ✕
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-4">
              <div className="eyebrow mb-3">{es ? "Agenda por día" : "Agenda by day"}</div>
              <div className="flex flex-col gap-4">
                {open.meetings.map((m, i) => (
                  <div key={i} className="border-l-2 pl-3" style={{ borderColor: "var(--accent)" }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{fmtFull(m.eventDate, locale)}</span>
                      {m.kind && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>· {m.kind}</span>}
                    </div>
                    {m.description && <p className="mt-1 text-[13px] leading-relaxed">{m.description}</p>}
                    {(m.statuses?.length ?? 0) > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">{m.statuses!.map((s, j) => <StatusChip key={j} raw={s} />)}</div>
                    )}
                    {m.agendaUrl && (
                      <a href={m.agendaUrl} target="_blank" rel="noreferrer"
                        className="mt-1.5 inline-block text-[11px] font-semibold underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
                        {es ? "Ver agenda ↗" : "View agenda ↗"}
                      </a>
                    )}
                  </div>
                ))}
              </div>

              <div className="eyebrow mb-2 mt-6">{es ? "Integrantes" : "Members"}</div>
              <div className="rounded-xl border border-dashed px-4 py-3 text-[12px]" style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}>
                {es
                  ? "La composición (presidente, vicepresidente, secretario y miembros) no se publica en el feed abierto de SIL; pendiente de integrar desde el portal oficial de la Cámara."
                  : "Membership (chair, vice-chair, secretary, members) is not exposed by the open SIL feed; pending integration from the Chamber's official portal."}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
