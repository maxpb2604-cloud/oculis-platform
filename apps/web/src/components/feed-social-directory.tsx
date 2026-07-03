import { type Lang } from "@/lib/i18n";
import type { FeedAccount } from "@/lib/data";

/** Registry-account kind → bilingual label. Shared with the right rail (FeedRail). */
export const KIND_LABEL: Record<string, { es: string; en: string }> = {
  SENADO_OFFICIAL: { es: "Senado", en: "Senate" },
  INSTITUTION: { es: "Institución", en: "Institution" },
  NEWSPAPER: { es: "Medio", en: "Outlet" },
  JOURNALIST: { es: "Periodista", en: "Journalist" },
  SENATOR: { es: "Senador/a", en: "Senator" },
  DEPUTY: { es: "Diputado/a", en: "Deputy" },
};

const PLATFORM_GLYPH: Record<string, string> = { X: "𝕏", INSTAGRAM: "◎", YOUTUBE: "▶", WEB: "🔗" };

/**
 * Shown in the center column when the "Redes" (social) filter is active but no live
 * posts exist yet (X/Instagram ingestion is credential-gated). Turns the empty state
 * into the useful browsable directory of influential accounts to follow.
 */
export function FeedSocialDirectory({ lang, accounts }: { lang: Lang; accounts: FeedAccount[] }) {
  const es = lang === "es";
  return (
    <div className="flex flex-col gap-4">
      <div className="card p-4" style={{ background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
        <div className="eyebrow mb-1" style={{ color: "var(--accent)" }}>
          {es ? "Redes sociales · directorio" : "Social media · directory"}
        </div>
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--text)" }}>
          {es
            ? "Las publicaciones en vivo de X e Instagram aparecerán aquí cuando se conecte la API. Por ahora, este es el directorio de cuentas influyentes del Congreso y la política dominicana — toca una para abrir su perfil."
            : "Live X and Instagram posts will appear here once the API is connected. For now, this is the directory of influential Congress & DR-politics accounts — tap one to open its profile."}
        </p>
      </div>

      {accounts.length === 0 ? (
        <div className="card p-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          {es ? "Directorio vacío." : "Directory is empty."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {accounts.map((a) => {
            const kind = KIND_LABEL[a.kind] ?? { es: a.kind, en: a.kind };
            return (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="card flex items-center gap-3 p-3 transition-shadow hover:shadow-lg"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
                  style={{ background: "var(--accent)" }}
                  aria-hidden
                >
                  {a.name.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13.5px] font-medium">{a.name}</span>
                  <span className="block truncate text-[12px]" style={{ color: "var(--text-muted)" }}>
                    {a.handle} · {es ? kind.es : kind.en}
                  </span>
                </span>
                <span className="shrink-0 text-[13px]" style={{ color: "var(--text-muted)" }} aria-hidden>
                  {PLATFORM_GLYPH[a.platform] ?? "🔗"}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
