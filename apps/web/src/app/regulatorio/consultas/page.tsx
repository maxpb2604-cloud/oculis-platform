import { getConsultas } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/dashboard";
import { RegulationList, StatTile, type RegulationItem } from "@/components/monitoring";

export const dynamic = "force-dynamic";

export default async function ConsultasPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const consultas = (await getConsultas()) as RegulationItem[];
  const byInst = new Set(consultas.map((c) => c.institution)).size;

  return (
    <AppShell lang={lang} title="Consultas Públicas" subtitle="Borradores de normas abiertos a comentarios — la ventana para intervenir">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile value={consultas.length} label="Consultas abiertas" accent="#0b6e4f" />
        <StatTile value={byInst} label="Instituciones" accent="#8b5cf6" />
        <StatTile value={consultas.filter((c) => c.deadline).length} label="Con plazo identificado" accent="#d97706" />
      </div>
      <div className="mt-6">
        <Panel title="Consultas públicas abiertas" flush>
          <RegulationList
            items={consultas}
            empty="Sin consultas públicas detectadas todavía. A medida que se sumen instituciones, los borradores en consulta aparecerán aquí."
          />
        </Panel>
      </div>
      <p className="mt-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
        Esta es la señal de mayor valor del monitoreo regulatorio: detectar una norma mientras es borrador/consulta —
        cuando todavía hay tiempo de presentar comentarios— en lugar de enterarse cuando ya está publicada.
      </p>
    </AppShell>
  );
}
