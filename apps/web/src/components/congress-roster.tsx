"use client";

/**
 * Congresistas browser. A ChamberToggle (same control as the "Hoy" page) switches the
 * whole view between Senado and Diputados — each chamber is its own window. Within a
 * chamber there are two sub-views: "Legisladores" (grouped by province, filterable) and
 * "Comisiones" (each committee's composition). Clicking any legislator opens a profile
 * modal with their photo, bio, contact, committee seats and official profile link.
 */
import { useEffect, useMemo, useState } from "react";
import { ChamberToggle, type Chamber } from "@/components/ui/chamber-toggle";
import { Modal } from "@/components/ui/modal";
import type { LegislatorProfile, CommissionWithMembers } from "@/lib/data";

type Tab = "legisladores" | "comisiones";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Cargo accent colors, keyed to theme-aware CSS vars so they read in light + dark mode.
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

export function CongressRoster({
  legislators,
  commissions,
  parties,
  provinces,
  lang,
}: {
  legislators: LegislatorProfile[];
  commissions: CommissionWithMembers[];
  parties: string[];
  provinces: string[];
  lang: "es" | "en";
}) {
  const es = lang === "es";
  const [chamberSel, setChamberSel] = useState<Chamber>("senadores");
  const chamber = chamberSel === "senadores" ? "SENADO" : "DIPUTADOS";
  const [tab, setTab] = useState<Tab>("legisladores");
  const [province, setProvince] = useState<string>("ALL");
  const [party, setParty] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [profile, setProfile] = useState<LegislatorProfile | null>(null);

  // Lock body scroll while the profile modal is open (Escape / focus-trap come from <Modal>).
  useEffect(() => {
    if (!profile) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [profile]);

  const inChamber = useMemo(() => legislators.filter((l) => l.chamber === chamber), [legislators, chamber]);
  const chamberProvinces = useMemo(
    () => provinces.filter((p) => inChamber.some((l) => l.province === p)),
    [provinces, inChamber],
  );
  const chamberParties = useMemo(
    () => parties.filter((p) => inChamber.some((l) => l.partyShort === p)),
    [parties, inChamber],
  );

  const filtered = useMemo(() => {
    const needle = norm(q.trim());
    return inChamber.filter((l) => {
      if (province !== "ALL" && l.province !== province) return false;
      if (party !== "ALL" && l.partyShort !== party) return false;
      if (needle && !norm(l.fullName).includes(needle)) return false;
      return true;
    });
  }, [inChamber, province, party, q]);

  const groups = useMemo(() => {
    const map = new Map<string, LegislatorProfile[]>();
    for (const l of filtered) {
      const key = l.province ?? (es ? "En el Exterior / sin provincia" : "Overseas / no province");
      (map.get(key) ?? map.set(key, []).get(key)!).push(l);
    }
    return [...map.entries()].sort((a, b) => {
      const ax = /Exterior|Overseas/.test(a[0]) ? 1 : 0;
      const bx = /Exterior|Overseas/.test(b[0]) ? 1 : 0;
      return ax - bx || a[0].localeCompare(b[0], "es");
    });
  }, [filtered, es]);

  const filteredCommissions = useMemo(() => {
    const needle = norm(q.trim());
    return commissions.filter((c) => {
      if (c.chamber !== chamber) return false;
      if (!needle) return true;
      return norm(c.name).includes(needle) || c.members.some((m) => norm(m.name).includes(needle));
    });
  }, [commissions, chamber, q]);

  return (
    <div>
      {/* Chamber switch — one window per chamber, like the Hoy page */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="eyebrow">{es ? "Cámara" : "Chamber"}</span>
        <ChamberToggle value={chamberSel} onChange={(v) => { setChamberSel(v); setProvince("ALL"); setParty("ALL"); }} lang={lang} />
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          {inChamber.length} {chamber === "SENADO" ? (es ? "senadores" : "senators") : (es ? "diputados" : "deputies")}
        </span>
      </div>

      {/* Sub-tabs */}
      <div className="mb-4 flex gap-2">
        {(["legisladores", "comisiones"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition"
            style={{
              background: tab === t ? "var(--accent)" : "var(--surface-2)",
              color: tab === t ? "#fff" : "var(--text-muted)",
            }}
          >
            {t === "legisladores" ? (es ? "Legisladores" : "Legislators") : es ? "Comisiones" : "Committees"}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={es ? "Buscar por nombre…" : "Search by name…"}
          className="min-w-[200px] flex-1 rounded-lg px-3 py-1.5 text-[13px] outline-none"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
        />
        {tab === "legisladores" && (
          <>
            <Select value={province} onChange={setProvince} all={es ? "Todas las provincias" : "All provinces"} options={chamberProvinces} />
            <Select value={party} onChange={setParty} all={es ? "Todos los partidos" : "All parties"} options={chamberParties} />
          </>
        )}
      </div>

      {tab === "legisladores" ? (
        <div className="space-y-6">
          {groups.map(([prov, members]) => (
            <section key={prov}>
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="serif text-[15px] font-semibold">{prov}</h3>
                <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{members.length}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {members
                  .slice()
                  .sort((a, b) => a.fullName.localeCompare(b.fullName))
                  .map((l) => (
                    <LegCard key={l.id} l={l} es={es} onClick={() => setProfile(l)} />
                  ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && (
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              {es ? "Sin resultados con estos filtros." : "No results for these filters."}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="mb-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            {filteredCommissions.length} {es ? "comisiones" : "committees"}
          </div>
          {filteredCommissions.map((c) => (
            <CommissionCard key={`${c.chamber}-${c.name}`} c={c} es={es} />
          ))}
          {filteredCommissions.length === 0 && (
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              {es ? "Sin comisiones con estos filtros." : "No committees for these filters."}
            </p>
          )}
        </div>
      )}

      {profile && <ProfileModal l={profile} es={es} onClose={() => setProfile(null)} />}
    </div>
  );
}

function LegCard({ l, es, onClick }: { l: LegislatorProfile; es: boolean; onClick: () => void }) {
  const chamberLabel = l.chamber === "SENADO" ? (es ? "Senador/a" : "Senator") : (es ? "Diputado/a" : "Deputy");
  const sub = [l.role, l.circumscription].filter(Boolean).join(" · ");
  return (
    <button
      onClick={onClick}
      className="w-full rounded-xl p-3 text-left transition hover:-translate-y-0.5 hover:shadow-lg"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-medium">{l.fullName}</div>
          <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
            {chamberLabel}{sub ? ` · ${sub}` : ""}
          </div>
        </div>
        {l.partyShort && (
          <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }} title={l.party ?? undefined}>
            {l.partyShort}
          </span>
        )}
      </div>
    </button>
  );
}

function ProfileModal({ l, es, onClose }: { l: LegislatorProfile; es: boolean; onClose: () => void }) {
  const chamberLabel = l.chamber === "SENADO" ? (es ? "Senador/a de la República" : "Senator") : (es ? "Diputado/a" : "Deputy");
  // A short, honest bio composed from the structured facts we hold (no invented prose).
  const bioParts = [
    `${chamberLabel}${l.province ? ` ${es ? "por" : "for"} ${l.province}` : ""}`,
    l.circumscription || null,
    l.party || l.partyShort,
    l.period ? `${es ? "período" : "term"} ${l.period}` : null,
  ].filter(Boolean);
  const presidencias = l.committees.filter((c) => c.cargo === "Presidente");
  const initials = l.fullName.split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase();

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="profile-modal-title"
      className="max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-2xl p-5 shadow-2xl sm:max-w-[560px]"
      panelStyle={{ background: "var(--surface)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
    >
      <div>
        <div className="flex items-start gap-4">
          <Avatar src={l.photoUrl} initials={initials} name={l.fullName} />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <h2 id="profile-modal-title" className="serif text-[19px] font-semibold leading-tight">{l.fullName}</h2>
              <button onClick={onClose} aria-label={es ? "Cerrar" : "Close"} className="rounded-md px-1.5 hover:bg-[var(--surface-2)]" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>✕</button>
            </div>
            {l.role && <div className="mt-0.5 text-[12px] font-medium" style={{ color: "var(--accent)" }}>{l.role}</div>}
            <p className="mt-1.5 text-[12.5px] leading-snug" style={{ color: "var(--text-muted)" }}>
              {bioParts.join(" · ")}.
            </p>
          </div>
        </div>

        {/* Datos relevantes */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
          <Field label={es ? "Cámara" : "Chamber"} value={l.chamber === "SENADO" ? (es ? "Senado" : "Senate") : (es ? "Cámara de Diputados" : "Chamber of Deputies")} />
          <Field label={es ? "Provincia" : "Province"} value={l.province} />
          <Field label={es ? "Partido" : "Party"} value={l.party ?? l.partyShort} />
          <Field label={es ? "Período" : "Term"} value={l.period} />
          <Field label={es ? "Circunscripción" : "Circumscription"} value={l.circumscription} />
          <Field label={es ? "Nivel" : "Level"} value={l.representationLevel} />
          <Field label={es ? "Profesión" : "Profession"} value={l.profession} />
          <Field label={es ? "Correo" : "Email"} value={l.email} />
          <Field label={es ? "Teléfono" : "Phone"} value={l.phone} />
        </div>

        {/* Comisiones */}
        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
            {es ? "Comisiones" : "Committees"} {l.committees.length > 0 && `· ${l.committees.length}`}
          </div>
          {l.committees.length === 0 ? (
            <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              {es ? "Sin comisiones registradas." : "No committees on record."}
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {l.committees
                .slice()
                .sort((a, b) => (a.cargo === "Presidente" ? -1 : 0) - (b.cargo === "Presidente" ? -1 : 0))
                .map((c) => (
                  <li key={`${c.name}-${c.cargo ?? ""}`} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px]" style={{ background: "var(--surface-2)" }}>
                    <span>{c.name}</span>
                    {c.cargo && c.cargo !== "Miembro" && (
                      <span className="rounded px-1 text-[9.5px] font-semibold" style={{ background: CARGO_SOFT[c.cargo] ?? "var(--surface-2)", color: CARGO_COLOR[c.cargo] ?? "var(--text-muted)" }}>
                        {c.cargo}
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          )}
          {presidencias.length > 0 && (
            <p className="mt-1.5 text-[11px]" style={{ color: "var(--risk-bajo)" }}>
              {es ? "Preside" : "Chairs"}: {presidencias.map((c) => c.name).join(", ")}
            </p>
          )}
        </div>

        {/* Enlaces */}
        {l.sourceUrl && (
          <div className="mt-5 flex flex-wrap gap-2">
            <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
              {es ? "Perfil oficial" : "Official profile"}
            </a>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Avatar({ src, initials, name }: { src: string | null; initials: string; name: string }) {
  const [err, setErr] = useState(false);
  if (src && !err) {
    return <img src={src} alt={name} onError={() => setErr(true)} className="h-16 w-16 shrink-0 rounded-xl object-cover" style={{ background: "var(--surface-2)" }} />;
  }
  return (
    <div aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-[18px] font-semibold" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
      {initials}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="mt-0.5 break-words">{value}</div>
    </div>
  );
}

function CommissionCard({ c, es }: { c: CommissionWithMembers; es: boolean }) {
  const [open, setOpen] = useState(false);
  const president = c.members.find((m) => m.cargo === "Presidente");
  return (
    <div className="rounded-xl" style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-medium">{c.name}</div>
          <div className="mt-0.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
            {c.members.length} {es ? "miembros" : "members"}{president ? ` · ${es ? "Pres." : "Chair"}: ${president.name}` : ""}
          </div>
        </div>
        <span className="shrink-0 text-[12px]" style={{ color: "var(--text-muted)" }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
          <ul className="space-y-1.5">
            {c.members.map((m, i) => (
              <li key={`${m.name}-${m.cargo ?? ""}-${i}`} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span>{m.name}</span>
                <span className="flex items-center gap-1.5">
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
        </div>
      )}
    </div>
  );
}

function Select({ value, onChange, all, options }: { value: string; onChange: (v: string) => void; all: string; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg px-2.5 py-1.5 text-[12px] outline-none"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border)", color: "var(--text)" }}
    >
      <option value="ALL">{all}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
