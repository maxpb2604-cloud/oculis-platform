import {
  getChamberActivity,
  getCommissionsWithMembers,
  getOfficialPublicationDocuments,
} from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { StatTile, type ActivityItem } from "@/components/monitoring";
import { AgendaBrowser } from "@/components/agenda-browser";
import { CommitteeBubbles } from "@/components/committee-bubbles";
import { OfficialPublications } from "@/components/official-publications";

export const dynamic = "force-dynamic";

export default async function DiputadosPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const es = lang === "es";
  const [items, members, publications] = await Promise.all([
    getChamberActivity("DIPUTADOS", 200) as Promise<ActivityItem[]>,
    getCommissionsWithMembers("DIPUTADOS"),
    getOfficialPublicationDocuments("DIPUTADOS"),
  ]);
  const pleno = items.filter((i) => i.scope === "PLENARY");
  const comisiones = items.filter((i) => i.scope === "COMMITTEE");

  return (
    <AppShell
      lang={lang}
      title={es ? "Cámara de Diputados" : "Chamber of Deputies"}
      subtitle={
        es ? "Pleno y comisiones · actividad reciente" : "Floor & committees · recent activity"
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile value={items.length} label={es ? "Actividades" : "Activities"} />
        <StatTile
          value={pleno.length}
          label={es ? "Órdenes del día (Pleno)" : "Floor agendas"}
          accent="#3b82f6"
        />
        <StatTile
          value={comisiones.length}
          label={es ? "Reuniones de comisión" : "Committee meetings"}
          accent="#8b5cf6"
        />
        <StatTile
          value={publications.length}
          label={es ? "Documentos oficiales mostrados" : "Official documents shown"}
        />
      </div>

      <div className="mt-7">
        <h2 className="serif mb-3 text-lg font-semibold">{es ? "Comisiones" : "Committees"}</h2>
        <CommitteeBubbles
          items={comisiones}
          lang={lang}
          chamber={es ? "Diputados" : "Deputies"}
          members={members}
        />
      </div>

      <div className="mt-8">
        <h2 className="serif mb-3 text-lg font-semibold">
          {es ? "Pleno · órdenes del día" : "Floor · agendas"}
        </h2>
        <AgendaBrowser
          lang={lang}
          sections={[{ key: "pleno", title: es ? "Órdenes del día" : "Agendas", items: pleno }]}
        />
      </div>

      <div className="mt-8">
        <h2 className="serif mb-1 text-lg font-semibold">
          {es ? "Publicaciones oficiales" : "Official publications"}
        </h2>
        <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
          {es
            ? "Una iniciativa incluida en una orden conocida queda enlazada a ese documento; esa aparición no se convierte en aprobación ni en otro estado legislativo."
            : "An initiative included in a considered order is linked to that document; the appearance is not converted into approval or another legislative status."}
        </p>
        <OfficialPublications items={publications} lang={lang} />
      </div>
    </AppShell>
  );
}
