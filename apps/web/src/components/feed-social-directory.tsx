import { type Lang } from "@/lib/i18n";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import type { FeedAccount } from "@/lib/data";
import { safeHttpUrl } from "@/lib/input";
import { NewTabNotice } from "@/components/ui/primitives";
import { LegislatorProfileTrigger } from "@/components/legislator-profile-provider";

const KIND_LABEL: Record<string, { es: string; en: string }> = {
  SENADO_OFFICIAL: { es: "Senado", en: "Senate" },
  INSTITUTION: { es: "Institución", en: "Institution" },
  NEWSPAPER: { es: "Medio", en: "Outlet" },
  JOURNALIST: { es: "Periodista", en: "Journalist" },
  SENATOR: { es: "Senador/a", en: "Senator" },
  DEPUTY: { es: "Diputado/a", en: "Deputy" },
};

/**
 * Shown when public-account updates are unavailable. The customer can still open
 * the exact public accounts without seeing operational or credential details.
 */
export function FeedSocialDirectory({ lang, accounts }: { lang: Lang; accounts: FeedAccount[] }) {
  const es = lang === "es";
  return (
    <div className="flex flex-col gap-4">
      <div
        className="card p-4"
        style={{ background: "var(--accent-soft)", borderColor: "var(--accent)" }}
      >
        <div className="eyebrow mb-1" style={{ color: "var(--accent)" }}>
          {es ? "Directorio de fuentes" : "Source directory"}
        </div>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--text)" }}>
          {es
            ? "Todavía no hay publicaciones disponibles en esta vista. Puedes consultar directamente las cuentas públicas incluidas por Oculis."
            : "No posts are available in this view yet. You can open the public accounts included by Oculis directly."}
        </p>
      </div>

      {accounts.length === 0 ? (
        <div className="card p-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          {es
            ? "Todavía no hay cuentas públicas disponibles."
            : "No public accounts are available yet."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {accounts.map((a) => {
            const kind = KIND_LABEL[a.kind] ?? { es: a.kind, en: a.kind };
            const url = safeHttpUrl(a.url);
            if (!url) return null;
            const personAccount = a.kind === "SENATOR" || a.kind === "DEPUTY";
            const accountContent = (
              <>
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                  style={{ background: "var(--accent)" }}
                  aria-hidden
                >
                  {a.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13.5px] font-medium">{a.name}</span>
                  <span
                    className="block truncate text-[12px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {a.handle} · {es ? kind.es : kind.en}
                  </span>
                </span>
                <span
                  className="shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ color: "var(--text-muted)" }}
                >
                  {platformLabel(a.platform)}
                </span>
              </>
            );
            if (personAccount) {
              return (
                <div key={a.id} className="card flex min-w-0 items-center gap-1 p-1.5">
                  <LegislatorProfileTrigger
                    profileId={a.legislatorProfileId}
                    fullName={a.name}
                    chamber={a.chamber}
                    role={es ? kind.es : kind.en}
                    className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5 text-left transition-colors hover:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
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
                        ? `Abrir la cuenta pública de ${a.name} en una pestaña nueva`
                        : `Open ${a.name}'s public account in a new tab`
                    }
                  >
                    <ArrowSquareOut size={18} aria-hidden="true" />
                    <NewTabNotice lang={lang} />
                  </a>
                </div>
              );
            }
            return (
              <a
                key={a.id}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="card flex items-center gap-3 p-3 transition-shadow hover:shadow-lg"
              >
                {accountContent}
                <NewTabNotice lang={lang} />
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

function platformLabel(platform: string): string {
  if (platform === "INSTAGRAM") return "Instagram";
  if (platform === "YOUTUBE") return "YouTube";
  if (platform === "X") return "X";
  return platform === "WEB" ? "Web" : platform;
}
