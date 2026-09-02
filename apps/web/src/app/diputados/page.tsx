import { getChamberActivity, getOfficialPublicationDocuments } from "@/lib/data";
import { parseLang, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { type ActivityItem } from "@/components/monitoring";
import { AgendaBrowser } from "@/components/agenda-browser";
import { CommitteeBubbles } from "@/components/committee-bubbles";
import { OfficialPublications } from "@/components/official-publications";
import { Kpi, SectionHeading } from "@/components/report-ui";
import { ButtonLink } from "@/components/ui/primitives";
import { ArrowRight, CalendarDots, UserList } from "@/components/ui/icons";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
type DiputadosSearchParams = { lang?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<DiputadosSearchParams>;
}): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  return lang === "es"
    ? {
        title: "Cámara de Diputados",
        description:
          "Actividad reciente, comisiones y publicaciones oficiales de la Cámara de Diputados.",
      }
    : {
        title: "Chamber of Deputies",
        description:
          "Recent activity, committees, and official publications from the Chamber of Deputies.",
      };
}

export default async function DiputadosPage({
  searchParams,
}: {
  searchParams: Promise<DiputadosSearchParams>;
}) {
  const lang: Lang = parseLang((await searchParams).lang);
  const es = lang === "es";
  const [items, publications] = await Promise.all([
    getChamberActivity("DIPUTADOS", 80) as Promise<ActivityItem[]>,
    getOfficialPublicationDocuments("DIPUTADOS"),
  ]);
  const pleno = items.filter((i) => i.scope === "PLENARY");
  const comisiones = items.filter((i) => i.scope === "COMMITTEE");
  const langSuffix = lang === "en" ? "&lang=en" : "";

  return (
    <AppShell
      lang={lang}
      title={es ? "Cámara de Diputados" : "Chamber of Deputies"}
      subtitle={
        es
          ? "Perfil institucional, actividad reciente y publicaciones oficiales"
          : "Institutional profile, recent activity, and official publications"
      }
    >
      <section className="grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="eyebrow text-[var(--accent)]">
            {es ? "Cámara legislativa" : "Legislative chamber"}
          </div>
          <h2 className="section-title mt-2 max-w-[28ch]">
            {es
              ? "Actividad oficial de la Cámara de Diputados, en un solo lugar"
              : "Official Chamber of Deputies activity in one place"}
          </h2>
          <p className="page-subtitle mt-3">
            {es
              ? "Consulte reuniones, órdenes del día y publicaciones sin convertir una aparición documental en un estado legislativo."
              : "Review meetings, agendas, and publications without converting a documentary mention into a legislative status."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/hoy?chamber=diputados${langSuffix}`} variant="primary">
            <CalendarDots size={18} aria-hidden="true" />
            {es ? "Ver agenda" : "View agenda"}
          </ButtonLink>
          <ButtonLink href={`/congreso?chamber=diputados&view=committees${langSuffix}`}>
            <UserList size={18} aria-hidden="true" />
            {es ? "Ver comisiones" : "View committees"}
          </ButtonLink>
        </div>
      </section>

      <div className="mt-8 grid gap-5 border-b pb-8 sm:grid-cols-3">
        <Kpi
          value={pleno.length}
          label={es ? "Órdenes del día" : "Floor agendas"}
          accent="var(--accent)"
        />
        <Kpi
          value={comisiones.length}
          label={es ? "Reuniones de comisión" : "Committee meetings"}
          accent="var(--verified)"
        />
        <Kpi
          value={publications.length}
          label={es ? "Publicaciones mostradas" : "Publications shown"}
          accent="var(--warn)"
        />
      </div>

      <div>
        <SectionHeading
          title={es ? "Comisiones" : "Committees"}
          description={
            es
              ? "Reuniones registradas y composición conocida"
              : "Recorded meetings and known membership"
          }
          action={
            <ButtonLink
              href={`/congreso?chamber=diputados&view=committees${langSuffix}`}
              variant="quiet"
            >
              {es ? "Abrir directorio" : "Open directory"}
              <ArrowRight size={17} aria-hidden="true" />
            </ButtonLink>
          }
        />
        <CommitteeBubbles
          items={comisiones}
          lang={lang}
          chamber={es ? "Diputados" : "Deputies"}
          showMembers={false}
        />
      </div>

      <div>
        <SectionHeading
          title={es ? "Órdenes del día del Pleno" : "Floor agendas"}
          description={
            es
              ? "Documentos oficiales asociados a sesiones del Pleno"
              : "Official documents associated with floor sessions"
          }
        />
        <AgendaBrowser
          lang={lang}
          sections={[{ key: "pleno", title: es ? "Órdenes del día" : "Agendas", items: pleno }]}
        />
      </div>

      <div>
        <SectionHeading title={es ? "Publicaciones oficiales" : "Official publications"} />
        <p className="mb-4 max-w-[78ch] text-sm text-[var(--text-muted)]">
          {es
            ? "Una iniciativa incluida en una orden conocida queda enlazada a ese documento; esa aparición no se convierte en aprobación ni en otro estado legislativo."
            : "An initiative included in a considered order is linked to that document; the appearance is not converted into approval or another legislative status."}
        </p>
        <OfficialPublications items={publications} lang={lang} />
      </div>
    </AppShell>
  );
}
