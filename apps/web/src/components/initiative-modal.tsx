"use client";

import { useEffect, useState } from "react";
import { CATEGORY_LABELS, type Category } from "@oculis/core";

/**
 * Global "click any initiative → bubble" host. Mounted once in the app shell, it listens
 * (via event delegation) for clicks on any element carrying `data-initiative-id`, then
 * opens a modal with that initiative's summary, sponsor, status, links, and history —
 * fetched from /api/initiatives/:id. Real <a> links inside a clickable element still work.
 */
interface Detail {
  id: number;
  code: string | null;
  title: string;
  type: string | null;
  category: string | null;
  status: string | null;
  approvalProbability: string | null;
  chamber: string | null;
  sourceId: string | null;
  sponsor: string | null;
  sponsorRole: string | null;
  sponsorCount: number | null;
  party: string | null;
  province: string | null;
  filedAt: string | null;
  sourceUrl: string | null;
  events?: { status: string; eventDate: string | null; note: string | null }[];
}

export function InitiativeModalHost({ lang }: { lang: "es" | "en" }) {
  const es = lang === "es";
  const [id, setId] = useState<number | null>(null);
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || target.closest("a")) return; // let real links behave normally
      const el = target.closest("[data-initiative-id]") as HTMLElement | null;
      if (!el) return;
      const v = Number(el.getAttribute("data-initiative-id"));
      if (!Number.isFinite(v) || v <= 0) return;
      e.preventDefault();
      setId(v);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (id == null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setId(null);
    document.addEventListener("keydown", onKey);
    setLoading(true);
    setData(null);
    fetch(`/api/initiatives/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .finally(() => setLoading(false));
    return () => document.removeEventListener("keydown", onKey);
  }, [id]);

  if (id == null) return null;

  const fmt = (iso: string | null) =>
    iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";
  const catLabel = data?.category ? CATEGORY_LABELS[data.category as Category] ?? data.category : null;
  const sponsorMeta = data ? [data.party, data.province].filter(Boolean).join(" · ") : "";
  const others = (data?.sponsorCount ?? 1) - 1;
  const events = (data?.events ?? []).slice().reverse(); // newest first

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: "rgba(6,10,14,0.55)", backdropFilter: "blur(3px)" }}
      onClick={() => setId(null)}
    >
      <div
        className="card relative my-8 w-full max-w-xl"
        style={{ background: "var(--surface)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b px-5 py-3.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              {data?.code && (
                <span className="tnum rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ background: "var(--surface-2)" }}>
                  {data.code}
                </span>
              )}
              {data?.type && <span className="eyebrow">{data.type}</span>}
              {data?.chamber && (
                <span className="eyebrow">· {data.chamber === "SENADO" ? "Senado" : "Diputados"}</span>
              )}
            </div>
            <div className="eyebrow mt-1">{es ? "Iniciativa" : "Initiative"}</div>
          </div>
          <button
            onClick={() => setId(null)}
            aria-label={es ? "Cerrar" : "Close"}
            className="shrink-0 rounded-md px-2 py-0.5 text-sm"
            style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>

        {loading || !data ? (
          <div className="px-5 py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {loading ? (es ? "Cargando…" : "Loading…") : es ? "No encontrada." : "Not found."}
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
            {/* Resumen */}
            <Section title={es ? "Resumen" : "Summary"}>
              <p className="serif text-[15px] leading-snug">{data.title}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {catLabel && <Tag label={es ? "Categoría" : "Category"} value={catLabel} />}
                <ApprovalTag value={data.approvalProbability} es={es} />
                {data.status && <Tag label={es ? "Estado" : "Status"} value={data.status} />}
              </div>
            </Section>

            {/* Proponente */}
            <Section title={es ? "Proponente" : "Sponsor"}>
              {data.sponsor ? (
                <div className="text-sm">
                  <span className="font-semibold">{data.sponsor}</span>
                  {data.sponsorRole && <span style={{ color: "var(--text-muted)" }}> · {data.sponsorRole}</span>}
                  {sponsorMeta && <span style={{ color: "var(--text-muted)" }}> · {sponsorMeta}</span>}
                  {others > 0 && (
                    <span className="ml-1.5 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] font-medium">
                      +{others} {es ? "proponente(s)" : "co-sponsor(s)"}
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>{es ? "No disponible." : "Not available."}</p>
              )}
            </Section>

            {/* Estado + fecha */}
            <Section title={es ? "Estado actual" : "Current status"}>
              <div className="text-sm">{data.status ?? "—"}</div>
              <div className="mt-0.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
                {es ? "Depositada" : "Filed"}: {fmt(data.filedAt)}
              </div>
            </Section>

            {/* Historial */}
            <Section title={es ? "Historial" : "History"}>
              {events.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {es ? "Sin eventos de estado registrados." : "No status events recorded."}
                </p>
              ) : (
                <ol className="space-y-2.5">
                  {events.map((ev, i) => (
                    <li key={i} className="flex gap-3">
                      <div className="mt-1 flex flex-col items-center">
                        <span className="h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />
                        {i < events.length - 1 && <span className="mt-0.5 w-px flex-1" style={{ background: "var(--border)" }} />}
                      </div>
                      <div className="pb-1">
                        <div className="text-[13px] font-medium">{ev.status}</div>
                        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {fmt(ev.eventDate)}{ev.note ? ` · ${ev.note}` : ""}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            {/* Links */}
            <Section title="Links">
              {data.chamber === "SENADO" && data.sourceId ? (
                // Proxy that logs into the Senate's Expedientes Digitales and serves the
                // full record — bypasses the login block a raw link would hit.
                <a href={`/api/senado/ficha/${data.sourceId}`} target="_blank" rel="noreferrer"
                  className="text-[13px] font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
                  {es ? "Abrir expediente en el Senado ↗" : "Open Senate record ↗"}
                </a>
              ) : data.sourceUrl ? (
                <a href={data.sourceUrl} target="_blank" rel="noreferrer"
                  className="text-[13px] font-medium underline-offset-2 hover:underline" style={{ color: "var(--accent)" }}>
                  {es ? "Ficha en el SIL ↗" : "SIL record ↗"}
                </a>
              ) : (
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>{es ? "Sin enlace." : "No link."}</span>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b py-3 last:border-0">
      <div className="eyebrow mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function Tag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]" style={{ background: "var(--surface-2)" }}>
      <span style={{ color: "var(--text-muted)" }}>{label}:</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}

const APPROVAL_TONE: Record<string, { fg: string; bg: string }> = {
  ALTA: { fg: "var(--risk-bajo)", bg: "var(--risk-bajo-soft)" },
  MEDIA: { fg: "var(--warn)", bg: "var(--warn-soft)" },
  BAJA: { fg: "var(--text-muted)", bg: "var(--surface-2)" },
};

function ApprovalTag({ value, es }: { value: string | null; es: boolean }) {
  const tone = value ? APPROVAL_TONE[value] : undefined;
  if (!tone || !value) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ color: tone.fg, background: tone.bg }}>
      {es ? "Prob. aprobación" : "Approval"}: {value}
    </span>
  );
}
