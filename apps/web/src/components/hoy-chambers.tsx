"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Panel } from "@/components/report-ui";
import { ActivityList, DepositList, type ActivityItem } from "@/components/monitoring";
import { ChamberToggle, type Chamber } from "@/components/ui/chamber-toggle";
import type { PublicHoyDepositItem } from "@/lib/public-initiative-payloads";

/**
 * Daily activity, split by chamber. A segmented toggle switches the whole view
 * between the Chamber of Deputies and the Senate while keeping the URL shareable.
 */
export function HoyChambers({
  es,
  when,
  prevDayLink,
  deposits,
  senDeposits,
  senDepositsWindow,
  dipCommittee,
  senCommittee,
  dipPlenary,
  senPlenary,
}: {
  es: boolean;
  when: string;
  prevDayLink: React.ReactNode;
  deposits: PublicHoyDepositItem[];
  senDeposits: PublicHoyDepositItem[];
  /** True when the Senate deposits cover a 7-day lookback (single-day view) vs an explicit range. */
  senDepositsWindow: boolean;
  dipCommittee: ActivityItem[];
  senCommittee: ActivityItem[];
  dipPlenary: ActivityItem[];
  senPlenary: ActivityItem[];
}) {
  const lang = es ? "es" : "en";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const chamber: Chamber = searchParams.get("chamber") === "senado" ? "senadores" : "diputados";
  const isDip = chamber === "diputados";

  function selectChamber(next: Chamber) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "diputados") params.delete("chamber");
    else params.set("chamber", "senado");
    const query = params.toString();
    router.replace(`${pathname}${query ? `?${query}` : ""}`, { scroll: false });
  }

  const committee = isDip ? dipCommittee : senCommittee;
  const plenary = isDip ? dipPlenary : senPlenary;
  const shownDeposits = isDip ? deposits : senDeposits;
  const chamberLabel = isDip
    ? es
      ? "Cámara de Diputados"
      : "Chamber of Deputies"
    : es
      ? "Senado"
      : "Senate";
  // Senate deposits AND activity use a 7-day lookback in the single-day view (its SIL
  // publishes with lag). Diputados is exact-date. Disclose the window so a count of Senate
  // committee/plenary activity isn't mistaken for "today only".
  const senWindow = !isDip && senDepositsWindow;
  const depWhen = senWindow ? (es ? "últimos 7 días" : "last 7 days") : when;
  const actWhen = senWindow ? (es ? "últimos 7 días" : "last 7 days") : when;
  const windowTag = senWindow ? (es ? " · últimos 7 días" : " · last 7 days") : "";

  return (
    <>
      <section
        className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border px-4 py-3"
        aria-label={es ? "Cámara seleccionada" : "Selected chamber"}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="eyebrow">{es ? "Cámara" : "Chamber"}</span>
          <ChamberToggle value={chamber} onChange={selectChamber} lang={lang} />
        </div>
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          {es ? "Mostrando información de" : "Showing information from"}{" "}
          <strong style={{ color: "var(--text)" }}>{chamberLabel}</strong>
        </p>
      </section>

      <section aria-labelledby="agenda-chamber-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{es ? "Actividad publicada" : "Published activity"}</p>
            <h2 id="agenda-chamber-heading" className="serif mt-1 text-xl font-semibold">
              {chamberLabel}
            </h2>
          </div>
          <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <div className="flex items-baseline gap-1.5">
              <dt style={{ color: "var(--text-muted)" }}>{es ? "Comisiones" : "Committees"}</dt>
              <dd className="tnum text-base font-semibold">{committee.length}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt style={{ color: "var(--text-muted)" }}>
                {es ? "Pleno y Asamblea" : "Floor and Assembly"}
              </dt>
              <dd className="tnum text-base font-semibold">{plenary.length}</dd>
            </div>
            <div className="flex items-baseline gap-1.5">
              <dt style={{ color: "var(--text-muted)" }}>{es ? "Iniciativas" : "Initiatives"}</dt>
              <dd className="tnum text-base font-semibold">{shownDeposits.length}</dd>
            </div>
          </dl>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Panel
            title={es ? "Actividad de comisiones" : "Committee activity"}
            flush
            headingLevel={3}
            action={
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {committee.length} {es ? "registros" : "records"}
                {windowTag}
              </span>
            }
          >
            <ActivityList
              items={committee}
              lang={lang}
              empty={
                <>
                  {es ? "No hay actividad de comisiones" : "No committee activity"} {actWhen}.{" "}
                  {prevDayLink}
                </>
              }
            />
          </Panel>
          <Panel
            title={es ? "Pleno y Asamblea" : "Floor and Assembly"}
            flush
            headingLevel={3}
            action={
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {plenary.length} {es ? "registros" : "records"}
                {windowTag}
              </span>
            }
          >
            <ActivityList
              items={plenary}
              lang={lang}
              empty={`${es ? "No hay sesiones de pleno o asamblea" : "No floor or assembly sessions"} ${actWhen}.`}
            />
          </Panel>
        </div>
      </section>

      <section className="mt-7">
        <Panel
          title={es ? "Iniciativas depositadas" : "Deposited initiatives"}
          flush
          action={
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {shownDeposits.length} · {chamberLabel}
              {!isDip && senDepositsWindow ? ` · ${es ? "últimos 7 días" : "last 7 days"}` : ""}
            </span>
          }
        >
          <DepositList
            items={shownDeposits}
            lang={lang}
            empty={
              <>
                {es
                  ? "No se publicaron iniciativas depositadas"
                  : "No deposited initiatives were published"}{" "}
                {depWhen}. {isDip ? prevDayLink : null}
              </>
            }
          />
        </Panel>
      </section>
    </>
  );
}
