import { getCongreso } from "@/lib/data";
import type { Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { CongressRoster } from "@/components/congress-roster";

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
        <div className="card p-6 text-[13px]" style={{ color: "var(--text-muted)" }}>
          {es
            ? "Aún no hay datos del roster. Los datos se actualizan automáticamente."
            : "No roster data yet. Data refreshes automatically."}
        </div>
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
