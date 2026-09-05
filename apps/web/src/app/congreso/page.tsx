import type { Metadata } from "next";
import { getCongreso } from "@/lib/data";
import { parseLang, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { CongressRoster } from "@/components/congress-roster";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

type CongresoSearchParams = { lang?: string };

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<CongresoSearchParams>;
}): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  return lang === "es"
    ? {
        title: "Actores del Congreso",
        description: "Directorio de legisladores y composición de las comisiones del Congreso.",
      }
    : {
        title: "People and bodies in Congress",
        description: "Directory of legislators and congressional committee membership.",
      };
}

export default async function CongresoPage({
  searchParams,
}: {
  searchParams: Promise<CongresoSearchParams>;
}) {
  const lang: Lang = parseLang((await searchParams).lang);
  const es = lang === "es";
  const { legislators, commissions, parties, provinces } = await getCongreso();

  return (
    <AppShell
      lang={lang}
      title={es ? "Actores del Congreso" : "People and bodies in Congress"}
      subtitle={
        es
          ? "Encuentre legisladores y consulte la composición oficial de cada comisión"
          : "Find legislators and review the official membership of every committee"
      }
    >
      {legislators.length === 0 ? (
        <EmptyState
          lang={lang}
          title={
            es
              ? "El directorio legislativo aún no está disponible"
              : "The legislative directory is not available yet"
          }
          description={
            es
              ? "La composición del Congreso aparecerá aquí cuando termine una sincronización exitosa del roster. Los datos existentes no se eliminan si una fuente falla."
              : "Congress membership will appear here after a successful roster sync completes. Existing data is preserved when a source fails."
          }
        />
      ) : (
        <CongressRoster
          legislators={legislators}
          commissions={commissions}
          parties={parties}
          provinces={provinces}
          lang={lang}
        />
      )}
    </AppShell>
  );
}
