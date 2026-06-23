import { getRegulatoryOverview } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/dashboard";
import { RegulationList, StatTile, type RegulationItem } from "@/components/monitoring";

export const dynamic = "force-dynamic";

export default async function RegulatorioPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const { kpis, byInstitution, recent, consultas } = await getRegulatoryOverview();

  return (
    <AppShell lang={lang} title="Monitoreo Regulatorio" subtitle="Normas, resoluciones y consultas públicas de los órganos reguladores">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={kpis.total} label="Instrumentos monitoreados" />
        <StatTile value={kpis.consultas} label="Consultas públicas abiertas" accent="#0b6e4f" />
        <StatTile value={kpis.highIntervention} label="Alta posibilidad de intervención" accent="#d97706" />
        <StatTile value={kpis.institutions} label="Instituciones con actividad" accent="#8b5cf6" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Actividad regulatoria reciente" flush>
            <RegulationList items={recent as RegulationItem[]} empty="Aún no hay normas ingestadas. Ejecuta npm run regulatory." />
          </Panel>
        </div>
        <div>
          <Panel title={`Consultas públicas · ${consultas.length}`} flush
            action={<span className="text-[11px]" style={{ color: "var(--text-muted)" }}>oportunidad de intervenir</span>}>
            <RegulationList items={consultas as RegulationItem[]} empty="Sin consultas públicas abiertas detectadas." />
          </Panel>
          <div className="card mt-5 p-4">
            <div className="eyebrow mb-2">Por institución</div>
            {byInstitution.length === 0 ? (
              <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>Sin datos.</div>
            ) : byInstitution.map((b) => (
              <div key={b.key} className="flex items-center justify-between border-b py-1.5 text-[13px] last:border-0">
                <span>{b.key}</span><span className="tnum font-semibold">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt-6 p-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
        <span className="font-semibold" style={{ color: "var(--text)" }}>Cómo leer la posibilidad de intervención:</span>{" "}
        <b style={{ color: "var(--accent)" }}>ALTA</b> = borrador o consulta pública (aún se puede influir) ·{" "}
        <b style={{ color: "var(--warn)" }}>MEDIA</b> = en revisión interna ·{" "}
        <b>BAJA</b> = ya publicada (tarde para intervenir). Fuentes activas: MISPAS, PROCONSUMIDOR, INDOTEL,
        INDOCAL, MICM, INTRANT — se irán sumando el resto de las ~36 instituciones del mapa regulatorio.
      </div>
    </AppShell>
  );
}
