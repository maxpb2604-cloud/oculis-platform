import { getMonitoringHealth } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/dashboard";
import { HealthPill } from "@/components/monitoring";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  "sil-actividad": "SIL Diputados · actividad de comisiones",
  "dip-oficial": "Cámara de Diputados (oficial) · órdenes del día del Pleno",
  "senado": "Senado · órdenes del día y agenda de comisiones",
};

type State = "ok" | "warn" | "error";

export default async function MonitoreoPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const runs = await getMonitoringHealth();

  // A source is WARN (not OK) when it ran but flagged gaps / returned anomalously few rows.
  const stateOf = (r: (typeof runs)[number]): State => {
    if (!r.ok) return "error";
    const gaps = (r.details as { gaps?: string[] } | null)?.gaps ?? [];
    if (gaps.length) return "warn";
    return "ok";
  };
  const worst: State = runs.length === 0 ? "warn"
    : runs.some((r) => stateOf(r) === "error") ? "error"
    : runs.some((r) => stateOf(r) === "warn") ? "warn" : "ok";
  const bannerText = runs.length === 0 ? "Aún no se ha ejecutado el monitoreo"
    : worst === "ok" ? "Todas las fuentes operativas"
    : worst === "warn" ? "Operativo con observaciones (ver detalles)"
    : "Una o más fuentes con incidencias";

  return (
    <AppShell lang={lang} title="Estado de monitoreo" subtitle="Salud del scraping diario por fuente">
      <div className="mb-5"><HealthPill state={worst}>{bannerText}</HealthPill></div>

      <Panel title="Fuentes" flush>
        {runs.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Ejecuta <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">npm run daily</code> para poblar el estado.
          </div>
        ) : (
          runs.map((r) => {
            const gaps = (r.details as { gaps?: string[] } | null)?.gaps ?? [];
            const state = stateOf(r);
            return (
              <div key={r.source} className="border-b px-5 py-4 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{SOURCE_LABEL[r.source] ?? r.source}</div>
                    <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Última ejecución: {r.finishedAt ? new Date(r.finishedAt).toLocaleString("es-DO") : "—"} · {r.seen} eventos
                      {r.baselineSeen ? ` · mediana ${r.baselineSeen}` : ""}
                      {!r.ok && r.lastSuccessAt ? ` · último éxito: ${new Date(r.lastSuccessAt).toLocaleString("es-DO")}` : ""}
                    </div>
                  </div>
                  <HealthPill state={state}>{state === "ok" ? "OK" : state === "warn" ? "OBSERVACIÓN" : "ERROR"}</HealthPill>
                </div>
                {r.error && <div className="mt-2 text-[12px]" style={{ color: "var(--danger)" }}>{r.error}</div>}
                {gaps.map((g, i) => (
                  <div key={i} className="mt-2 rounded-md px-3 py-2 text-[12px]"
                    style={{ background: "var(--warn-soft)", color: "var(--warn)" }}>⚠ {g}</div>
                ))}
              </div>
            );
          })
        )}
      </Panel>

      <p className="mt-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
        "OBSERVACIÓN" indica que la fuente se ejecutó pero con avisos (p. ej. cobertura parcial, conteo muy por debajo de
        la mediana histórica, o secciones pendientes de verificación). No es un fallo, pero conviene revisarla.
      </p>
    </AppShell>
  );
}
