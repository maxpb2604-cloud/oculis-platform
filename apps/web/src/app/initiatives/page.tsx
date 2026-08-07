import Link from "next/link";
import { browseInitiatives } from "@/lib/data";
import { dict, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Filters } from "@/components/filters";
import { InitiativesTable } from "@/components/initiatives-table";
import { boundedInteger, optionalText } from "@/lib/input";

export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const lang: Lang = sp.lang === "en" ? "en" : "es";
  const t = dict[lang];
  const page = boundedInteger(sp.page, { fallback: 1, min: 1, max: 10_000 });
  const pageSize = 50;

  const result = await browseInitiatives({
    search: optionalText(sp.search, 160),
    party: optionalText(sp.party, 64),
    status: optionalText(sp.status, 120),
    page,
    pageSize,
  });

  const pages = Math.max(1, Math.ceil(result.total / pageSize));
  const from = result.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, result.total);

  const hrefForPage = (p: number) => {
    const params = new URLSearchParams();
    for (const k of ["lang", "search", "party", "status"] as const) {
      if (sp[k]) params.set(k, sp[k]!);
    }
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/initiatives${qs ? `?${qs}` : ""}`;
  };

  return (
    <AppShell
      lang={lang}
      title={lang === "es" ? "Iniciativas" : "Initiatives"}
      subtitle={`${t.legislative} · ${t.source}`}
    >
      <Filters lang={lang} facets={result.facets} />

      <div
        className="mb-3 flex items-center justify-between text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        <span className="tnum">
          {lang === "es"
            ? `${result.total.toLocaleString()} iniciativas · mostrando ${from}–${to}`
            : `${result.total.toLocaleString()} initiatives · showing ${from}–${to}`}
        </span>
      </div>

      <div className="card overflow-hidden">
        <InitiativesTable rows={result.rows} lang={lang} />
      </div>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-1.5">
          <PageLink href={hrefForPage(page - 1)} disabled={page <= 1} label="‹" />
          <span className="tnum px-3 text-sm" style={{ color: "var(--text-muted)" }}>
            {page} / {pages}
          </span>
          <PageLink href={hrefForPage(page + 1)} disabled={page >= pages} label="›" />
        </nav>
      )}
    </AppShell>
  );
}

function PageLink({ href, disabled, label }: { href: string; disabled: boolean; label: string }) {
  if (disabled)
    return (
      <span className="rounded-lg border px-3 py-1.5 text-sm opacity-40" aria-disabled>
        {label}
      </span>
    );
  return (
    <Link
      href={href}
      className="rounded-lg border px-3 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]"
      style={{ cursor: "pointer" }}
    >
      {label}
    </Link>
  );
}
