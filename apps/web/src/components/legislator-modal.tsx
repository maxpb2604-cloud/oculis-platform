"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import type { LegislatorProfile } from "@/lib/data";

/**
 * Global "click any legislator name → bubble" host. Mounted once in the app shell,
 * it listens (via event delegation) for clicks on any element carrying
 * `data-legislator-id` (source id, reliable) or `data-legislator-name` (fuzzy,
 * for committee agendas and sponsor fields), resolves the profile from
 * /api/legislators/resolve, and shows it. An optional `data-legislator-chamber`
 * narrows a name match to one chamber. Real <a> links inside a trigger still work.
 */
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

type Query = { sourceId?: string; name?: string; chamber?: string };

export function LegislatorModalHost({ lang }: { lang: "es" | "en" }) {
  const es = lang === "es";
  const [query, setQuery] = useState<Query | null>(null);
  const [data, setData] = useState<LegislatorProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const queryFrom = (target: EventTarget | null): Query | null => {
      const t = target as HTMLElement | null;
      if (!t || t.closest("a")) return null;
      const el = t.closest("[data-legislator-id],[data-legislator-name]") as HTMLElement | null;
      if (!el) return null;
      const sourceId = el.getAttribute("data-legislator-id")?.trim() || undefined;
      const name = el.getAttribute("data-legislator-name")?.trim() || undefined;
      const chamber = el.getAttribute("data-legislator-chamber")?.trim() || undefined;
      if (!sourceId && !name) return null;
      return { sourceId, name, chamber };
    };
    const onClick = (e: MouseEvent) => {
      const q = queryFrom(e.target);
      if (!q) return;
      e.preventDefault();
      setQuery(q);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest("button, input, select, textarea, a")) return;
      const q = queryFrom(e.target);
      if (!q) return;
      e.preventDefault();
      setQuery(q);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!query) return;
    const ctrl = new AbortController();
    setLoading(true);
    setNotFound(false);
    setData(null);
    const p = new URLSearchParams();
    if (query.sourceId) p.set("sourceId", query.sourceId);
    if (query.name) p.set("name", query.name);
    if (query.chamber) p.set("chamber", query.chamber);
    fetch(`/api/legislators/resolve?${p.toString()}`, { signal: ctrl.signal })
      .then((r) => {
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: LegislatorProfile | null) => {
        if (!d) setNotFound(true);
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setNotFound(true);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [query]);

  const close = () => setQuery(null);
  if (!query) return null;

  const l = data;
  const chamberLabel = l
    ? l.chamber === "SENADO"
      ? es
        ? "Senador/a de la República"
        : "Senator"
      : es
        ? "Diputado/a"
        : "Deputy"
    : "";
  const bioParts = l
    ? [
        `${chamberLabel}${l.province ? ` ${es ? "por" : "for"} ${l.province}` : ""}`,
        l.circumscription || null,
        l.party || l.partyShort,
        l.period ? `${es ? "período" : "term"} ${l.period}` : null,
      ].filter(Boolean)
    : [];
  const initials = l ? l.fullName.split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase() : "";
  const presidencias = l ? l.committees.filter((c) => c.cargo === "Presidente") : [];

  return (
    <Modal
      open
      onClose={close}
      labelledBy="leg-modal-title"
      className="max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-2xl p-5 shadow-2xl"
      panelStyle={{ background: "var(--surface)", border: "1px solid var(--border-strong)", color: "var(--text)" }}
    >
      {loading || (!l && !notFound) ? (
        <div className="px-2 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          {es ? "Cargando…" : "Loading…"}
        </div>
      ) : !l ? (
        <div className="px-2 py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          <p>{es ? "No se encontró el legislador." : "Legislator not found."}</p>
          <button onClick={close} className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-medium" style={{ cursor: "pointer" }}>
            {es ? "Cerrar" : "Close"}
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-start gap-4">
            <Avatar src={l.photoUrl} initials={initials} name={l.fullName} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <h2 id="leg-modal-title" className="serif text-[19px] font-semibold leading-tight">{l.fullName}</h2>
                <button onClick={close} aria-label={es ? "Cerrar" : "Close"} className="rounded-md px-1.5 hover:bg-[var(--surface-2)]" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>✕</button>
              </div>
              {l.role && <div className="mt-0.5 text-[12px] font-medium" style={{ color: "var(--accent)" }}>{l.role}</div>}
              <p className="mt-1.5 text-[12.5px] leading-snug" style={{ color: "var(--text-muted)" }}>{bioParts.join(" · ")}.</p>
            </div>
          </div>

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

          <div className="mt-4">
            <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              {es ? "Comisiones" : "Committees"} {l.committees.length > 0 && `· ${l.committees.length}`}
            </div>
            {l.committees.length === 0 ? (
              <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>{es ? "Sin comisiones registradas." : "No committees on record."}</p>
            ) : (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {l.committees
                  .slice()
                  .sort((a, b) => (a.cargo === "Presidente" ? -1 : 0) - (b.cargo === "Presidente" ? -1 : 0))
                  .map((c) => (
                    <li key={`${c.name}-${c.cargo ?? ""}`} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px]" style={{ background: "var(--surface-2)" }}>
                      <span>{c.name}</span>
                      {c.cargo && c.cargo !== "Miembro" && (
                        <span className="rounded px-1 text-[9.5px] font-semibold" style={{ background: CARGO_SOFT[c.cargo] ?? "var(--surface-2)", color: CARGO_COLOR[c.cargo] ?? "var(--text-muted)" }}>{c.cargo}</span>
                      )}
                    </li>
                  ))}
              </ul>
            )}
            {presidencias.length > 0 && (
              <p className="mt-1.5 text-[11px]" style={{ color: "var(--risk-bajo)" }}>{es ? "Preside" : "Chairs"}: {presidencias.map((c) => c.name).join(", ")}</p>
            )}
          </div>

          {l.sourceUrl && (
            <div className="mt-5 flex flex-wrap gap-2">
              <a href={l.sourceUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg px-3 py-1.5 text-[12.5px] font-medium" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                {es ? "Perfil oficial" : "Official profile"}
              </a>
            </div>
          )}
        </div>
      )}
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
