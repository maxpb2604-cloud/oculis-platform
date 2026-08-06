import { type Lang } from "@/lib/i18n";
import type { FeedAccount } from "@/lib/data";
import { safeHttpUrl } from "@/lib/input";

const KIND_LABEL: Record<string, { es: string; en: string }> = {
  SENADO_OFFICIAL: { es: "Senado", en: "Senate" },
  INSTITUTION: { es: "Institución", en: "Institution" },
  NEWSPAPER: { es: "Medio", en: "Outlet" },
  JOURNALIST: { es: "Periodista", en: "Journalist" },
  SENATOR: { es: "Senador/a", en: "Senator" },
  DEPUTY: { es: "Diputado/a", en: "Deputy" },
};

/**
 * Shown in the center column when the "Redes" (social) filter is active but no
 * posts exist yet (X/Instagram ingestion is credential-gated). Turns the empty state
 * into a browsable directory of active source and public-account records.
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
            ? "Las publicaciones de X e Instagram aparecerán aquí cuando se conecte la API. El directorio muestra las fuentes y cuentas públicas activas registradas, en orden alfabético."
            : "X and Instagram posts will appear here once the API is connected. The directory lists registered active sources and public accounts alphabetically."}
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
            const url = safeHttpUrl(a.url);
            if (!url) return null;
            return (
              <a
                key={a.id}
                href={url}
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
