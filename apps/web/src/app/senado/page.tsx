import { getChamberActivity } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/dashboard";
import { ActivityList, StatTile, type ActivityItem } from "@/components/monitoring";

export const dynamic = "force-dynamic";

export default async function SenadoPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const items = (await getChamberActivity("SENADO", 150)) as ActivityItem[];
  const pleno = items.filter((i) => i.scope === "PLENARY");
  const asamblea = items.filter((i) => i.scope === "ASAMBLEA");
  const comisiones = items.filter((i) => i.scope === "COMMITTEE");

  return (
    <AppShell lang={lang} title="Senado de la República" subtitle="Pleno, Asamblea y comisiones · actividad reciente">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={items.length} label="Actividades" />
        <StatTile value={pleno.length} label="Orden del día (Pleno)" accent="#3b82f6" />
        <StatTile value={asamblea.length} label="Asamblea" accent="#0d9488" />
        <StatTile value={comisiones.length} label="Agenda comisiones" accent="#8b5cf6" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel
          title={`Pleno y Asamblea · ${pleno.length + asamblea.length}`}
          flush
          action={<span className="text-[11px]" style={{ color: "var(--text-muted)" }}>órdenes del día publicadas</span>}
        >
          <ActivityList items={[...pleno, ...asamblea]} empty="Sin órdenes del día recientes." />
        </Panel>
        <Panel
          title={`Comisiones · ${comisiones.length}`}
          flush
          action={<span className="text-[11px]" style={{ color: "var(--text-muted)" }}>agendas semanales publicadas</span>}
        >
          <ActivityList items={comisiones} empty="Sin agendas de comisión recientes." />
        </Panel>
      </div>

      <div className="card mt-6 p-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
        <span className="font-semibold" style={{ color: "var(--text)" }}>Nota de cobertura:</span>{" "}
        el detalle por expediente (Sistema de Gestión de Expedientes Digitales) está protegido por reCAPTCHA y se
        marca como <span className="font-medium">pendiente de verificación</span> en Estado de monitoreo.
      </div>
    </AppShell>
  );
}
