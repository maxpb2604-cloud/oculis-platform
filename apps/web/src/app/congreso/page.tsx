import { getCongreso } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { CongressRoster } from "@/components/congress-roster";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function CongresoPage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const es = lang === "es";
  const { legislators, commissions, parties, provinces } = await getCongreso();

  return (
    <AppShell
      lang={lang}
      title={es ? "Congresistas" : "Congress members"}
      subtitle={
        es
          ? "Senadores y diputados por provincia, con su perfil y composición de comisiones"
          : "Senators and deputies by province, with their profile and committee composition"
      }
    >
      {legislators.length === 0 ? (
        <EmptyState
          lang={lang}
          title={es ? "El directorio legislativo aún no está disponible" : "The legislative directory is not available yet"}
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
