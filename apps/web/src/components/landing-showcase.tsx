"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Broadcast, CalendarDots, Gavel } from "@/components/ui/icons";
import type { Lang } from "@/lib/i18n";

const sections = [
  {
    id: "legislative",
    icon: Broadcast,
    href: "/feed",
    number: "01",
    es: {
      label: "Congreso",
      title: "Cada movimiento, en su fecha oficial.",
      description:
        "Vea los depósitos y cambios de estado publicados por ambas cámaras. Abra la iniciativa y siga su historial y documentos sin perder el contexto.",
    },
    en: {
      label: "Congress",
      title: "Every movement on its official date.",
      description:
        "See filings and status changes published by both chambers. Open an initiative and follow its history and documents without losing context.",
    },
  },
  {
    id: "committees",
    icon: CalendarDots,
    href: "/hoy",
    number: "02",
    es: {
      label: "Comisiones",
      title: "La agenda del día, la semana o el mes.",
      description:
        "Ubique reuniones, temas pautados y documentos oficiales de las comisiones desde un calendario que se adapta a su forma de trabajar.",
    },
    en: {
      label: "Committees",
      title: "The agenda by day, week, or month.",
      description:
        "Find meetings, scheduled topics, and official committee documents in a calendar that adapts to how you work.",
    },
  },
  {
    id: "regulatory",
    icon: Gavel,
    href: "/regulatorio",
    number: "03",
    es: {
      label: "Regulación",
      title: "Las instituciones, en una sola vista.",
      description:
        "Revise iniciativas y consultas públicas regulatorias por institución. Distinga lo publicado, lo que sigue en proceso y los límites de cada fuente.",
    },
    en: {
      label: "Regulation",
      title: "Institutions in one clear view.",
      description:
        "Review regulatory initiatives and public consultations by institution. Distinguish published facts, ongoing processes, and each source’s limits.",
    },
  },
] as const;

export function LandingShowcase({ lang }: { lang: Lang }) {
  const [active, setActive] = useState<(typeof sections)[number]["id"]>("legislative");
  const section = sections.find((item) => item.id === active)!;
  const copy = section[lang];
  const Icon = section.icon;
  const q = lang === "en" ? "?lang=en" : "";
  function moveTab(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % sections.length;
    else if (event.key === "ArrowLeft") next = (index + sections.length - 1) % sections.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = sections.length - 1;
    else return;
    event.preventDefault();
    const target = sections[next];
    setActive(target.id);
    document.getElementById(`landing-tab-${target.id}`)?.focus();
  }
  return (
    <div className="landing-showcase">
      <div
        role="tablist"
        aria-label={lang === "es" ? "Áreas de la plataforma" : "Platform areas"}
        className="landing-showcase-tabs"
      >
        {sections.map((item, index) => {
          const ItemIcon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`landing-tab-${item.id}`}
              aria-selected={item.id === active}
              aria-controls="landing-showcase-panel"
              tabIndex={item.id === active ? 0 : -1}
              onKeyDown={(event) => moveTab(event, index)}
              onClick={() => setActive(item.id)}
              className={
                item.id === active ? "landing-showcase-tab is-active" : "landing-showcase-tab"
              }
            >
              <span>{item.number}</span>
              <ItemIcon size={21} aria-hidden="true" />
              {item[lang].label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id="landing-showcase-panel"
        aria-labelledby={`landing-tab-${section.id}`}
        className="landing-showcase-panel"
      >
        <div className="landing-showcase-art" aria-hidden="true">
          <div className="landing-showcase-orbit landing-showcase-orbit-outer" />
          <div className="landing-showcase-orbit landing-showcase-orbit-inner" />
          <div className="landing-showcase-center">
            <Icon size={58} weight="duotone" />
          </div>
          <span className="landing-showcase-art-label">OCULIS / {section.number}</span>
          <span className="landing-showcase-art-dot" />
        </div>
        <div className="landing-showcase-copy">
          <span className="landing-showcase-index">
            {section.number} / 03 — {copy.label.toUpperCase()}
          </span>
          <h3>{copy.title}</h3>
          <p>{copy.description}</p>
          <Link href={`${section.href}${q}`} className="landing-inline-link">
            {lang === "es" ? "Explorar esta sección" : "Explore this section"}{" "}
            <ArrowRight size={19} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
