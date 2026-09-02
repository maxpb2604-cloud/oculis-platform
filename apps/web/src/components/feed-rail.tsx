import Link from "next/link";
import { ArrowRight, ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { langQuery, type Lang } from "@/lib/i18n";
import type { FeedAccount } from "@/lib/data";
import { safeHttpUrl } from "@/lib/input";
import { NewTabNotice } from "@/components/ui/primitives";
import { LegislatorProfileTrigger } from "@/components/legislator-profile-provider";

const ACCOUNT_KIND: Record<string, { es: string; en: string }> = {
  SENADO_OFFICIAL: { es: "Senado", en: "Senate" },
  INSTITUTION: { es: "Institución", en: "Institution" },
  NEWSPAPER: { es: "Medio", en: "Outlet" },
  JOURNALIST: { es: "Periodista", en: "Journalist" },
  SENATOR: { es: "Senador/a", en: "Senator" },
  DEPUTY: { es: "Diputado/a", en: "Deputy" },
};

/** Alphabetical directory preview; no recommendation or influence ranking is exposed. */
export function FeedRail({ lang, accounts }: { lang: Lang; accounts: FeedAccount[] }) {
  const es = lang === "es";
  const q = langQuery(lang);

  return (
    <aside className="flex flex-col gap-4">
      <div className="rounded-lg border p-3.5">
        <div className="eyebrow mb-1">{es ? "Fuentes públicas" : "Public sources"}</div>
        <p className="mb-2.5 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {es
            ? "Instituciones, medios y cuentas públicas vinculadas al monitoreo del Congreso."
            : "Institutions, outlets, and public accounts connected to congressional monitoring."}
        </p>
        {accounts.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {accounts.slice(0, 6).map((account) => {
              const kind = ACCOUNT_KIND[account.kind] ?? { es: account.kind, en: account.kind };
              const url = safeHttpUrl(account.url);
              if (!url) return null;
              const personAccount = account.kind === "SENATOR" || account.kind === "DEPUTY";
              const accountContent = (
                <>
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: "var(--accent)" }}
                    aria-hidden
                  >
                    {account.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[12.5px] font-medium">{account.name}</span>
                    <span
                      className="block truncate text-[11px]"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {account.handle} · {es ? kind.es : kind.en}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={account.id} className="flex items-center gap-1">
                  {personAccount ? (
                    <>
                      <LegislatorProfileTrigger
                        profileId={account.legislatorProfileId}
                        fullName={account.name}
                        chamber={account.chamber}
                        role={es ? kind.es : kind.en}
                        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                      >
                        {accountContent}
                      </LegislatorProfileTrigger>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--accent)] hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                        aria-label={
                          es
                            ? `Abrir la cuenta pública de ${account.name} en una pestaña nueva`
                            : `Open ${account.name}'s public account in a new tab`
                        }
                      >
                        <ArrowSquareOut size={17} aria-hidden="true" />
                        <NewTabNotice lang={lang} />
                      </a>
                    </>
                  ) : (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-1 transition-colors hover:bg-[var(--surface-2)]"
                    >
                      {accountContent}
                      <NewTabNotice lang={lang} />
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-3 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
            {es ? "No hay cuentas públicas registradas." : "No public accounts are registered."}
          </p>
        )}
        <Link
          href={`/feed?view=directory${q ? `&${q.slice(1)}` : ""}`}
          className="mt-3 flex min-h-9 items-center justify-center gap-1 text-center text-[11.5px] font-semibold"
          style={{ color: "var(--accent)" }}
        >
          {es ? "Ver todas las fuentes" : "View all sources"}
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
    </aside>
  );
}
