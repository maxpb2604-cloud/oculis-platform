import { dict, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const lang: Lang = (await searchParams).lang === "en" ? "en" : "es";
  const t = dict[lang];
  return (
    <AppShell lang={lang} title={t.regulatory} subtitle={lang === "es" ? "Próximamente" : "Coming soon"}>
      <div className="card flex flex-col items-center justify-center gap-3 p-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--accent-soft)" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.6">
            <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="serif text-xl font-semibold">{t.regulatory}</h2>
        <p className="max-w-md text-sm" style={{ color: "var(--text-muted)" }}>
          {lang === "es"
            ? "El monitoreo de regulaciones de organismos del Poder Ejecutivo (MIMARENA, DGII, INTRANT, INDOTEL, entre otros) estará disponible en una próxima fase."
            : "Monitoring of regulations from Executive agencies (MIMARENA, DGII, INTRANT, INDOTEL, and others) will be available in an upcoming phase."}
        </p>
      </div>
    </AppShell>
  );
}
