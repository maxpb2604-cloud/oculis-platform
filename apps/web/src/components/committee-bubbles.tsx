"use client";

/**
 * Committee "bubbles" for the Diputados / Senado pages. Each committee is one bubble
 * showing a brief of its recent agenda (last few days). Clicking opens a large modal
 * ("huge bubble") with the full agenda by day, statuses, initiatives and — when the
 * roster has been ingested — the committee's real composition (president, vice-president,
 * secretary and members), matched from the `commission_members` table by committee name.
 */
import { useMemo, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { Modal } from "@/components/ui/modal";
import {
  ActivityDestinationLink,
  ActivityInitiativeLinks,
  ProceduralMentionChip,
  type ActivityItem,
} from "@/components/monitoring";
import { formatISODayMonth, formatOfficialTime } from "@/lib/format";
import type { CommissionWithMembers } from "@/lib/data";
import { partyColor, partyDisplayLabel } from "@/lib/party-presentation";
import { LegislatorProfileTrigger } from "@/components/legislator-profile-provider";

interface Group {
  name: string;
  meetings: ActivityItem[];
  count: number;
  latest: string | null;
  initiatives: number;
}

const fmtFull = (iso: string | null, locale: string) =>
  iso
    ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
        new Date(iso + "T12:00:00"),
      )
    : locale.startsWith("es")
      ? "No informado"
      : "Not reported";

const CARGO_COLOR: Record<string, string> = {
  Presidente: "var(--verified)",
  Vicepresidente: "var(--accent)",
  Secretario: "var(--accent)",
};
const CARGO_SOFT: Record<string, string> = {
  Presidente: "var(--verified-soft)",
  Vicepresidente: "var(--accent-soft)",
  Secretario: "var(--accent-soft)",
};

/** Canonicalize spelling only; attribution still requires exact normalized equality. */
const normCommittee = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function CommitteeBubbles({
  items,
  lang,
  chamber,
  members,
  showMembers = true,
}: {
  items: ActivityItem[];
  lang: "es" | "en";
  chamber: string;
  members?: CommissionWithMembers[];
  /** Institution pages can omit rosters; /congreso keeps the complete membership view. */
  showMembers?: boolean;
}) {
  const es = lang === "es";
  const locale = es ? "es-DO" : "en-US";
  const [q, setQ] = useState("");
  const [openName, setOpenName] = useState<string | null>(null);

  // Index roster membership by normalized committee name for matching against agenda bodies.
  const membersByName = useMemo(() => {
    const m = new Map<string, CommissionWithMembers | null>();
    for (const c of members ?? []) {
      const key = normCommittee(c.name);
      m.set(key, m.has(key) ? null : c);
    }
    return m;
  }, [members]);
  const findMembers = (name: string): CommissionWithMembers | null => {
    const key = normCommittee(name);
    return membersByName.get(key) ?? null;
  };

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const it of items) {
      const name = (it.body || (es ? "No informado" : "Not reported")).trim();
      let arr = map.get(name);
      if (!arr) {
        arr = [];
        map.set(name, arr);
      }
      arr.push(it);
    }
    return [...map.entries()]
      .map(([name, arr]): Group => {
        const meetings = [...arr].sort((a, b) =>
          (b.eventDate ?? "").localeCompare(a.eventDate ?? ""),
        );
        return {
          name,
          meetings,
          count: meetings.length,
          latest: meetings[0]?.eventDate ?? null,
          initiatives: meetings.reduce((n, m) => n + m.initiativeCount, 0),
        };
      })
      .sort((a, b) => (b.latest ?? "").localeCompare(a.latest ?? "") || b.count - a.count);
  }, [es, items]);

  const ql = q.trim().toLowerCase();
  const filtered = ql ? groups.filter((g) => g.name.toLowerCase().includes(ql)) : groups;
  const open = openName ? (groups.find((g) => g.name === openName) ?? null) : null;

  return (
    <div>
      {/* Search committees */}
      <div className="relative max-w-md">
        <label htmlFor="committee-search" className="sr-only">
          {es ? "Buscar comisión" : "Search committee"}
        </label>
        <MagnifyingGlass
          size={17}
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: "var(--text-muted)" }}
        />
        <input
          id="committee-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={es ? "Buscar comisión…" : "Search committee…"}
          className="w-full rounded-lg border bg-[var(--surface)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
          style={{ borderColor: "var(--border)" }}
        />
      </div>

      {filtered.length === 0 ? (
        <div
          className="card mt-4 px-4 py-8 text-center text-sm"
          style={{ color: "var(--text-muted)" }}
        >
          {ql
            ? es
              ? "Sin comisiones que coincidan."
              : "No matching committees."
            : es
              ? "Sin actividad de comisiones."
              : "No committee activity."}
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((g) => (
            <button
              type="button"
              key={g.name}
              onClick={() => setOpenName(g.name)}
              className="card group flex flex-col gap-3 rounded-2xl p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ cursor: "pointer" }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold leading-snug">{g.name}</span>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                  style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                >
                  {g.count}
                </span>
              </div>
              <div className="flex flex-col gap-1.5">
                {g.meetings.slice(0, 3).map((m) => (
                  <div key={m.id} className="flex gap-2 text-[12px]">
                    <span
                      className="tnum shrink-0 font-semibold"
                      style={{ color: "var(--accent)" }}
                    >
                      {formatISODayMonth(m.eventDate, lang)}
                    </span>
                    <span className="line-clamp-1" style={{ color: "var(--text-muted)" }}>
                      {m.description || (es ? "(sin detalle)" : "(no detail)")}
                    </span>
                  </div>
                ))}
              </div>
              <div
                className="mt-auto flex items-center justify-between pt-1 text-[11px]"
                style={{ color: "var(--text-muted)" }}
              >
                <span>
                  {g.initiatives > 0
                    ? `${g.initiatives} ${es ? "iniciativas" : "initiatives"}`
                    : `${g.count} ${es ? "reuniones" : "meetings"}`}
                </span>
                <span
                  className="font-semibold group-hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {es ? "Ver reuniones" : "View meetings"}
                </span>
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
                <div className="eyebrow">
                  {chamber} · {es ? "Comisión" : "Committee"}
                </div>
                <h3
                  id="committee-modal-title"
                  className="serif mt-1 text-xl font-semibold leading-tight"
                >
                  {open.name}
                </h3>
                <div className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
                  {open.count} {es ? "reuniones" : "meetings"} · {open.initiatives}{" "}
                  {es ? "iniciativas" : "initiatives"}
                  {open.latest && ` · ${es ? "última" : "latest"} ${fmtFull(open.latest, locale)}`}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpenName(null)}
                aria-label={es ? "Cerrar" : "Close"}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold hover:bg-[var(--surface-2)]"
                style={{ cursor: "pointer" }}
              >
                {es ? "Cerrar" : "Close"}
              </button>
            </div>

            <div className="overflow-y-auto px-6 py-4">
              <div className="eyebrow mb-3">{es ? "Agenda por día" : "Agenda by day"}</div>
              <div className="flex flex-col gap-4">
                {open.meetings.map((m) => (
                  <div
                    key={m.id}
                    className="border-l-2 pl-3"
                    style={{ borderColor: "var(--accent)" }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{fmtFull(m.eventDate, locale)}</span>
                      {m.kind && (
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          · {m.kind}
                        </span>
                      )}
                      {m.eventTime && (
                        <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          · {es ? "Hora reportada" : "Reported time"}:{" "}
                          {formatOfficialTime(m.eventTime, lang)}
                        </span>
                      )}
                    </div>
                    {m.description && (
                      <p className="mt-1 text-[13px] leading-relaxed">{m.description}</p>
                    )}
                    {(m.statuses?.length ?? 0) > 0 && (
                      <div className="mt-1.5">
                        <div
                          className="mb-1 text-[10px] font-semibold uppercase tracking-wide"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {es
                            ? "Menciones procedimentales en la agenda"
                            : "Procedural mentions in the agenda"}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {m.statuses!.map((s, j) => (
                            <ProceduralMentionChip key={`${m.id}-${j}`} raw={s} />
                          ))}
                        </div>
                      </div>
                    )}
                    <ActivityInitiativeLinks initiatives={m.initiatives} lang={es ? "es" : "en"} />
                    <ActivityDestinationLink
                      item={m}
                      lang={es ? "es" : "en"}
                      className="mt-1.5 inline-block text-[11px] font-semibold underline-offset-2 hover:underline"
                      style={{ color: "var(--accent)" }}
                    />
                  </div>
                ))}
              </div>

              {showMembers && <CommitteeMembers committee={findMembers(open.name)} lang={lang} />}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Real committee composition (from the roster), or an honest note if not yet ingested. */
function CommitteeMembers({
  committee,
  lang,
}: {
  committee: CommissionWithMembers | null;
  lang: "es" | "en";
}) {
  const es = lang === "es";
  return (
    <>
      <div className="eyebrow mb-2 mt-6">
        {es ? "Integrantes" : "Members"}
        {committee ? ` · ${committee.members.length}` : ""}
      </div>
      {committee && committee.members.length > 0 ? (
        <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {committee.members.map((m, i) => {
            const party = m.party ? partyDisplayLabel(m.party, null, lang) : null;
            const color = partyColor(m.party);
            return (
              <li
                key={`${m.name}-${m.cargo ?? ""}-${i}`}
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-[12.5px]"
                style={{ background: "var(--surface-2)" }}
              >
                <LegislatorProfileTrigger
                  profileId={m.profileId}
                  fullName={m.name}
                  chamber={committee.chamber}
                  party={m.party}
                  ariaLabel={
                    party
                      ? es
                        ? `Abrir perfil de ${m.name}, ${party}`
                        : `Open ${m.name}'s profile, ${party}`
                      : undefined
                  }
                  className="-ml-2 inline-flex min-h-11 min-w-0 items-center rounded-md px-2 text-left font-medium underline-offset-4 hover:text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  <span className="min-w-0 truncate">{m.name}</span>
                </LegislatorProfileTrigger>
                <span className="flex shrink-0 items-center gap-1.5">
                  {m.party && (
                    <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[var(--text-muted)]">
                      <span
                        aria-hidden="true"
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ background: color }}
                      />
                      {party}
                    </span>
                  )}
                  {m.cargo && m.cargo !== "Miembro" && (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{
                        background: CARGO_SOFT[m.cargo] ?? "var(--surface-2)",
                        color: CARGO_COLOR[m.cargo] ?? "var(--text-muted)",
                      }}
                    >
                      {m.cargo}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div
          className="rounded-xl border border-dashed px-4 py-3 text-[12px]"
          style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}
        >
          {es
            ? "Integrantes: No informado. No existe una coincidencia exacta con el nombre registrado por la fuente."
            : "Members: Not reported. There is no exact match with the source-recorded name."}
        </div>
      )}
    </>
  );
}
