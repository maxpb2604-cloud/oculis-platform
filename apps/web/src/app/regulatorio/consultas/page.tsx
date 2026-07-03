import { getConsultas } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/ui/panel";
import { RegulationList, StatTile, isConsultaOpen, type RegulationItem } from "@/components/monitoring";

export const dynamic = "force-dynamic";

export default async function ConsultasPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const es = lang === "es";
  // "Open" = comment deadline today or later (America/Santo_Domingo); no deadline = still open.
  // Same rule as the /regulatorio overview so both pages agree.
  const consultas = ((await getConsultas()) as RegulationItem[]).filter(isConsultaOpen);
  const byInst = new Set(consultas.map((c) => c.institution)).size;

  return (
    <AppShell
      lang={lang}
      title={es ? "Consultas Públicas" : "Public Consultations"}
      subtitle={
        es
          ? "Borradores de normas abiertos a comentarios — la ventana para intervenir"
          : "Draft rules open to comments — the window to intervene"
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile value={consultas.length} label={es ? "Consultas abiertas" : "Open consultations"} accent="#0b6e4f" />
        <StatTile value={byInst} label={es ? "Instituciones" : "Institutions"} accent="#8b5cf6" />
        <StatTile value={consultas.filter((c) => c.deadline).length} label={es ? "Con plazo identificado" : "With identified deadline"} accent="#d97706" />
      </div>
      <div className="mt-6">
        <Panel title={es ? "Consultas públicas abiertas" : "Open public consultations"} flush>
          <RegulationList
            items={consultas}
            lang={lang}
            empty={
              es
                ? "Sin consultas públicas detectadas todavía. A medida que se sumen instituciones, los borradores en consulta aparecerán aquí."
                : "No public consultations detected yet. As more institutions are added, draft rules under consultation will appear here."
            }
          />
        </Panel>
      </div>
      <p className="mt-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {es
          ? "Esta es la señal de mayor valor del monitoreo regulatorio: detectar una norma mientras es borrador/consulta — cuando todavía hay tiempo de presentar comentarios— en lugar de enterarse cuando ya está publicada."
          : "This is the highest-value signal of regulatory monitoring: detecting a rule while it is still a draft/consultation — when there is still time to submit comments — rather than learning about it once it is already published."}
      </p>
    </AppShell>
  );
}
