import { getChamberActivity } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Panel } from "@/components/dashboard";
import { ActivityList, StatTile, type ActivityItem } from "@/components/monitoring";

export const dynamic = "force-dynamic";

export default async function DiputadosPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const items = (await getChamberActivity("DIPUTADOS", 150)) as ActivityItem[];
  const pleno = items.filter((i) => i.scope === "PLENARY");
  const comisiones = items.filter((i) => i.scope === "COMMITTEE");

  return (
    <AppShell lang={lang} title="Cámara de Diputados" subtitle="Pleno y comisiones · actividad reciente">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile value={items.length} label="Actividades" />
        <StatTile value={pleno.length} label="Órdenes del día (Pleno)" accent="#3b82f6" />
        <StatTile value={comisiones.length} label="Reuniones de comisión" accent="#8b5cf6" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title={`Pleno · órdenes del día · ${pleno.length}`} flush>
          <ActivityList items={pleno} empty="Sin órdenes del día recientes." />
        </Panel>
        <Panel title={`Comisiones · ${comisiones.length}`} flush>
          <ActivityList items={comisiones} empty="Sin reuniones de comisión recientes." />
        </Panel>
      </div>
    </AppShell>
  );
}
