import { getRegulatoryOverview } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/dashboard";
import { RegulationList, StatTile, type RegulationItem } from "@/components/monitoring";

export const dynamic = "force-dynamic";

export default async function RegulatorioPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={kpis.total} label={es ? "Instrumentos monitoreados" : "Instruments monitored"} />
        <StatTile value={kpis.consultas} label={es ? "Consultas públicas abiertas" : "Open public consultations"} accent="#0b6e4f" />
        <StatTile value={kpis.highIntervention} label={es ? "Alta posibilidad de intervención" : "High possibility of intervention"} accent="#d97706" />
        <StatTile value={kpis.institutions} label={es ? "Instituciones con actividad" : "Institutions with activity"} accent="#8b5cf6" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title={es ? "Actividad regulatoria reciente" : "Recent regulatory activity"} flush>
            <RegulationList
              items={recent as RegulationItem[]}
              lang={lang}
              empty={es ? "Aún no hay normas ingestadas. Ejecuta npm run regulatory." : "No rules ingested yet. Run npm run regulatory."}
            />
          </Panel>
        </div>
        <div>
          <Panel title={`${es ? "Consultas públicas" : "Public consultations"} · ${consultas.length}`} flush
            action={<span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{es ? "oportunidad de intervenir" : "opportunity to intervene"}</span>}>
            <RegulationList
              items={consultas as RegulationItem[]}
              lang={lang}
              empty={es ? "Sin consultas públicas abiertas detectadas." : "No open public consultations detected."}
            />
          </Panel>
          <div className="card mt-5 p-4">
            <div className="eyebrow mb-2">{es ? "Por institución" : "By institution"}</div>
            {byInstitution.length === 0 ? (
              <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{es ? "Sin datos." : "No data."}</div>
            ) : byInstitution.map((b) => (
              <div key={b.key} className="flex items-center justify-between border-b py-1.5 text-[13px] last:border-0">
                <span>{b.key}</span><span className="tnum font-semibold">{b.count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt-6 p-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {es ? (
          <>
            <span className="font-semibold" style={{ color: "var(--text)" }}>Cómo leer la posibilidad de intervención:</span>{" "}
            <b style={{ color: "var(--accent)" }}>ALTA</b> = borrador o consulta pública (aún se puede influir) ·{" "}
            <b style={{ color: "var(--warn)" }}>MEDIA</b> = en revisión interna ·{" "}
            <b>BAJA</b> = ya publicada (tarde para intervenir). Fuentes activas: MISPAS, PROCONSUMIDOR, INDOTEL,
            INDOCAL, MICM, INTRANT — se irán sumando el resto de las ~36 instituciones del mapa regulatorio.
          </>
        ) : (
          <>
            <span className="font-semibold" style={{ color: "var(--text)" }}>How to read the possibility of intervention:</span>{" "}
            <b style={{ color: "var(--accent)" }}>HIGH</b> = draft or public consultation (you can still influence it) ·{" "}
            <b style={{ color: "var(--warn)" }}>MEDIUM</b> = under internal review ·{" "}
            <b>LOW</b> = already published (too late to intervene). Active sources: MISPAS, PROCONSUMIDOR, INDOTEL,
            INDOCAL, MICM, INTRANT — the remaining ~36 institutions of the regulatory map will be added over time.
          </>
        )}
      </div>
    </AppShell>
  );
}
