import { getMonitoringHealth } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/dashboard";

export const dynamic = "force-dynamic";

const SOURCE_LABEL: Record<string, string> = {
  "sil-actividad": "SIL Diputados · actividad de comisiones",
  "dip-oficial": "Cámara de Diputados (oficial) · órdenes del día del Pleno",
  "senado": "Senado · órdenes del día y agenda de comisiones",
};

export default async function MonitoreoPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const runs = await getMonitoringHealth();
  const allOk = runs.length > 0 && runs.every((r) => r.ok);

  return (
    <AppShell lang={lang} title="Estado de monitoreo" subtitle="Salud del scraping diario por fuente">
      <div className="mb-5 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-semibold"
        style={{ background: allOk ? "var(--accent-soft)" : "#fde8e8", color: allOk ? "var(--accent)" : "#c0392b" }}>
        <span className="h-2 w-2 rounded-full" style={{ background: allOk ? "var(--accent)" : "#c0392b" }} />
        {runs.length === 0 ? "Aún no se ha ejecutado el monitoreo" : allOk ? "Todas las fuentes operativas" : "Una o más fuentes con incidencias"}
      </div>

      <Panel title="Fuentes" flush>
        {runs.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Ejecuta <code className="rounded bg-[var(--surface-2)] px-1.5 py-0.5">npm run daily</code> para poblar el estado.
          </div>
        ) : (
          runs.map((r) => {
            const gaps = (r.details as { gaps?: string[] } | null)?.gaps ?? [];
            return (
              <div key={r.source} className="border-b px-5 py-4 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.ok ? "var(--accent)" : "#c0392b" }} />
                    <div>
                      <div className="text-sm font-medium">{SOURCE_LABEL[r.source] ?? r.source}</div>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {r.finishedAt ? new Date(r.finishedAt).toLocaleString("es-DO") : "—"} · {r.seen} eventos
                      </div>
                    </div>
                  </div>
                  <span className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
                    style={{ background: r.ok ? "var(--accent-soft)" : "#fde8e8", color: r.ok ? "var(--accent)" : "#c0392b" }}>
                    {r.ok ? "OK" : "ERROR"}
                  </span>
                </div>
                {r.error && <div className="mt-2 text-[12px]" style={{ color: "#c0392b" }}>{r.error}</div>}
                {gaps.map((g, i) => (
                  <div key={i} className="mt-2 rounded-md px-3 py-2 text-[12px]"
                    style={{ background: "#fff7e6", color: "#8a5a00" }}>⚠ {g}</div>
                ))}
              </div>
            );
          })
        )}
      </Panel>
    </AppShell>
  );
}
