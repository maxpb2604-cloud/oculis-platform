import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { MapsGrid } from "@/components/maps-grid";
import { getInitiativesByProvince } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function MapasPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>;
}) {
  const sp = await searchParams;
  const lang: Lang = sp.lang === "en" ? "en" : "es";
  const es = lang === "es";
  const iniciativas = await getInitiativesByProvince();

  return (
    <AppShell
      lang={lang}
      title={es ? "Mapas — Borradores" : "Maps — Drafts"}
      subtitle={es ? "Tres bocetos de visualización geográfica con Mapbox" : "Three geographic visualization sketches with Mapbox"}
    >
      <div className="mb-5 rounded-xl border p-4" style={{ background: "var(--surface-2)", borderColor: "var(--border)" }}>
        <div className="eyebrow">{es ? "Propuesta visual" : "Visual proposal"}</div>
        <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
          {es
            ? "El primer mapa (Iniciativas por provincia) usa datos reales de la base. Los otros dos son borradores con datos ilustrativos."
            : "The first map (Initiatives by province) uses real data from the database. The other two are illustrative drafts."}
        </p>
      </div>

      <MapsGrid iniciativas={iniciativas} />
    </AppShell>
  );
}
