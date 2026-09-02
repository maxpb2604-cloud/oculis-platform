"use client";

/**
 * Congresistas browser. A ChamberToggle (same control as the "Hoy" page) switches the
 * whole view between Senado and Diputados — each chamber is its own window. Within a
 * chamber there are two sub-views: "Legisladores" (grouped by province, filterable) and
 * "Comisiones" (each committee's composition). Clicking any legislator opens a profile
 * modal with their photo, bio, contact, committee seats and official profile link.
 */
import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChamberToggle, type Chamber } from "@/components/ui/chamber-toggle";
import { LegislatorProfileTrigger } from "@/components/legislator-profile-provider";
import { Button, SelectField, StatusPill } from "@/components/ui/primitives";
import {
  ArrowRight,
  Buildings,
  CalendarDots,
  MagnifyingGlass,
  UserList,
  X,
} from "@/components/ui/icons";
import type { CongressCommission, LegislatorSummary } from "@/lib/data";
import { activityDetailHref } from "@/lib/activity-links";
import { formatISODate, formatOfficialTime } from "@/lib/format";
import { partyColor, partyDisplayLabel } from "@/lib/party-presentation";

function chamberLabel(chamber: string, es: boolean, long = false): string {
  if (chamber === "SENADO") {
    return es ? (long ? "Senador/a de la República" : "Senador/a") : "Senator";
  }
  if (chamber === "DIPUTADOS") return es ? "Diputado/a" : "Deputy";
  return chamber || (es ? "No informado" : "Not reported");
}

function chamberName(chamber: string, es: boolean): string {
  if (chamber === "SENADO") return es ? "Senado" : "Senate";
  if (chamber === "DIPUTADOS") return es ? "Cámara de Diputados" : "Chamber of Deputies";
  return chamber || (es ? "No informado" : "Not reported");
}

type Tab = "legisladores" | "comisiones";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Cargo accent colors, keyed to theme-aware CSS vars so they read in light + dark mode.
const CARGO_COLOR: Record<string, string> = {
  Presidente: "var(--verified)",
  Vicepresidente: "var(--accent)",
  Secretario: "var(--accent)",
};
const CARGO_SOFT: Record<string, string> = {
  Presidente: "var(--verified-soft)",
  Vicepresidente: "var(--accent-soft)",
  Secretario: "var(--accent-soft)",
};

export function CongressRoster({
  legislators,
  commissions,
  parties,
  provinces,
  lang,
}: {
  legislators: LegislatorSummary[];
  commissions: CongressCommission[];
  parties: string[];
  provinces: string[];
  lang: "es" | "en";
}) {
  const es = lang === "es";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [chamberSel, setChamberSel] = useState<Chamber>(() =>
    searchParams.get("chamber") === "diputados" ? "diputados" : "senadores",
  );
  const chamber = chamberSel === "senadores" ? "SENADO" : "DIPUTADOS";
  const [tab, setTab] = useState<Tab>(() =>
    searchParams.get("view") === "committees" ? "comisiones" : "legisladores",
  );
  const [province, setProvince] = useState<string>(() => {
    const requested = searchParams.get("province");
    return requested && provinces.includes(requested) ? requested : "ALL";
  });
  const [party, setParty] = useState<string>(() => {
    const requested = searchParams.get("party");
    return requested && parties.includes(requested) ? requested : "ALL";
  });
  const [q, setQ] = useState("");

  const replaceQuery = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value) params.delete(key);
        else params.set(key, value);
      }
      const query = params.toString();
      router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const inChamber = useMemo(
    () => legislators.filter((l) => l.chamber === chamber),
    [legislators, chamber],
  );
  const chamberProvinces = useMemo(
    () => provinces.filter((p) => inChamber.some((l) => l.province === p)),
    [provinces, inChamber],
  );
  const chamberParties = useMemo(
    () => parties.filter((p) => inChamber.some((l) => l.party === p)),
    [parties, inChamber],
  );

  const filtered = useMemo(() => {
    const needle = norm(q.trim());
    return inChamber.filter((l) => {
      if (province !== "ALL" && l.province !== province) return false;
      if (party !== "ALL" && l.party !== party) return false;
      if (needle && !norm(l.fullName).includes(needle)) return false;
      return true;
    });
  }, [inChamber, province, party, q]);

  const groups = useMemo(() => {
    const map = new Map<string, LegislatorSummary[]>();
    for (const l of filtered) {
      const key = l.province ?? (es ? "En el Exterior / sin provincia" : "Overseas / no province");
      (map.get(key) ?? map.set(key, []).get(key)!).push(l);
    }
    return [...map.entries()].sort((a, b) => {
      const ax = /Exterior|Overseas/.test(a[0]) ? 1 : 0;
      const bx = /Exterior|Overseas/.test(b[0]) ? 1 : 0;
      return ax - bx || a[0].localeCompare(b[0], "es");
    });
  }, [filtered, es]);

  const filteredCommissions = useMemo(() => {
    const needle = norm(q.trim());
    return commissions.filter((c) => {
      if (c.chamber !== chamber) return false;
      if (!needle) return true;
      return (
        norm(c.name).includes(needle) ||
        c.members.some((member) => norm(member.fullName).includes(needle))
      );
    });
  }, [commissions, chamber, q]);
  const chamberCommissionCount = useMemo(
    () => commissions.filter((commission) => commission.chamber === chamber).length,
    [commissions, chamber],
  );
  const hasActiveFilters =
    q.trim().length > 0 || (tab === "legisladores" && (province !== "ALL" || party !== "ALL"));
  const resultCount = tab === "legisladores" ? filtered.length : filteredCommissions.length;

  const clearFilters = () => {
    setQ("");
    setProvince("ALL");
    setParty("ALL");
    replaceQuery({ province: null, party: null });
  };

  return (
    <div className="space-y-8">
      <section className="grid gap-6 border-b pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <div className="eyebrow text-[var(--accent)]">
            {es ? "Cómo usar este directorio" : "How to use this directory"}
          </div>
          <h2 className="section-title mt-2 max-w-[30ch]">
            {es
              ? "Busque una persona o vaya directo a una comisión"
              : "Search for a person or go straight to a committee"}
          </h2>
          <p className="page-subtitle mt-3">
            {es
              ? "Elija una cámara y luego el tipo de información. Dentro de cada comisión verá únicamente las agendas vinculadas por nombre completo y cámara, sin coincidencias aproximadas."
              : "Choose a chamber and then the type of information. Each committee shows only agendas linked by full name and chamber, without approximate matches."}
          </p>
        </div>
        <div className="min-w-0">
          <div className="eyebrow mb-2">{es ? "Elija una cámara" : "Choose a chamber"}</div>
          <ChamberToggle
            value={chamberSel}
            onChange={(value) => {
              setChamberSel(value);
              setQ("");
              setProvince("ALL");
              setParty("ALL");
              replaceQuery({
                chamber: value === "diputados" ? "diputados" : null,
                province: null,
                party: null,
              });
            }}
            lang={lang}
          />
          <p className="mt-2 text-xs text-[var(--text-muted)]" aria-live="polite">
            {inChamber.length}{" "}
            {chamber === "SENADO"
              ? es
                ? "senadores registrados"
                : "registered senators"
              : es
                ? "diputados registrados"
                : "registered deputies"}
          </p>
        </div>
      </section>

      <section aria-labelledby="directory-choice-heading">
        <h2 id="directory-choice-heading" className="section-title">
          {es ? "¿Qué desea consultar?" : "What would you like to find?"}
        </h2>
        <div
          role="group"
          aria-label={es ? "Tipo de directorio" : "Directory type"}
          className="mt-4 grid gap-3 sm:grid-cols-2"
        >
          <DirectoryChoice
            active={tab === "legisladores"}
            icon={<UserList size={22} aria-hidden="true" />}
            title={es ? "Legisladores" : "Legislators"}
            description={
              es
                ? `${inChamber.length} personas · perfil, provincia, partido y comisiones`
                : `${inChamber.length} people · profile, province, party, and committees`
            }
            onClick={() => {
              setTab("legisladores");
              setQ("");
              replaceQuery({ view: null });
            }}
          />
          <DirectoryChoice
            active={tab === "comisiones"}
            icon={<Buildings size={22} aria-hidden="true" />}
            title={es ? "Comisiones" : "Committees"}
            description={
              es
                ? `${chamberCommissionCount} órganos · integrantes y agendas exactas vinculadas`
                : `${chamberCommissionCount} bodies · members and exact linked agendas`
            }
            onClick={() => {
              setTab("comisiones");
              setQ("");
              replaceQuery({ view: "committees" });
            }}
          />
        </div>
      </section>

      <section aria-labelledby="directory-results-heading" className="border-t pt-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="eyebrow">{chamberName(chamber, es)}</div>
            <h2 id="directory-results-heading" className="section-title mt-1.5">
              {tab === "legisladores"
                ? es
                  ? "Directorio de legisladores"
                  : "Legislator directory"
                : es
                  ? "Directorio de comisiones"
                  : "Committee directory"}
            </h2>
          </div>
          <p className="text-sm text-[var(--text-muted)]" aria-live="polite" aria-atomic="true">
            {es ? "Mostrando" : "Showing"}{" "}
            <strong className="text-[var(--text)]">{resultCount}</strong>{" "}
            {tab === "legisladores"
              ? es
                ? resultCount === 1
                  ? "legislador"
                  : "legisladores"
                : resultCount === 1
                  ? "legislator"
                  : "legislators"
              : es
                ? resultCount === 1
                  ? "comisión"
                  : "comisiones"
                : resultCount === 1
                  ? "committee"
                  : "committees"}
          </p>
        </div>

        <div className="card mt-5 p-4 sm:p-5">
          <div
            className={`grid min-w-0 gap-4 ${tab === "legisladores" ? "md:grid-cols-3" : "md:grid-cols-2"}`}
          >
            <label htmlFor="congress-roster-search" className="block min-w-0">
              <span className="eyebrow mb-1.5 block">
                {tab === "legisladores"
                  ? es
                    ? "Nombre del legislador"
                    : "Legislator name"
                  : es
                    ? "Nombre de la comisión o integrante"
                    : "Committee or member name"}
              </span>
              <span className="relative block">
                <MagnifyingGlass
                  size={18}
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
                />
                <input
                  id="congress-roster-search"
                  type="search"
                  value={q}
                  onChange={(event) => setQ(event.target.value)}
                  placeholder={
                    tab === "legisladores"
                      ? es
                        ? "Ej.: María Pérez"
                        : "E.g. Maria Perez"
                      : es
                        ? "Ej.: Comisión de justicia"
                        : "E.g. Justice committee"
                  }
                  className="ui-input min-w-0 pl-10"
                />
              </span>
            </label>
            {tab === "legisladores" && (
              <>
                <SelectField
                  id="congress-province-filter"
                  label={es ? "Provincia" : "Province"}
                  value={province}
                  onChange={(event) => {
                    const value = event.target.value;
                    setProvince(value);
                    replaceQuery({ province: value === "ALL" ? null : value });
                  }}
                >
                  <option value="ALL">{es ? "Todas las provincias" : "All provinces"}</option>
                  {chamberProvinces.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </SelectField>
                <SelectField
                  id="congress-party-filter"
                  label={es ? "Partido" : "Party"}
                  value={party}
                  onChange={(event) => {
                    const value = event.target.value;
                    setParty(value);
                    replaceQuery({ party: value === "ALL" ? null : value });
                  }}
                >
                  <option value="ALL">{es ? "Todos los partidos" : "All parties"}</option>
                  {chamberParties.map((option) => (
                    <option key={option} value={option}>
                      {partyDisplayLabel(option, null, lang)}
                    </option>
                  ))}
                </SelectField>
              </>
            )}
          </div>
          {hasActiveFilters && (
            <div className="mt-4 border-t pt-3">
              <Button type="button" variant="quiet" onClick={clearFilters}>
                <X size={17} aria-hidden="true" />
                {es ? "Limpiar búsqueda y filtros" : "Clear search and filters"}
              </Button>
            </div>
          )}
        </div>

        {tab === "legisladores" ? (
          <div className="mt-7 space-y-8">
            {groups.map(([prov, members]) => (
              <section key={prov}>
                <div className="mb-3 flex items-baseline gap-2 border-b pb-2">
                  <h3 className="serif text-lg font-semibold">{prov}</h3>
                  <span className="text-xs text-[var(--text-muted)]">{members.length}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {members
                    .slice()
                    .sort((a, b) => a.fullName.localeCompare(b.fullName))
                    .map((l) => (
                      <LegCard key={l.profileId} l={l} es={es} />
                    ))}
                </div>
              </section>
            ))}
            {groups.length === 0 && (
              <NoResults
                es={es}
                title={
                  hasActiveFilters
                    ? es
                      ? "No encontramos legisladores"
                      : "No legislators found"
                    : es
                      ? "No hay legisladores registrados en esta cámara"
                      : "No legislators are recorded for this chamber"
                }
                description={
                  hasActiveFilters
                    ? es
                      ? "Pruebe otro nombre o quite alguno de los filtros."
                      : "Try another name or remove one of the filters."
                    : es
                      ? "Oculis todavía no tiene un directorio verificable para esta selección."
                      : "Oculis does not yet have a verifiable directory for this selection."
                }
                showClear={hasActiveFilters}
                onClear={clearFilters}
              />
            )}
          </div>
        ) : (
          <div className="mt-7 space-y-3">
            {filteredCommissions.map((c) => (
              <CommissionCard key={`${c.chamber}-${c.name}`} c={c} es={es} />
            ))}
            {filteredCommissions.length === 0 && (
              <NoResults
                es={es}
                title={
                  hasActiveFilters
                    ? es
                      ? "No encontramos comisiones"
                      : "No committees found"
                    : es
                      ? "No hay comisiones registradas en esta cámara"
                      : "No committees are recorded for this chamber"
                }
                description={
                  hasActiveFilters
                    ? es
                      ? "Pruebe el nombre oficial completo o busque por uno de sus integrantes."
                      : "Try the full official name or search for one of its members."
                    : es
                      ? "Oculis todavía no tiene composición verificable para esta selección."
                      : "Oculis does not yet have verifiable membership for this selection."
                }
                showClear={hasActiveFilters}
                onClear={clearFilters}
              />
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function DirectoryChoice({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className="card flex min-h-24 w-full items-start gap-3 p-4 text-left transition-colors hover:border-[var(--accent)]"
      style={{
        borderColor: active ? "var(--accent)" : "var(--border)",
        background: active ? "var(--accent-soft)" : "var(--surface)",
      }}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)]"
        style={{
          color: active ? "var(--accent)" : "var(--text-muted)",
          background: active ? "var(--surface)" : "var(--surface-2)",
        }}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--text)]">{title}</span>
        <span className="mt-1 block text-xs leading-relaxed text-[var(--text-muted)]">
          {description}
        </span>
      </span>
      <ArrowRight size={18} aria-hidden="true" className="mt-1 shrink-0 text-[var(--text-muted)]" />
    </button>
  );
}

function NoResults({
  es,
  title,
  description,
  showClear,
  onClear,
}: {
  es: boolean;
  title: string;
  description: string;
  showClear: boolean;
  onClear: () => void;
}) {
  return (
    <div className="card border-dashed px-5 py-8 text-center" role="status">
      <MagnifyingGlass size={28} aria-hidden="true" className="mx-auto text-[var(--text-muted)]" />
      <h3 className="serif mt-3 text-lg font-semibold">{title}</h3>
      <p className="mx-auto mt-1.5 max-w-lg text-sm text-[var(--text-muted)]">{description}</p>
      {showClear && (
        <Button type="button" variant="quiet" className="mt-4" onClick={onClear}>
          <X size={17} aria-hidden="true" />
          {es ? "Limpiar filtros" : "Clear filters"}
        </Button>
      )}
    </div>
  );
}

function LegCard({ l, es }: { l: LegislatorSummary; es: boolean }) {
  const memberType = chamberLabel(l.chamber, es);
  const sub = l.role;
  const lang = es ? "es" : "en";
  const party = partyDisplayLabel(l.party, null, lang);
  const color = partyColor(l.party);
  return (
    <LegislatorProfileTrigger
      profileId={l.profileId}
      fullName={l.fullName}
      chamber={l.chamber}
      role={l.role}
      party={l.party}
      province={l.province}
      ariaLabel={
        es ? `Abrir perfil de ${l.fullName}, ${party}` : `Open ${l.fullName}'s profile, ${party}`
      }
      className="card min-h-24 w-full p-4 text-left transition-colors hover:border-[var(--accent)]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-snug">{l.fullName}</div>
          <div className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
            {memberType}
            {sub ? ` · ${sub}` : ""}
          </div>
        </div>
        {l.party && (
          <span className="shrink-0">
            <StatusPill>
              <span
                aria-hidden="true"
                className="mr-1.5 inline-block h-2 w-2 rounded-full"
                style={{ background: color }}
              />
              {party}
            </StatusPill>
          </span>
        )}
      </div>
      <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
        {es ? "Ver perfil" : "View profile"}
        <ArrowRight size={15} aria-hidden="true" />
      </span>
    </LegislatorProfileTrigger>
  );
}

function CommissionCard({ c, es }: { c: CongressCommission; es: boolean }) {
  const [open, setOpen] = useState(false);
  const lang = es ? "es" : "en";
  // Older server-rendered payloads can remain in a browser during a rolling deploy.
  const agendas = [...(c.agendas ?? [])].sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  const panelId = `commission-${c.chamber.toLowerCase()}-${norm(c.name).replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <article className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-20 w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-[var(--surface-2)] sm:px-5"
      >
        <div className="min-w-0">
          <h3 className="serif text-base font-semibold leading-snug sm:text-lg">{c.name}</h3>
          <div className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
            {c.members.length} {es ? "miembros" : "members"}
            {agendas.length > 0 && (
              <>
                {" · "}
                {agendas.length}{" "}
                {es
                  ? agendas.length === 1
                    ? "agenda vinculada"
                    : "agendas vinculadas"
                  : agendas.length === 1
                    ? "linked agenda"
                    : "linked agendas"}
              </>
            )}
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[var(--accent)]">
          {open ? (es ? "Ocultar" : "Hide") : es ? "Abrir" : "Open"}
          <ArrowRight
            size={16}
            aria-hidden="true"
            className={open ? "rotate-90 transition-transform" : "transition-transform"}
          />
        </span>
      </button>
      {open && (
        <div id={panelId} className="border-t px-4 py-5 sm:px-5">
          <section aria-label={es ? "Reuniones registradas" : "Recorded meetings"}>
            <h4 className="text-sm font-semibold">
              {es ? "Agendas de esta comisión" : "This committee's agendas"}
            </h4>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[var(--text-muted)]">
              {es
                ? "Cada enlace abre la reunión de la fecha indicada. Desde allí puede abrir el PDF oficial exacto cuando la fuente lo haya publicado y Oculis lo haya verificado."
                : "Each link opens the meeting for the stated date. From there, you can open the exact official PDF when the source has published it and Oculis has verified it."}
            </p>
            {agendas.length > 0 ? (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {agendas.map((agenda) => {
                  const date = formatISODate(agenda.eventDate, lang, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  });
                  const time = agenda.eventTime ? formatOfficialTime(agenda.eventTime, lang) : null;
                  return (
                    <li key={agenda.id}>
                      <Link
                        href={activityDetailHref(agenda.id, lang)}
                        aria-label={
                          es
                            ? `Abrir agenda de ${c.name} del ${date}`
                            : `Open ${c.name} agenda for ${date}`
                        }
                        className="flex min-h-16 items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-3 text-sm transition-colors hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                      >
                        <span className="flex min-w-0 items-start gap-2.5">
                          <CalendarDots
                            size={20}
                            aria-hidden="true"
                            className="mt-0.5 shrink-0 text-[var(--accent)]"
                          />
                          <span className="min-w-0">
                            <span className="block font-semibold text-[var(--text)]">
                              {es ? `Agenda del ${date}` : `Agenda for ${date}`}
                            </span>
                            {(time || agenda.kind) && (
                              <span className="mt-0.5 block truncate text-xs text-[var(--text-muted)]">
                                {[time, agenda.kind].filter(Boolean).join(" · ")}
                              </span>
                            )}
                          </span>
                        </span>
                        <ArrowRight
                          size={17}
                          aria-hidden="true"
                          className="shrink-0 text-[var(--accent)]"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="notice mt-4 text-sm" data-tone="warning">
                {es
                  ? "Oculis todavía no tiene una agenda pública vinculada por coincidencia exacta para esta comisión. Esto no significa que la comisión no se reúna."
                  : "Oculis does not yet have a public agenda linked by an exact match for this committee. This does not mean the committee does not meet."}
              </div>
            )}
          </section>
          <h4 className="mb-3 mt-6 border-t pt-5 text-sm font-semibold">
            {es ? "Integrantes" : "Members"}
          </h4>
          <ul className="grid gap-2 sm:grid-cols-2">
            {c.members.map((m, i) => {
              const party = m.party ? partyDisplayLabel(m.party, null, lang) : null;
              const color = partyColor(m.party);
              return (
                <li
                  key={`${m.profileId ?? m.fullName}-${m.role ?? ""}-${i}`}
                  className="flex min-h-10 items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-[var(--surface-2)] px-3 py-2 text-xs"
                >
                  <LegislatorProfileTrigger
                    profileId={m.profileId}
                    fullName={m.fullName}
                    chamber={m.chamber}
                    role={m.role}
                    party={m.party}
                    province={m.province}
                    ariaLabel={
                      party
                        ? es
                          ? `Abrir perfil de ${m.fullName}, ${party}`
                          : `Open ${m.fullName}'s profile, ${party}`
                        : undefined
                    }
                    className="-ml-2 inline-flex min-h-11 min-w-0 items-center rounded-md px-2 text-left font-medium underline-offset-4 hover:text-[var(--accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                  >
                    <span className="min-w-0 break-words">{m.fullName}</span>
                  </LegislatorProfileTrigger>
                  <span className="flex items-center gap-1.5">
                    {m.party && (
                      <span className="inline-flex items-center gap-1.5 text-[10.5px] text-[var(--text-muted)]">
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: color }}
                        />
                        {party}
                      </span>
                    )}
                    {m.role && m.role !== "Miembro" && (
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{
                          background: CARGO_SOFT[m.role] ?? "var(--surface-2)",
                          color: CARGO_COLOR[m.role] ?? "var(--text-muted)",
                        }}
                      >
                        {m.role}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </article>
  );
}
