"use client";

import { useState } from "react";
import { Panel } from "@/components/dashboard";
import { ActivityList, DepositList, StatTile, type ActivityItem } from "@/components/monitoring";
import { ChamberToggle, type Chamber } from "@/components/ui/chamber-toggle";
import type { DepositItem } from "@/lib/data";

/**
 * Daily activity, split by chamber. A segmented toggle switches the whole feed
 * between Diputados and Senadores. Deposits exist only for Diputados (the SIL
 * corpus is the Chamber of Deputies), so that panel shows a note for the Senate.
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
  deposits: DepositItem[];
  senDeposits: DepositItem[];
  /** True when the Senate deposits cover a 7-day lookback (single-day view) vs an explicit range. */
  senDepositsWindow: boolean;
  dipCommittee: ActivityItem[];
  senCommittee: ActivityItem[];
  dipPlenary: ActivityItem[];
  senPlenary: ActivityItem[];
}) {
  const [chamber, setChamber] = useState<Chamber>("diputados");
  const isDip = chamber === "diputados";

  const committee = isDip ? dipCommittee : senCommittee;
  const plenary = isDip ? dipPlenary : senPlenary;
  const shownDeposits = isDip ? deposits : senDeposits;
  const docsUp = shownDeposits.filter((d) => d.docUploaded).length;

  const chamberLabel = isDip ? "Cámara de Diputados" : "Senado";
  // Senate deposits use a 7-day lookback in the single-day view (its SIL publishes with lag).
  const depWhen = !isDip && senDepositsWindow ? (es ? "últimos 7 días" : "last 7 days") : when;

  return (
    <>
      {/* Chamber switcher */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="eyebrow">{es ? "Cámara" : "Chamber"}</span>
        <ChamberToggle value={chamber} onChange={setChamber} />
        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          {es ? "Mostrando actividad de" : "Showing activity from"} <strong style={{ color: "var(--text)" }}>{chamberLabel}</strong>
        </span>
      </div>

      {/* Counts over the active window, for the selected chamber */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile
          value={shownDeposits.length}
          label={es ? "Iniciativas depositadas" : "Initiatives deposited"}
        />
        <StatTile value={committee.length} label={es ? "Movimientos en comisión" : "Committee movements"} accent="#8b5cf6" />
        <StatTile value={`${docsUp}/${shownDeposits.length || 0}`} label={es ? "Con documento cargado" : "With document uploaded"} accent="#0b6e4f" />
      </div>

      {/* 1 — Iniciativas depositadas */}
      <div className="mt-6">
        <Panel
          title={`${es ? "Iniciativas depositadas" : "Initiatives deposited"} · ${shownDeposits.length}`}
          flush
          action={
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {chamberLabel}
              {!isDip && senDepositsWindow ? ` · ${es ? "últimos 7 días" : "last 7 days"}` : ""}
            </span>
          }
        >
          <DepositList
            items={shownDeposits}
            empty={<>{es ? "No se depositaron iniciativas" : "No initiatives deposited"} {depWhen}. {isDip ? prevDayLink : null}</>}
          />
        </Panel>
      </div>

      {/* 2 — Movimientos en comisiones + Pleno/Asamblea */}
      <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel
          title={`${es ? "Movimientos en comisiones" : "Committee movements"} · ${committee.length}`}
          flush
          action={<span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{chamberLabel}</span>}
        >
          <ActivityList
            items={committee}
            empty={<>{es ? "Sin movimientos de comisión" : "No committee movements"} {when}. {prevDayLink}</>}
          />
        </Panel>
        <Panel title={`${es ? "Pleno y Asamblea" : "Floor & Assembly"} · ${plenary.length}`} flush
          action={<span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{chamberLabel}</span>}>
          <ActivityList items={plenary} empty={`${es ? "Sin sesiones de pleno/asamblea" : "No floor/assembly sessions"} ${when}.`} />
        </Panel>
      </div>
    </>
  );
}
