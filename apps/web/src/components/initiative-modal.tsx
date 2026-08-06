"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { formatISODate } from "@/lib/format";
import type { Lang } from "@/lib/i18n";
import { senateRecordId } from "@/lib/input";
import { statusEvidenceLabel } from "@/lib/status-events";

function chamberLabel(chamber: string | null, lang: Lang): string {
  if (chamber === "SENADO") return lang === "es" ? "Senado" : "Senate";
  if (chamber === "DIPUTADOS") return lang === "es" ? "Diputados" : "Deputies";
  return chamber || (lang === "es" ? "No informado" : "Not reported");
}

/**
 * Global "click any initiative → bubble" host. Mounted once in the app shell, it listens
 * (via event delegation) for clicks on any element carrying `data-initiative-id`, then
 * opens a modal with that initiative's summary, sponsor, status, links, and history —
 * fetched from /api/initiatives/:id. Real <a> links inside a clickable element still work.
 */
interface Detail {
  id: number;
  source: string;
  code: string | null;
  title: string;
  type: string | null;
  sourceCategory: string | null;
  status: string | null;
  chamber: string | null;
  sourceId: string | null;
  sponsor: string | null;
  sponsorRole: string | null;
  sponsorCount: number | null;
  proponents: {
    name: string;
    principal: boolean | null;
    role: string | null;
    party: string | null;
    province: string | null;
  }[];
  party: string | null;
  province: string | null;
  filedAt: string | null;
  sourceUrl: string | null;
  events?: {
    id: number;
    status: string;
    eventDate: string | null;
    note: string | null;
    source: string;
    sourceUrl: string | null;
    evidenceType: string;
    observedAt: string | null;
  }[];
  documents?: {
    id: number;
    source: string;
    sourceDocId: string | null;
    docType: string | null;
    extension: string | null;
    url: string | null;
    uploadedAt: string | null;
  }[];
  relatedNews?: {
    id: number;
    kind: string;
    title: string;
    url: string | null;
    source: string;
    publishedAt: string | null;
    observedAt: string;
  }[];
}

type LoadError = "not_found" | "request_failed";

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

export function InitiativeModalHost({ lang }: { lang: "es" | "en" }) {
  const es = lang === "es";
  const [id, setId] = useState<number | null>(null);
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LoadError | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);
  const close = useCallback(() => setId(null), []);

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
    const ctrl = new AbortController();
    let active = true;

    setLoading(true);
    setData(null);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/initiatives/${id}`, { signal: ctrl.signal });
        if (!response.ok) {
          if (active) setError(response.status === 404 ? "not_found" : "request_failed");
          return;
        }
        const detail = (await response.json()) as Detail;
        if (active) setData(detail);
      } catch (requestError) {
        if (
          active &&
          !(requestError instanceof DOMException && requestError.name === "AbortError")
        ) {
          setError("request_failed");
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      ctrl.abort();
    };
  }, [id, requestVersion]);

  if (id == null) return null;

  const fmt = (iso: string | null) => formatISODate(iso, lang);
  const sponsorMeta = data ? [data.party, data.province].filter(Boolean).join(" · ") : "";
  const others = (data?.sponsorCount ?? 1) - 1;
  const events = (data?.events ?? []).slice().reverse(); // newest first
  const senateId = data?.chamber === "SENADO" ? senateRecordId(data.sourceId) : null;
  const missing = es ? "No informado" : "Not reported";

  return (
    <Modal
      open={id != null}
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
                <span
                  className="tnum rounded px-1.5 py-0.5 text-[11px] font-semibold"
                  style={{ background: "var(--surface-2)" }}
                >
                  {data.code}
                </span>
              )}
              {data?.type && <span className="eyebrow">{data.type}</span>}
              {data?.chamber && (
                <span className="eyebrow">· {chamberLabel(data.chamber, lang)}</span>
              )}
            </div>
            <div className="eyebrow mt-1" id="ini-modal-title">
              {es ? "Iniciativa" : "Initiative"}
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            className="inline-flex h-8 shrink-0 items-center justify-center rounded-md px-3 text-xs font-semibold"
            style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
          >
            {es ? "Cerrar" : "Close"}
          </button>
        </div>

        {loading || !data ? (
          <div
            className="px-5 py-12 text-center text-sm"
            role={error ? "alert" : "status"}
            aria-live="polite"
            style={{ color: error ? "var(--danger)" : "var(--text-muted)" }}
          >
            {loading ? (
              es ? (
                "Cargando…"
              ) : (
                "Loading…"
              )
            ) : (
              <div className="flex flex-col items-center gap-3">
                <span>
                  {error === "not_found"
                    ? es
                      ? "No se encontró la iniciativa."
                      : "The initiative was not found."
                    : es
                      ? "No se pudo cargar la iniciativa."
                      : "The initiative could not be loaded."}
                </span>
                {error === "request_failed" && (
                  <button
                    type="button"
                    onClick={() => setRequestVersion((version) => version + 1)}
                    className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
                    style={{ color: "var(--text)" }}
                  >
                    {es ? "Reintentar" : "Try again"}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
            {/* Resumen */}
            <Section title={es ? "Resumen" : "Summary"}>
              <p className="serif text-[15px] leading-snug">{data.title}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Tag label={es ? "Fuente" : "Source"} value={data.source} />
                {data.sourceCategory && (
                  <Tag
                    label={es ? "Tema declarado por la fuente" : "Source-reported subject"}
                    value={data.sourceCategory}
                  />
                )}
                {data.status && <Tag label={es ? "Estado" : "Status"} value={data.status} />}
              </div>
            </Section>

            {/* Proponente */}
            <Section title={es ? "Proponentes reportados" : "Reported sponsors"}>
              {data.proponents.length > 0 ? (
                <ul className="space-y-2 text-sm">
                  {data.proponents.map((proponent, index) => {
                    const facts = [proponent.role, proponent.party, proponent.province]
                      .filter(Boolean)
                      .join(" · ");
                    return (
                      <li key={`${proponent.name}-${index}`}>
                        <span className="font-semibold">{proponent.name}</span>
                        {proponent.principal === true && (
                          <span className="ml-1.5 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-medium">
                            {es ? "Principal según la fuente" : "Principal per source"}
                          </span>
                        )}
                        {facts && (
                          <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                            {facts}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : data.sponsor ? (
                <div className="text-sm">
                  <span className="font-semibold">{data.sponsor}</span>
                  {data.sponsorRole && (
                    <span style={{ color: "var(--text-muted)" }}> · {data.sponsorRole}</span>
                  )}
                  {sponsorMeta && (
                    <span style={{ color: "var(--text-muted)" }}> · {sponsorMeta}</span>
                  )}
                  {others > 0 && (
                    <span className="ml-1.5 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] font-medium">
                      +{others} {es ? "proponente(s)" : "co-sponsor(s)"}
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {es ? "No informado" : "Not reported"}
                </p>
              )}
            </Section>

            {/* Estado + fecha */}
            <Section title={es ? "Estado actual" : "Current status"}>
              <div className="text-sm">{data.status ?? (es ? "No informado" : "Not reported")}</div>
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
                    <li key={ev.id} className="flex gap-3">
                      <div className="mt-1 flex flex-col items-center">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ background: "var(--accent)" }}
                        />
                        {i < events.length - 1 && (
                          <span
                            className="mt-0.5 w-px flex-1"
                            style={{ background: "var(--border)" }}
                          />
                        )}
                      </div>
                      <div className="min-w-0 pb-1">
                        <div className="text-[13px] font-medium">{ev.status}</div>
                        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {ev.evidenceType === "SOURCE_HISTORY" && ev.eventDate ? (
                            <>
                              {es ? "Fecha oficial" : "Official date"}:{" "}
                              <time dateTime={ev.eventDate}>{fmt(ev.eventDate)}</time>
                            </>
                          ) : ev.eventDate ? (
                            <>
                              {es
                                ? "Fecha almacenada sin atribución"
                                : "Stored date without attribution"}
                              : <time dateTime={ev.eventDate}>{fmt(ev.eventDate)}</time>
                            </>
                          ) : (
                            <>
                              {es ? "Observado por Oculis" : "Observed by Oculis"}:{" "}
                              {ev.observedAt ? (
                                <time dateTime={ev.observedAt}>{ev.observedAt}</time>
                              ) : (
                                missing
                              )}
                            </>
                          )}
                        </div>
                        {ev.note && (
                          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            {ev.note}
                          </div>
                        )}
                        <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {es ? "Fuente" : "Source"}:{" "}
                          <span style={{ color: "var(--text)" }}>{ev.source}</span>
                        </div>
                        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                          {es ? "Tipo de evidencia" : "Evidence type"}:{" "}
                          {statusEvidenceLabel(ev.evidenceType, lang)}
                        </div>
                        <div className="text-[11px]">
                          {ev.sourceUrl ? (
                            <a
                              href={ev.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium underline-offset-2 hover:underline"
                              style={{ color: "var(--accent)" }}
                            >
                              {es ? "Abrir evidencia ↗" : "Open evidence ↗"}
                            </a>
                          ) : (
                            <span style={{ color: "var(--text-muted)" }}>
                              {es
                                ? "Enlace de evidencia: No informado"
                                : "Evidence link: Not reported"}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            {/* Links */}
            <Section title={es ? "Procedencia" : "Provenance"}>
              <p className="mb-1.5 text-[12px]" style={{ color: "var(--text-muted)" }}>
                {es ? "Fuente" : "Source"}:{" "}
                <span className="font-semibold" style={{ color: "var(--text)" }}>
                  {data.source}
                </span>
              </p>
              {senateId ? (
                // Read-only, sandboxed view of the Senate's legacy public record.
                <a
                  href={`/api/senado/ficha/${senateId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] font-medium underline-offset-2 hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {es ? "Abrir expediente en el Senado ↗" : "Open Senate record ↗"}
                </a>
              ) : data.sourceUrl ? (
                <a
                  href={data.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] font-medium underline-offset-2 hover:underline"
                  style={{ color: "var(--accent)" }}
                >
                  {es ? "Abrir enlace de la fuente ↗" : "Open source link ↗"}
                </a>
              ) : (
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {es ? "Enlace oficial: No informado" : "Official link: Not reported"}
                </span>
              )}
            </Section>

            <Section title={es ? "Documentos oficiales" : "Official documents"}>
              {data.documents && data.documents.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {data.documents.map((document) => (
                    <li key={document.id} className="text-[12px]">
                      {document.url ? (
                        <a
                          href={document.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium underline-offset-2 hover:underline"
                          style={{ color: "var(--accent)" }}
                        >
                          {document.docType ?? document.sourceDocId ?? missing}
                        </a>
                      ) : (
                        <span>{document.docType ?? document.sourceDocId ?? missing}</span>
                      )}
                      <div style={{ color: "var(--text-muted)" }}>
                        {es ? "Fuente" : "Source"}: {document.source} ·{" "}
                        {es ? "Cargado" : "Uploaded"}: {document.uploadedAt ?? missing}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {es ? "Documentos: No informado" : "Documents: Not reported"}
                </span>
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
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px]"
      style={{ background: "var(--surface-2)" }}
    >
      <span style={{ color: "var(--text-muted)" }}>{label}:</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
