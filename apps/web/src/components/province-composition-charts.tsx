"use client";

import { Circle } from "@phosphor-icons/react";
import React from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import {
  groupCongressMembersByParty,
  normalizeInitiativeComposition,
} from "@/lib/province-composition";
import { partyColor, partyDisplayLabel } from "@/lib/party-presentation";
import styles from "./home-province-dashboard.module.css";

interface ProvinceCompositionChartsProps {
  province: string;
  totalInitiatives: number;
  activeInitiatives: number;
  partyAffiliations: readonly (string | null | undefined)[];
  lang: "es" | "en";
}

interface DonutDatum {
  key: string;
  value: number;
  color: string;
}

const chartCopy = {
  es: {
    initiativeTitle: "Condición oficial de las iniciativas",
    partyTitle: "Congresistas por partido",
    active: "Vigentes",
    other: "Otras registradas",
    total: "Total",
    missingParty: "Partido no informado",
    inconsistent: "Datos inconsistentes",
    initiativeCenter: (active: number, total: number) => `${active} de ${total}`,
    initiativeAria: (province: string, total: number, active: number, remaining: number) =>
      `${province}: ${total} iniciativas registradas; ${active} con condición oficial VIGENTE y ${remaining} con otra condición o sin una condición publicada.`,
    partyAria: (province: string, total: number, groups: string) =>
      `${province}: ${total} congresistas reportados por partido.${groups ? ` ${groups}.` : ""}`,
    inconsistentAria: (province: string, total: number, active: number) =>
      `${province}: la fuente registra ${total} iniciativas y ${active} vigentes. No se muestra una proporción porque el conteo de vigentes supera el total.`,
    qualification:
      "«Otras registradas» no significa inactivas: puede incluir otra condición oficial o una condición no publicada.",
    partyQualification:
      "Los conteos usan el partido publicado por la fuente; los datos no informados aparecen por separado.",
    inconsistentQualification:
      "La proporción no se muestra porque el conteo de vigentes supera el total publicado.",
  },
  en: {
    initiativeTitle: "Official initiative condition",
    partyTitle: "Members of Congress by party",
    active: "Active",
    other: "Other recorded",
    total: "Total",
    missingParty: "Party not reported",
    inconsistent: "Inconsistent data",
    initiativeCenter: (active: number, total: number) => `${active} of ${total}`,
    initiativeAria: (province: string, total: number, active: number, remaining: number) =>
      `${province}: ${total} recorded initiatives; ${active} with official condition ACTIVE and ${remaining} with another condition or no published condition.`,
    partyAria: (province: string, total: number, groups: string) =>
      `${province}: ${total} reported members of Congress by party.${groups ? ` ${groups}.` : ""}`,
    inconsistentAria: (province: string, total: number, active: number) =>
      `${province}: the source records ${total} initiatives and ${active} active initiatives. No proportion is shown because the active count exceeds the total.`,
    qualification:
      "“Other recorded” does not mean inactive: it may include another official condition or no published condition.",
    partyQualification:
      "Counts use the party published by the source; unreported data appears separately.",
    inconsistentQualification:
      "The proportion is not shown because the active count exceeds the published total.",
  },
} as const;

function CompactDonut({
  data,
  centerValue,
  centerLabel,
  ariaLabel,
}: {
  data: DonutDatum[];
  centerValue: string;
  centerLabel: string;
  ariaLabel: string;
}) {
  const hasData = data.some((entry) => entry.value > 0);
  const chartData = hasData ? data : [{ key: "empty", value: 1, color: "var(--chart-empty)" }];

  return (
    <div className={styles.compositionDonut} role="img" aria-label={ariaLabel}>
      <div className={styles.compositionDonutVisual} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="key"
              innerRadius="67%"
              outerRadius="92%"
              startAngle={90}
              endAngle={-270}
              paddingAngle={hasData && chartData.length > 1 ? 2 : 0}
              cornerRadius={4}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {chartData.map((entry) => (
                <Cell key={entry.key} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className={styles.compositionDonutCenter}>
          <strong>{centerValue}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
    </div>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className={styles.compositionLegendRow}>
      <dt>
        <Circle size={10} weight="fill" color={color} aria-hidden="true" />
        <span>{label}</span>
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

export function ProvinceCompositionCharts({
  province,
  totalInitiatives,
  activeInitiatives,
  partyAffiliations,
  lang,
}: ProvinceCompositionChartsProps) {
  const labels = chartCopy[lang];
  const initiatives = normalizeInitiativeComposition({
    total: totalInitiatives,
    active: activeInitiatives,
  });
  const parties = groupCongressMembersByParty(partyAffiliations, labels.missingParty);
  const partyGroups = parties.groups.map((group) => ({
    ...group,
    displayLabel: group.isMissing ? group.label : partyDisplayLabel(group.label, null, lang),
  }));

  const initiativeData: DonutDatum[] = initiatives.isConsistent
    ? [
        { key: "active", value: initiatives.active, color: "var(--chart-primary)" },
        { key: "other", value: initiatives.remaining, color: "var(--chart-neutral)" },
      ]
    : [];
  const partyData: DonutDatum[] = partyGroups.map((group) => ({
    key: group.isMissing ? "party-missing" : `party-${group.label}`,
    value: group.count,
    color: partyColor(group.label, group.isMissing),
  }));
  const partyAriaSummary = partyGroups
    .map((group) => `${group.displayLabel}: ${group.count}`)
    .join("; ");

  return (
    <div className={styles.compositionBlock}>
      <div className={styles.compositionGrid}>
        <section className={styles.compositionCard}>
          <h4>{labels.initiativeTitle}</h4>
          <div className={styles.compositionBody}>
            <CompactDonut
              data={initiativeData}
              centerValue={
                initiatives.isConsistent
                  ? labels.initiativeCenter(initiatives.active, initiatives.total)
                  : "—"
              }
              centerLabel={initiatives.isConsistent ? labels.active : labels.inconsistent}
              ariaLabel={
                initiatives.isConsistent
                  ? labels.initiativeAria(
                      province,
                      initiatives.total,
                      initiatives.active,
                      initiatives.remaining,
                    )
                  : labels.inconsistentAria(province, initiatives.total, initiatives.active)
              }
            />
            <dl className={styles.compositionLegend}>
              <LegendRow
                color="var(--chart-primary)"
                label={labels.active}
                value={initiatives.active}
              />
              <LegendRow
                color="var(--chart-neutral)"
                label={labels.other}
                value={initiatives.remaining}
              />
              <div className={styles.compositionTotal}>
                <dt>{labels.total}</dt>
                <dd>{initiatives.total}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className={styles.compositionCard}>
          <h4>{labels.partyTitle}</h4>
          <div className={styles.compositionBody}>
            <CompactDonut
              data={partyData}
              centerValue={String(parties.total)}
              centerLabel={labels.total}
              ariaLabel={labels.partyAria(province, parties.total, partyAriaSummary)}
            />
            <dl className={styles.compositionLegend}>
              {partyGroups.map((group) => (
                <LegendRow
                  key={group.isMissing ? "party-missing" : group.label}
                  color={partyColor(group.label, group.isMissing)}
                  label={group.displayLabel}
                  value={group.count}
                />
              ))}
              <div className={styles.compositionTotal}>
                <dt>{labels.total}</dt>
                <dd>{parties.total}</dd>
              </div>
            </dl>
          </div>
        </section>
      </div>
      <p className={styles.compositionQualification}>
        {initiatives.isConsistent ? labels.qualification : labels.inconsistentQualification}{" "}
        {labels.partyQualification}
      </p>
    </div>
  );
}
