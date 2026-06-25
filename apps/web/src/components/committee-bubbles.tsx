"use client";

/**
 * Committee "bubbles" for the Diputados / Senado pages. Each committee is one bubble
 * showing a brief of its recent agenda (last few days). Clicking opens a large modal
 * ("huge bubble") with the full agenda by day, statuses, initiatives and — when the
 * roster has been ingested — the committee's real composition (president, vice-president,
 * secretary and members), matched from the `commission_members` table by committee name.
 */
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { StatusChip, type ActivityItem } from "@/components/monitoring";
import { formatISODayMonth } from "@/lib/format";
import type { CommissionWithMembers } from "@/lib/data";

interface Group {
  name: string;
  meetings: ActivityItem[];
  count: number;
  latest: string | null;
  initiatives: number;
}

const fmtFull = (iso: string | null, locale: string) =>
  iso ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso + "T12:00:00")) : "";

const CARGO_COLOR: Record<string, string> = {
  Presidente: "var(--risk-bajo)",
  Vicepresidente: "var(--accent)",
  Secretario: "var(--accent)",
};
const CARGO_SOFT: Record<string, string> = {
  Presidente: "var(--risk-bajo-soft)",
  Vicepresidente: "var(--accent-soft)",
  Secretario: "var(--accent-soft)",
};

/** Normalize a committee name for fuzzy matching between the agenda feed and the roster. */
const normCommittee = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\bcomision(es)?\b|\bpermanente\b|\bespecial\b|\bbicameral\b|\bde\b|\bla\b|\bdel\b|\by\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function CommitteeBubbles({
  items,
  lang,
  chamber,
  members,
}: {
  items: ActivityItem[];
  lang: "es" | "en";
  chamber: string;
  members?: CommissionWithMembers[];
}) {
  const es = lang === "es";
  const locale = es ? "es-DO" : "en-US";
  const [q, setQ] = useState("");
  const [openName, setOpenName] = useState<string | null>(null);

  // Index roster membership by normalized committee name for matching against agenda bodies.
  const membersByName = useMemo(() => {
    const m = new Map<string, CommissionWithMembers>();
    for (const c of members ?? []) m.set(normCommittee(c.name), c);
    return m;
  }, [members]);
  const findMembers = (name: string): CommissionWithMembers | null => {
    const key = normCommittee(name);
    if (membersByName.has(key)) return membersByName.get(key)!;
    // fall back to a contains-match (agenda often uses a short name)
    for (const [k, v] of membersByName) {
      if (k && (k.includes(key) || key.includes(k))) return v;
    }
    return null;
  };

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

  // Lock body scroll while the modal is open. Escape / focus-trap come from <Modal>.
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => {
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
                {g.meetings.slice(0, 3).map((m) => (
                  <div key={m.id} className="flex gap-2 text-[12px]">
                    <span className="tnum shrink-0 font-semibold" style={{ color: "var(--accent)" }}>{formatISODayMonth(m.eventDate, lang)}</span>
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
        <Modal
          open
          onClose={() => setOpenName(null)}
          labelledBy="committee-modal-title"
          className="relative flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border shadow-2xl"
          panelStyle={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <div className="flex max-h-[85vh] flex-col">
            <div className="flex items-start justify-between gap-3 border-b px-6 py-4">
              <div className="min-w-0">
                <div className="eyebrow">{chamber} · {es ? "Comisión" : "Committee"}</div>
                <h3 id="committee-modal-title" className="serif mt-1 text-xl font-semibold leading-tight">{open.name}</h3>
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
                {open.meetings.map((m) => (
                  <div key={m.id} className="border-l-2 pl-3" style={{ borderColor: "var(--accent)" }}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{fmtFull(m.eventDate, locale)}</span>
                      {m.kind && <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>· {m.kind}</span>}
                    </div>
                    {m.description && <p className="mt-1 text-[13px] leading-relaxed">{m.description}</p>}
                    {(m.statuses?.length ?? 0) > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">{m.statuses!.map((s, j) => <StatusChip key={`${m.id}-${j}`} raw={s} />)}</div>
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

              <CommitteeMembers committee={findMembers(open.name)} es={es} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Real committee composition (from the roster), or an honest note if not yet ingested. */
function CommitteeMembers({ committee, es }: { committee: CommissionWithMembers | null; es: boolean }) {
  return (
    <>
      <div className="eyebrow mb-2 mt-6">{es ? "Integrantes" : "Members"}{committee ? ` · ${committee.members.length}` : ""}</div>
      {committee && committee.members.length > 0 ? (
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {committee.members.map((m, i) => (
            <li key={`${m.name}-${m.cargo ?? ""}-${i}`} className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-[12.5px]" style={{ background: "var(--surface-2)" }}>
              <span className="min-w-0 truncate">{m.name}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {m.party && <span className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>{m.party}</span>}
                {m.cargo && m.cargo !== "Miembro" && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: CARGO_SOFT[m.cargo] ?? "var(--surface-2)", color: CARGO_COLOR[m.cargo] ?? "var(--text-muted)" }}>
                    {m.cargo}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed px-4 py-3 text-[12px]" style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}>
          {es
            ? "Composición no disponible para esta comisión. Ejecuta la ingesta del roster (npm run roster) para integrarla."
            : "Membership not available for this committee. Run the roster ingestion (npm run roster) to integrate it."}
        </div>
      )}
    </>
  );
}
