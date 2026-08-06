import { getConsultas } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/report-ui";
import { RegulationList, StatTile, type RegulationItem } from "@/components/monitoring";

export const dynamic = "force-dynamic";

export default async function ConsultasPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const es = lang === "es";
  const consultas = (await getConsultas()) as RegulationItem[];
  const byInst = new Set(consultas.map((c) => c.institution)).size;

  return (
    <AppShell
      lang={lang}
      title={es ? "Consultas Públicas" : "Public Consultations"}
      subtitle={
        es
          ? "Borradores y consultas publicados por las instituciones monitoreadas"
          : "Drafts and consultations published by monitored institutions"
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          value={consultas.length}
          label={es ? "Consultas públicas registradas" : "Recorded public consultations"}
          accent="#0b6e4f"
        />
        <StatTile value={byInst} label={es ? "Instituciones" : "Institutions"} accent="#8b5cf6" />
        <StatTile
          value={consultas.filter((c) => c.deadline).length}
          label={es ? "Con plazo identificado" : "With identified deadline"}
          accent="#d97706"
        />
      </div>
      <div className="mt-6">
        <Panel
          title={es ? "Consultas públicas registradas" : "Recorded public consultations"}
          flush
        >
          <RegulationList
            items={consultas}
            lang={lang}
            empty={
              es
                ? "No hay consultas públicas registradas."
                : "No public consultations are recorded."
            }
          />
        </Panel>
      </div>
      <p className="mt-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {es
          ? "Los estados, plazos y enlaces se muestran tal como fueron registrados desde la fuente indicada."
          : "Statuses, deadlines, and links are shown as recorded from the indicated source."}
      </p>
    </AppShell>
  );
}
