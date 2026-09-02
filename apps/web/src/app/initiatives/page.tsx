import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { browseInitiatives, getInitiativeCatalogLegislatorFilter } from "@/lib/data";
import { parseLang, type Lang } from "@/lib/i18n";
import { AppShell } from "@/components/app-shell";
import { Filters } from "@/components/filters";
import { InitiativesTable } from "@/components/initiatives-table";
import { boundedInteger, optionalText, parseLegislatorProfileId } from "@/lib/input";
import {
  initiativeCatalogPageHref,
  initiativeCatalogProvinceValues,
  type InitiativeCatalogSearchParams,
} from "./catalog-query";
import { toInitiativeCatalogRow } from "./catalog-row";

export const dynamic = "force-dynamic";

type SP = InitiativeCatalogSearchParams;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SP>;
}): Promise<Metadata> {
  const lang = parseLang((await searchParams).lang);
  return lang === "es"
    ? {
        title: "Iniciativas",
        description:
          "Busca iniciativas legislativas de República Dominicana y abre su estado, actores y evidencia oficial.",
      }
    : {
        title: "Initiatives",
        description:
          "Search Dominican legislative initiatives and review their status, participants, and official evidence.",
      };
}

export default async function Page({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const lang: Lang = parseLang(sp.lang);
  const page = boundedInteger(sp.page, { fallback: 1, min: 1, max: 10_000 });
  const pageSize = 30;
  const search = optionalText(sp.search, 160);
  const party = optionalText(sp.party, 64);
  const status = optionalText(sp.status, 120);
  const province = optionalText(sp.province, 80);
  const hasLegislatorFilter = sp.legislator !== undefined;
  const legislatorProfileId = hasLegislatorFilter ? parseLegislatorProfileId(sp.legislator) : null;
  if (hasLegislatorFilter && legislatorProfileId == null) notFound();
  const legislatorFilter =
    legislatorProfileId == null
      ? null
      : await getInitiativeCatalogLegislatorFilter(legislatorProfileId);
  if (legislatorProfileId != null && !legislatorFilter) notFound();
  const chamber = legislatorFilter?.chamber ?? optionalText(sp.chamber, 24);

  const result = await browseInitiatives({
    search,
    party,
    status,
    chamber,
    provinceValues: initiativeCatalogProvinceValues(province),
    proponentLegislatorProfileId: legislatorFilter?.profileId,
    page,
    pageSize,
  });
  const publicRows = result.rows.map((row) => toInitiativeCatalogRow(row, lang));

  const pages = Math.max(1, Math.ceil(result.total / pageSize));
  const from = result.total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, result.total);
  const resultCountLabel =
    lang === "es"
      ? `${result.total.toLocaleString()} ${result.total === 1 ? "iniciativa" : "iniciativas"}`
      : `${result.total.toLocaleString()} ${result.total === 1 ? "initiative" : "initiatives"}`;

  const normalizedCatalogSp: SP = {
    ...sp,
    chamber: legislatorFilter?.chamber ?? sp.chamber,
  };
  const hrefForPage = (nextPage: number) =>
    initiativeCatalogPageHref(normalizedCatalogSp, nextPage);
  const detailReturnTo = initiativeCatalogPageHref(normalizedCatalogSp, page);
  const hasAdditionalLegislatorFilters = Boolean(
    legislatorFilter && (search || party || status || province || page > 1),
  );
  const clearAdditionalFiltersHref =
    legislatorFilter && hasAdditionalLegislatorFilters
      ? initiativeCatalogPageHref(
          {
            lang: lang === "en" ? "en" : undefined,
            chamber: legislatorFilter.chamber,
            legislator: String(legislatorFilter.profileId),
          },
          1,
        )
      : null;

  return (
    <AppShell
      lang={lang}
      title={lang === "es" ? "Iniciativas" : "Initiatives"}
      subtitle={
        lang === "es"
          ? "Busca proyectos y resoluciones con su evidencia oficial"
          : "Find bills and resolutions with their official evidence"
      }
    >
      <div className="mb-5 max-w-3xl">
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {lang === "es"
            ? "Consulta qué propone cada iniciativa, su estado publicado, quién la presentó y los documentos que la fuente oficial permite abrir."
            : "See what each initiative proposes, its published status, who filed it, and the documents the official source allows you to open."}
        </p>
      </div>
      <Filters
        lang={lang}
        facets={result.facets}
        legislatorFilter={
          legislatorFilter
            ? {
                profileId: legislatorFilter.profileId,
                fullName: legislatorFilter.fullName,
                chamber: legislatorFilter.chamber,
              }
            : null
        }
      />

      <div
        className="mb-3 flex flex-wrap items-end justify-between gap-2"
        style={{ color: "var(--text-muted)" }}
        aria-live="polite"
      >
        <div>
          <h2 className="serif text-lg font-semibold" style={{ color: "var(--text)" }}>
            {lang === "es" ? "Resultados" : "Results"}
          </h2>
          <span className="tnum mt-0.5 block text-xs">
            {lang === "es"
              ? `${resultCountLabel} · mostrando ${from}–${to}`
              : `${resultCountLabel} · showing ${from}–${to}`}
          </span>
        </div>
        <span className="text-xs">
          {lang === "es" ? "Ordenadas por depósito más reciente" : "Newest filings first"}
        </span>
      </div>

      <InitiativesTable
        rows={publicRows}
        lang={lang}
        legislatorFilter={
          legislatorFilter
            ? {
                profileId: legislatorFilter.profileId,
                fullName: legislatorFilter.fullName,
                chamber: legislatorFilter.chamber,
              }
            : null
        }
        detailReturnTo={detailReturnTo}
        clearAdditionalFiltersHref={clearAdditionalFiltersHref}
      />

      {pages > 1 && (
        <nav
          aria-label={lang === "es" ? "Paginación de iniciativas" : "Initiatives pagination"}
          className="mt-4 flex items-center justify-center gap-1.5"
        >
          <PageLink
            href={hrefForPage(page - 1)}
            disabled={page <= 1}
            direction="previous"
            ariaLabel={lang === "es" ? "Página anterior" : "Previous page"}
            label={lang === "es" ? "Anterior" : "Previous"}
          />
          <span
            aria-current="page"
            className="tnum px-3 text-sm"
            style={{ color: "var(--text-muted)" }}
          >
            {page} / {pages}
          </span>
          <PageLink
            href={hrefForPage(page + 1)}
            disabled={page >= pages}
            direction="next"
            ariaLabel={lang === "es" ? "Página siguiente" : "Next page"}
            label={lang === "es" ? "Siguiente" : "Next"}
          />
        </nav>
      )}
    </AppShell>
  );
}

function PageLink({
  href,
  disabled,
  label,
  ariaLabel,
  direction,
}: {
  href: string;
  disabled: boolean;
  label: string;
  ariaLabel: string;
  direction: "previous" | "next";
}) {
  const icon =
    direction === "previous" ? (
      <CaretLeft aria-hidden size={15} weight="bold" />
    ) : (
      <CaretRight aria-hidden size={15} weight="bold" />
    );
  if (disabled)
    return (
      <span
        aria-label={ariaLabel}
        className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold opacity-40"
        aria-disabled
      >
        {direction === "previous" && icon}
        <span className="hidden sm:inline">{label}</span>
        {direction === "next" && icon}
      </span>
    );
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]"
      style={{ cursor: "pointer" }}
    >
      {direction === "previous" && icon}
      <span className="hidden sm:inline">{label}</span>
      {direction === "next" && icon}
    </Link>
  );
}
