"use client";

import { Circle } from "@phosphor-icons/react";
import React, { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ResponsiveContainer, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts";
import type { HomeChamberComposition, HomeChamberPartyGroup } from "@/lib/data";
import { createHemicycleLayout } from "@/lib/hemicycle-layout";
import type { Lang } from "@/lib/i18n";
import { partyColor, partyDisplayLabel } from "@/lib/party-presentation";
import styles from "./chamber-party-composition.module.css";

type ChamberKey = HomeChamberComposition["chamber"];

const CHAMBER_ORDER: readonly ChamberKey[] = ["SENADO", "DIPUTADOS"];

const copy = {
  es: {
    eyebrow: "Congreso Nacional",
    title: "Composición partidaria",
    tabsLabel: "Seleccionar cámara legislativa",
    chamber: {
      SENADO: "Senado",
      DIPUTADOS: "Cámara de Diputados",
    },
    chamberHeading: {
      SENADO: "Senado de la República",
      DIPUTADOS: "Cámara de Diputados",
    },
    observed: "integrantes activos en el directorio",
    reported: "con partido publicado",
    unreported: "sin partido publicado",
    missingParty: "Partido no informado",
    empty: "Todavía no hay integrantes activos observados para esta cámara.",
    note: "Cada punto representa a un integrante activo del directorio. Los partidos pequeños se ubican primero únicamente para agrupar la lectura; la posición no representa ideología.",
    live: (chamber: string, total: number) =>
      `Mostrando ${chamber}: ${total} integrantes activos en el directorio.`,
    chart: (chamber: string, total: number, groups: string) =>
      `${chamber}: ${total} integrantes activos en el directorio por partido.${groups ? ` ${groups}.` : ""} La posición no representa ideología.`,
  },
  en: {
    eyebrow: "National Congress",
    title: "Party composition",
    tabsLabel: "Select legislative chamber",
    chamber: {
      SENADO: "Senate",
      DIPUTADOS: "Chamber of Deputies",
    },
    chamberHeading: {
      SENADO: "Senate of the Republic",
      DIPUTADOS: "Chamber of Deputies",
    },
    observed: "active directory members",
    reported: "with a published party",
    unreported: "without a published party",
    missingParty: "Party not reported",
    empty: "No active members have been observed for this chamber yet.",
    note: "Each point represents one active directory member. Smaller parties appear first only to group the reading; position does not represent ideology.",
    live: (chamber: string, total: number) =>
      `Showing ${chamber}: ${total} active directory members.`,
    chart: (chamber: string, total: number, groups: string) =>
      `${chamber}: ${total} active directory members by party.${groups ? ` ${groups}.` : ""} Position does not represent ideology.`,
  },
} as const;

interface DisplayGroup extends HomeChamberPartyGroup {
  key: string;
  label: string;
  color: string;
}

export interface ChamberPartyCompositionProps {
  chambers: HomeChamberComposition[];
  lang: Lang;
}

export function nextChamberTab(
  current: ChamberKey,
  key: string,
  available: readonly ChamberKey[] = CHAMBER_ORDER,
): ChamberKey | null {
  if (available.length === 0) return null;
  if (key === "Home") return available[0] ?? null;
  if (key === "End") return available.at(-1) ?? null;

  const direction =
    key === "ArrowRight" || key === "ArrowDown"
      ? 1
      : key === "ArrowLeft" || key === "ArrowUp"
        ? -1
        : 0;
  if (direction === 0) return null;

  const currentIndex = Math.max(0, available.indexOf(current));
  return available[(currentIndex + direction + available.length) % available.length] ?? null;
}

function formatPercentage(count: number, total: number): string {
  if (total <= 0) return "0%";
  const percentage = (count / total) * 100;
  return `${percentage.toFixed(Number.isInteger(percentage) ? 0 : 1)}%`;
}

function prepareGroups(groups: readonly HomeChamberPartyGroup[], lang: Lang): DisplayGroup[] {
  return groups.map((group, index) => ({
    ...group,
    key: `${group.isMissing ? "missing" : "party"}-${group.acronym ?? group.fullName ?? index}`,
    label: group.isMissing
      ? copy[lang].missingParty
      : partyDisplayLabel(group.acronym, group.fullName, lang),
    color: partyColor(group.acronym ?? group.fullName, group.isMissing),
  }));
}

function ChamberPanel({ chamber, lang }: { chamber: HomeChamberComposition; lang: Lang }) {
  const labels = copy[lang];
  const displayGroups = useMemo(() => prepareGroups(chamber.groups, lang), [chamber.groups, lang]);
  const visualGroups = useMemo(
    () =>
      [...displayGroups].sort(
        (left, right) => left.count - right.count || left.label.localeCompare(right.label, lang),
      ),
    [displayGroups, lang],
  );
  const legendGroups = useMemo(
    () =>
      [...displayGroups].sort(
        (left, right) => right.count - left.count || left.label.localeCompare(right.label, lang),
      ),
    [displayGroups, lang],
  );
  const layout = useMemo(
    () =>
      createHemicycleLayout(visualGroups.map((group) => ({ key: group.key, count: group.count }))),
    [visualGroups],
  );
  const chartGroups = useMemo(
    () =>
      visualGroups.map((group) => ({
        ...group,
        seats: layout.seats
          .filter((seat) => seat.groupKey === group.key)
          .map((seat) => ({ x: seat.x, y: seat.y, size: 1 })),
      })),
    [layout.seats, visualGroups],
  );
  const chamberName = labels.chamberHeading[chamber.chamber];
  const ariaGroups = legendGroups
    .map(
      (group) =>
        `${group.label}: ${group.count}, ${formatPercentage(group.count, chamber.observedTotal)}`,
    )
    .join("; ");
  const seatArea = chamber.observedTotal > 80 ? 66 : 190;

  return (
    <div className={styles.panelGrid}>
      <div
        className={styles.chartRegion}
        role="img"
        aria-label={labels.chart(chamberName, chamber.observedTotal, ariaGroups)}
        data-seat-count={layout.seatCount}
        data-observed-total={chamber.observedTotal}
      >
        <div className={styles.chartHeading} aria-hidden="true">
          <div>
            <h3>{chamberName}</h3>
            <p>{labels.observed}</p>
          </div>
          <strong>{chamber.observedTotal}</strong>
        </div>

        {layout.seatCount > 0 ? (
          <div className={styles.hemicycle} aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, bottom: 2, left: 10 }}>
                <XAxis type="number" dataKey="x" domain={[0, 1]} hide />
                <YAxis type="number" dataKey="y" domain={[0, 1]} reversed hide />
                <ZAxis type="number" dataKey="size" range={[seatArea, seatArea]} />
                {chartGroups.map((group) => (
                  <Scatter
                    key={group.key}
                    name={group.label}
                    data={group.seats}
                    fill={group.color}
                    stroke="var(--surface)"
                    strokeWidth={1.25}
                    isAnimationActive={false}
                  />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className={styles.emptyState}>{labels.empty}</p>
        )}
      </div>

      <div className={styles.legendRegion}>
        <dl className={styles.legend}>
          {legendGroups.map((group) => (
            <div className={styles.legendRow} key={group.key}>
              <dt>
                <Circle size={12} weight="fill" color={group.color} aria-hidden="true" />
                <span>{group.label}</span>
              </dt>
              <dd>
                <strong>{group.count}</strong>
                <span>{formatPercentage(group.count, chamber.observedTotal)}</span>
              </dd>
            </div>
          ))}
        </dl>

        <div className={styles.reportedSummary}>
          <span>
            <strong>{chamber.reportedTotal}</strong> {labels.reported}
          </span>
          {chamber.unreportedTotal > 0 ? (
            <span>
              <strong>{chamber.unreportedTotal}</strong> {labels.unreported}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ChamberPartyComposition({ chambers, lang }: ChamberPartyCompositionProps) {
  const labels = copy[lang];
  const titleId = useId();
  const componentId = useId();
  const [activeChamber, setActiveChamber] = useState<ChamberKey>("SENADO");
  const tabRefs = useRef<Partial<Record<ChamberKey, HTMLButtonElement | null>>>({});
  const available = CHAMBER_ORDER.filter((key) =>
    chambers.some((chamber) => chamber.chamber === key),
  );
  const displayed =
    chambers.find((chamber) => chamber.chamber === activeChamber) ??
    chambers.find((chamber) => chamber.chamber === "SENADO") ??
    chambers[0] ??
    null;
  const selectedKey = displayed?.chamber ?? null;

  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, current: ChamberKey) => {
    const next = nextChamberTab(current, event.key, available);
    if (!next) return;
    event.preventDefault();
    setActiveChamber(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section className={styles.card} aria-labelledby={titleId} data-testid="chamber-composition">
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>{labels.eyebrow}</span>
          <h2 id={titleId}>{labels.title}</h2>
        </div>

        <div className={styles.glassTabs} role="tablist" aria-label={labels.tabsLabel}>
          {CHAMBER_ORDER.map((chamberKey) => {
            const isAvailable = available.includes(chamberKey);
            const selected = selectedKey === chamberKey;
            const tabId = `${componentId}-${chamberKey.toLowerCase()}-tab`;
            const panelId = `${componentId}-${chamberKey.toLowerCase()}-panel`;
            return (
              <button
                key={chamberKey}
                ref={(node) => {
                  tabRefs.current[chamberKey] = node;
                }}
                id={tabId}
                type="button"
                role="tab"
                className={styles.tab}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                disabled={!isAvailable}
                onClick={() => setActiveChamber(chamberKey)}
                onKeyDown={(event) => selectFromKeyboard(event, chamberKey)}
              >
                {labels.chamber[chamberKey]}
              </button>
            );
          })}
        </div>
      </header>

      <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
        {displayed
          ? labels.live(labels.chamberHeading[displayed.chamber], displayed.observedTotal)
          : labels.empty}
      </div>

      {CHAMBER_ORDER.map((chamberKey) => {
        const chamber = chambers.find((item) => item.chamber === chamberKey);
        const selected = selectedKey === chamberKey;
        return (
          <div
            key={chamberKey}
            id={`${componentId}-${chamberKey.toLowerCase()}-panel`}
            role="tabpanel"
            aria-labelledby={`${componentId}-${chamberKey.toLowerCase()}-tab`}
            tabIndex={0}
            hidden={!selected}
          >
            {selected && chamber ? <ChamberPanel chamber={chamber} lang={lang} /> : null}
          </div>
        );
      })}

      <p className={styles.note}>{labels.note}</p>
    </section>
  );
}
