"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CATEGORY_LABELS, type Category } from "@oculis/core";
import { Modal } from "@/components/ui/modal";
import { formatISODate } from "@/lib/format";
import { langQuery, t as tr } from "@/lib/i18n";
import { RiskPill } from "@/components/initiatives-table";

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
  riskLevel: string | null;
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
  relatedNews?: {
    id: number;
    kind: string;
    title: string;
    url: string | null;
    source: string;
    publishedAt: string | null;
  }[];
}

/** Friendly source label for the related-news badges. */
const NEWS_SRC: Record<string, string> = {
  "feed-senado": "Senado",
  "feed-diputados": "Diputados",
  "feed-diariolibre": "Diario Libre",
  "feed-listin": "Listín",
  "feed-acento": "Acento",
  "feed-elnacional": "El Nacional",
  "feed-hoy": "Hoy",
  "feed-elcaribe": "El Caribe",
  "feed-x": "X",
  "feed-legislative": "Señal",
};

/** What was clicked: an initiative id (from tables/deposits) or an official code (from agendas). */
type Trigger = { kind: "id"; value: number } | { kind: "code"; value: string };

export function InitiativeModalHost({ lang }: { lang: "es" | "en" }) {
  const es = lang === "es";
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0); // bumped by "Retry" to re-run the fetch

  useEffect(() => {
    // Resolve the trigger element (ancestor carrying data-initiative-id OR
    // data-initiative-code) to a Trigger. Elements with a data-no-bubble ancestor
    // (e.g. an inner legislator chip) are ignored so nested triggers don't fight.
    const triggerFrom = (target: EventTarget | null): Trigger | null => {
      const t = target as HTMLElement | null;
      if (!t || t.closest("a")) return null; // let real links behave normally
      const byId = t.closest("[data-initiative-id]") as HTMLElement | null;
      const byCode = t.closest("[data-initiative-code]") as HTMLElement | null;
      // Prefer the nearest of the two.
      const el =
        byId && byCode ? (byId.contains(byCode) ? byCode : byId) : byId ?? byCode;
      if (!el || el.closest("[data-no-bubble]")) return null;
      if (el === byId || (byId && el.contains(byId))) {
        const v = Number(byId!.getAttribute("data-initiative-id"));
        if (Number.isFinite(v) && v > 0) return { kind: "id", value: v };
      }
      const code = byCode?.getAttribute("data-initiative-code")?.trim();
      return code ? { kind: "code", value: code } : null;
    };
    const onClick = (e: MouseEvent) => {
      const v = triggerFrom(e.target);
      if (!v) return;
      e.preventDefault();
      setTrigger(v);
    };
    // Keyboard path: trigger rows are focusable (tabIndex=0, role="button"), so
    // Enter/Space must open the modal just like a click.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest("button, input, select, textarea")) return; // don't hijack real controls
      const v = triggerFrom(e.target);
      if (!v) return;
      e.preventDefault();
      setTrigger(v);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (trigger == null) return;
    // Escape / focus-trap handled by the shared <Modal> primitive.
    // Abort superseded requests so a slow earlier response can never
    // overwrite the modal with the wrong initiative's data.
    const ctrl = new AbortController();
    setLoading(true);
    setError(false);
    setData(null);
    const url =
      trigger.kind === "id"
        ? `/api/initiatives/${trigger.value}`
        : `/api/initiatives/by-code?code=${encodeURIComponent(trigger.value)}`;
    fetch(url, { signal: ctrl.signal })
      .then((r) => {
        if (r.status === 404) return null; // renders the "Not found" state
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: Detail | null) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        if (ctrl.signal.aborted) return; // stale request — a newer one owns the state
        setError(true);
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [trigger, attempt]);

  const close = () => setTrigger(null);
  if (trigger == null) return null;

  const fmt = (iso: string | null) => formatISODate(iso, lang);
  const catLabel = data?.category ? CATEGORY_LABELS[data.category as Category] ?? data.category : null;
  const sponsorMeta = data ? [data.party, data.province].filter(Boolean).join(" · ") : "";
  const others = (data?.sponsorCount ?? 1) - 1;
  const events = (data?.events ?? []).slice().reverse(); // newest first

  return (
    <Modal
      open
      onClose={close}
      labelledBy="ini-modal-title"
      className="card relative my-8 w-full max-w-xl"
      panelStyle={{ background: "var(--surface)" }}
    >
      <div>
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
                <span className="eyebrow">· {data.chamber === "SENADO" ? (es ? "Senado" : "Senate") : (es ? "Diputados" : "Deputies")}</span>
              )}
            </div>
            <div className="eyebrow mt-1" id="ini-modal-title">{es ? "Iniciativa" : "Initiative"}</div>
          </div>
          <button
            onClick={close}
            aria-label={es ? "Cerrar" : "Close"}
            className="shrink-0 rounded-md px-2 py-0.5 text-sm"
            style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
          >
            ✕
          </button>
        </div>

        {error ? (
          <div className="px-5 py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            <p>{es ? "No se pudo cargar la iniciativa." : "Could not load the initiative."}</p>
            <button
              onClick={() => setAttempt((a) => a + 1)}
              className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-2)]"
              style={{ cursor: "pointer" }}
            >
              {es ? "Reintentar" : "Retry"}
            </button>
          </div>
        ) : loading || !data ? (
          <div className="px-5 py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            {loading ? (es ? "Cargando…" : "Loading…") : es ? "No encontrada." : "Not found."}
          </div>
        ) : (
          <>
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
            {/* Resumen */}
            <Section title={es ? "Resumen" : "Summary"}>
              <p className="serif text-[15px] leading-snug">{data.title}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {catLabel && <Tag label={es ? "Categoría" : "Category"} value={catLabel} />}
                {data.riskLevel && (
                  <span className="inline-flex items-center gap-1 text-[11px]">
                    <span style={{ color: "var(--text-muted)" }}>{es ? "Riesgo:" : "Risk:"}</span>
                    <RiskPill level={data.riskLevel} lang={lang} />
                  </span>
                )}
                <ApprovalTag value={data.approvalProbability} lang={lang} />
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
            <Section title={es ? "Enlaces" : "Links"}>
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

            {data.relatedNews && data.relatedNews.length > 0 && (
              <Section title={es ? "Noticias relacionadas" : "Related news"}>
                <ul className="flex flex-col gap-2">
                  {data.relatedNews.slice(0, 6).map((n) => (
                    <li key={n.id} className="leading-snug">
                      {n.url ? (
                        <a
                          href={n.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[13px] hover:underline"
                          style={{ color: "var(--text)" }}
                        >
                          <span
                            className="mr-1.5 rounded px-1 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide"
                            style={{ color: "var(--accent)", background: "var(--accent-soft)" }}
                          >
                            {NEWS_SRC[n.source] ?? n.kind}
                          </span>
                          {n.title}
                        </a>
                      ) : (
                        <span className="text-[13px]">{n.title}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>

          {/* Footer: on to the full detail page (score breakdown, provenance, timeline). */}
          <div className="border-t px-5 py-3">
            <Link
              href={`/initiatives/${data.id}${langQuery(lang)}`}
              onClick={close}
              className="text-[13px] font-semibold underline-offset-2 hover:underline"
              style={{ color: "var(--accent)", cursor: "pointer" }}
            >
              {es ? "Ver análisis completo →" : "Full analysis →"}
            </Link>
          </div>
          </>
        )}
      </div>
    </Modal>
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

function ApprovalTag({ value, lang }: { value: string | null; lang: "es" | "en" }) {
  const tone = value ? APPROVAL_TONE[value] : undefined;
  if (!tone || !value) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ color: tone.fg, background: tone.bg }}>
      {lang === "es" ? "Prob. aprobación" : "Approval"}: {tr(lang, `approval${value}`)}
    </span>
  );
}
