import Link from "next/link";
import { langQuery, type Lang } from "@/lib/i18n";
import type { FeedAccount } from "@/lib/data";
import { safeHttpUrl } from "@/lib/input";

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
      <div className="card p-3.5">
        <div className="eyebrow mb-1">{es ? "Directorio de fuentes" : "Source directory"}</div>
        <p className="mb-2.5 text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {es
            ? "Fuentes y cuentas públicas activas registradas, en orden alfabético."
            : "Registered active sources and public accounts, in alphabetical order."}
        </p>
        {accounts.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {accounts.slice(0, 16).map((account) => {
              const kind = ACCOUNT_KIND[account.kind] ?? { es: account.kind, en: account.kind };
              const url = safeHttpUrl(account.url);
              if (!url) return null;
              return (
                <li key={account.id}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 rounded-lg px-1 py-1 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                      style={{ background: "var(--accent)" }}
                      aria-hidden
                    >
                      {account.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 leading-tight">
                      <span className="block truncate text-[12.5px] font-medium">{account.name}</span>
                      <span className="block truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {account.handle} · {es ? kind.es : kind.en}
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-3 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
            {es ? "No informado" : "Not reported"}
          </p>
        )}
        <Link
          href={`/feed?view=directory${q ? `&${q.slice(1)}` : ""}`}
          className="mt-2 block text-center text-[11.5px]"
          style={{ color: "var(--accent)" }}
        >
          {es ? "Directorio completo" : "Full directory"}
        </Link>
      </div>
    </aside>
  );
}
