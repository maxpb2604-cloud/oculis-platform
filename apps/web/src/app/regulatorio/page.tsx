import { getRegulatoryOverview } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/report-ui";
import { RegulationList, StatTile, type RegulationItem } from "@/components/monitoring";

export const dynamic = "force-dynamic";

export default async function RegulatorioPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const es = lang === "es";
  const { kpis, byInstitution, recent, consultas } = await getRegulatoryOverview();

  return (
    <AppShell
      lang={lang}
      title={es ? "Monitoreo Regulatorio" : "Regulatory Monitoring"}
      subtitle={
        es
          ? "Normas, resoluciones y consultas públicas de los órganos reguladores"
          : "Rules, resolutions and public consultations from the regulatory bodies"
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          value={kpis.total}
          label={es ? "Instrumentos monitoreados" : "Instruments monitored"}
        />
        <StatTile
          value={kpis.consultas}
          label={es ? "Consultas públicas registradas" : "Recorded public consultations"}
          accent="#0b6e4f"
        />
        <StatTile
          value={kpis.institutions}
          label={es ? "Instituciones con actividad" : "Institutions with activity"}
          accent="#8b5cf6"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title={es ? "Actividad regulatoria reciente" : "Recent regulatory activity"} flush>
            <RegulationList
              items={recent as RegulationItem[]}
              lang={lang}
              empty={
                es
                  ? "No hay actividad regulatoria disponible en esta conexión. La sincronización automática volverá a consultar las fuentes activas."
                  : "No regulatory activity is available in this connection. The scheduled sync will query the active sources again."
              }
            />
          </Panel>
        </div>
        <div>
          <Panel
            title={`${es ? "Consultas públicas registradas" : "Recorded public consultations"} · ${consultas.length}`}
            flush
          >
            <RegulationList
              items={consultas as RegulationItem[]}
              lang={lang}
              empty={
                es
                  ? "No hay consultas públicas registradas."
                  : "No public consultations are recorded."
              }
            />
          </Panel>
          <div className="card mt-5 p-4">
            <div className="eyebrow mb-2">{es ? "Por institución" : "By institution"}</div>
            {byInstitution.length === 0 ? (
              <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                {es ? "No informado" : "Not reported"}
              </div>
            ) : (
              byInstitution.map((b) => (
                <div
                  key={b.key}
                  className="flex items-center justify-between border-b py-1.5 text-[13px] last:border-0"
                >
                  <span>{b.key}</span>
                  <span className="tnum font-semibold">{b.count}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card mt-6 p-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {es
          ? "Cada instrumento muestra únicamente la institución, el tipo, el estado, las fechas y el enlace informados por la fuente."
          : "Each instrument shows only the institution, type, status, dates, and link reported by the source."}
      </div>
    </AppShell>
  );
}
