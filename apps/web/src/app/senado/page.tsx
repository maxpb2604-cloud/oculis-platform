import { getChamberActivity } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { StatTile, type ActivityItem } from "@/components/monitoring";
import { AgendaBrowser } from "@/components/agenda-browser";
import { CommitteeBubbles } from "@/components/committee-bubbles";

export const dynamic = "force-dynamic";

export default async function SenadoPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const es = lang === "es";
  const items = (await getChamberActivity("SENADO", 200)) as ActivityItem[];
  const pleno = items.filter((i) => i.scope === "PLENARY");
  const asamblea = items.filter((i) => i.scope === "ASAMBLEA");
  const comisiones = items.filter((i) => i.scope === "COMMITTEE");

  return (
    <AppShell lang={lang} title="Senado de la República" subtitle={es ? "Pleno, Asamblea y comisiones · actividad reciente" : "Floor, Assembly & committees · recent activity"}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={items.length} label={es ? "Actividades" : "Activities"} />
        <StatTile value={pleno.length} label={es ? "Orden del día (Pleno)" : "Floor agenda"} accent="#3b82f6" />
        <StatTile value={asamblea.length} label="Asamblea" accent="#0d9488" />
        <StatTile value={comisiones.length} label={es ? "Agenda comisiones" : "Committee agendas"} accent="#8b5cf6" />
      </div>

      <div className="mt-7">
        <h2 className="serif mb-3 text-lg font-semibold">{es ? "Comisiones" : "Committees"}</h2>
        <CommitteeBubbles items={comisiones} lang={lang} chamber="Senado" />
      </div>

      <div className="mt-8">
        <h2 className="serif mb-3 text-lg font-semibold">{es ? "Pleno y Asamblea" : "Floor & Assembly"}</h2>
        <AgendaBrowser
          lang={lang}
          sections={[{ key: "pleno", title: es ? "Órdenes del día" : "Agendas", items: [...pleno, ...asamblea] }]}
        />
      </div>

      <div className="card mt-6 p-4 text-[12px]" style={{ color: "var(--text-muted)" }}>
        <span className="font-semibold" style={{ color: "var(--text)" }}>{es ? "Nota de cobertura:" : "Coverage note:"}</span>{" "}
        {es
          ? "el detalle por expediente (Sistema de Gestión de Expedientes Digitales) está protegido por reCAPTCHA y se marca como pendiente de verificación."
          : "per-file detail (Digital Records System) is protected by reCAPTCHA and is flagged as pending verification."}
      </div>
    </AppShell>
  );
}
