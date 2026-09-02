import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { ExecutiveBriefing } from "@/components/dashboard";
import { CongressDirectoryPromo } from "@/components/congress-directory-promo";
import { HomeProvinceDashboard } from "@/components/home-province-dashboard";
import {
  getHomeDirectoryPromoData,
  getProvinceDashboardData,
  getRecentInitiativeMovements,
} from "@/lib/data";
import { parseLang, type Lang } from "@/lib/i18n";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ lang?: string }> };

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const es = (await searchParams).lang !== "en";
  return {
    title: es ? "Tablero inicial" : "Main Dashboard",
    description: es
      ? "Tablero inicial del Congreso Nacional, sus legisladores y las iniciativas con provincia publicada."
      : "Main dashboard for the National Congress, its legislators, and initiatives with a published province.",
  };
}

export default async function Page({ searchParams }: PageProps) {
  const lang: Lang = parseLang((await searchParams).lang);
  const es = lang === "es";

  const [provinceDashboard, directoryPromo, movements] = await Promise.all([
    getProvinceDashboardData(lang),
    getHomeDirectoryPromoData(),
    getRecentInitiativeMovements(8),
  ]);

  return (
    <AppShell
      lang={lang}
      title={es ? "Tablero inicial" : "Main Dashboard"}
      subtitle={es ? "Vista general del Congreso Nacional." : "Overview of the National Congress."}
    >
      <HomeProvinceDashboard lang={lang} provinces={provinceDashboard} />

      <div className="mt-12 sm:mt-16">
        <CongressDirectoryPromo
          portraits={directoryPromo.portraits}
          composition={directoryPromo.composition}
          lang={lang}
        />
      </div>

      <div className="mt-12 sm:mt-16">
        <ExecutiveBriefing lang={lang} movements={movements} />
      </div>

      <footer
        className="mt-12 flex flex-col gap-2 border-t pt-5 text-xs sm:flex-row sm:items-center sm:justify-between"
        style={{ color: "var(--text-muted)" }}
      >
        <span className="serif italic">
          {es ? "Evidencia oficial, sin predicciones." : "Official evidence, without predictions."}
        </span>
        <span>© {new Date().getFullYear()} Ferdinand Herrera Consultants · Oculis Auribus</span>
      </footer>
    </AppShell>
  );
}
