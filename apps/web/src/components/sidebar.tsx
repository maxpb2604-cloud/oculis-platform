"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { langQuery, type Lang } from "@/lib/i18n";

/** Left module rail — brand, real navigation, user footer. */
export function Sidebar({ lang }: { lang: Lang }) {
  return (
    <aside
      className="sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col justify-between border-r px-4 py-5 lg:flex"
      style={{ background: "var(--surface)" }}
    >
      <div>
        <Brand lang={lang} />
        <Navigation lang={lang} />
      </div>
      <ConsultantCard />
    </aside>
  );
}

/** Compact navigation drawer for tablet and mobile layouts. */
export function MobileNavigation({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute("hidden"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open]);

  const label = lang === "es" ? "Menú" : "Menu";
  return (
    <>
      <button
        type="button"
        aria-controls="mobile-navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-9 items-center justify-center rounded-lg border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)] lg:hidden"
      >
        {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/55"
            aria-label={lang === "es" ? "Cerrar navegación" : "Close navigation"}
            onClick={() => setOpen(false)}
          />
          <aside
            ref={panelRef}
            id="mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label={lang === "es" ? "Navegación principal" : "Main navigation"}
            className="relative flex h-dvh w-[min(88vw,340px)] flex-col justify-between overflow-y-auto border-r px-4 py-5 shadow-2xl"
            style={{ background: "var(--surface)" }}
          >
            <div>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Brand lang={lang} compact />
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  className="min-h-9 shrink-0 rounded-lg border px-3 text-xs font-semibold transition-colors hover:bg-[var(--surface-2)]"
                >
                  {lang === "es" ? "Cerrar" : "Close"}
                </button>
              </div>
              <Navigation lang={lang} onNavigate={() => setOpen(false)} />
            </div>
            <ConsultantCard />
          </aside>
        </div>
      )}
    </>
  );
}

function Brand({ lang, compact = false }: { lang: Lang; compact?: boolean }) {
  const q = langQuery(lang);
  return (
    <div className="px-1">
      {!compact && (
        <Link href={`/${q}`} className="block">
          <div className="rounded-lg bg-white p-2.5 ring-1 ring-black/5">
            <Image
              src="/fhc-logo.jpg"
              alt="Ferdinand Herrera Consultants"
              width={2362}
              height={827}
              sizes="212px"
              priority
              className="h-auto w-full"
            />
          </div>
        </Link>
      )}
      <Link
        href={`/${q}`}
        className={`${compact ? "mt-0" : "mt-3"} flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-[var(--surface-2)]`}
      >
        <span className="h-9 w-9 shrink-0 overflow-hidden" aria-hidden="true">
          <Image
            src="/oculis-mark.png"
            alt=""
            width={1119}
            height={474}
            sizes="40px"
            className="h-9 w-[85px] max-w-none object-contain object-left"
          />
        </span>
        <span className="min-w-0 leading-tight">
          <span className="serif block text-[18px] font-semibold tracking-tight">
            Oculis Auribus
          </span>
          <span className="eyebrow mt-0.5 block">
            {lang === "es"
              ? "Monitoreo Legislativo · Regulatorio"
              : "Legislative · Regulatory Monitoring"}
          </span>
        </span>
      </Link>
    </div>
  );
}

function Navigation({ lang, onNavigate }: { lang: Lang; onNavigate?: () => void }) {
  const pathname = usePathname();
  const q = langQuery(lang);

  const groups = [
    {
      title: lang === "es" ? "Monitoreo Legislativo" : "Legislative Monitoring",
      items: [
        {
          href: "/feed",
          label: "Feed",
          icon: IconRss,
          match: (p: string) => p.startsWith("/feed"),
        },
        {
          href: "/hoy",
          label: lang === "es" ? "Hoy" : "Today",
          icon: IconCalendar,
          match: (p: string) => p.startsWith("/hoy"),
        },
        {
          href: "/diputados",
          label: lang === "es" ? "Diputados" : "Deputies",
          icon: IconGavel,
          match: (p: string) => p.startsWith("/diputados"),
        },
        {
          href: "/senado",
          label: lang === "es" ? "Senado" : "Senate",
          icon: IconShield,
          match: (p: string) => p.startsWith("/senado"),
        },
        {
          href: "/congreso",
          label: lang === "es" ? "Congresistas" : "Congress members",
          icon: IconUsers,
          match: (p: string) => p.startsWith("/congreso"),
        },
        {
          href: "/initiatives",
          label: lang === "es" ? "Iniciativas" : "Initiatives",
          icon: IconList,
          match: (p: string) => p.startsWith("/initiatives"),
        },
      ],
    },
    {
      title: lang === "es" ? "Monitoreo Regulatorio" : "Regulatory Monitoring",
      items: [
        {
          href: "/regulatorio",
          label: lang === "es" ? "Resumen regulatorio" : "Overview",
          icon: IconShieldCheck,
          match: (p: string) => p === "/regulatorio",
        },
        {
          href: "/regulatorio/consultas",
          label: lang === "es" ? "Consultas públicas" : "Public consultations",
          icon: IconMegaphone,
          match: (p: string) => p.startsWith("/regulatorio/consultas"),
        },
      ],
    },
    {
      title: lang === "es" ? "Operación" : "Operations",
      items: [
        {
          href: "/estado-fuentes",
          label: lang === "es" ? "Estado de fuentes" : "Source status",
          icon: IconDatabase,
          match: (p: string) => p.startsWith("/estado-fuentes"),
        },
      ],
    },
  ];

  return (
    <nav
      className="mt-7 flex flex-col gap-0.5"
      aria-label={lang === "es" ? "Principal" : "Primary"}
    >
      {groups.map((g) => (
        <div key={g.title} className="mb-3">
          <div className="eyebrow px-2 pb-2">{g.title}</div>
          {g.items.map((n) => {
            const active = n.match(pathname);
            return (
              <Link
                key={n.href}
                href={`${n.href}${q}`}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                className="group flex min-h-10 items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-[var(--surface-2)]"
                style={{
                  color: active ? "var(--text)" : "var(--text-muted)",
                  background: active ? "var(--accent-soft)" : "transparent",
                  fontWeight: active ? 600 : 500,
                  boxShadow: active ? "inset 2px 0 0 var(--accent)" : "none",
                }}
              >
                <n.icon active={active} />
                {n.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function ConsultantCard() {
  return (
    <div className="rounded-lg border p-3" style={{ background: "var(--surface-2)" }}>
      <div className="flex items-center gap-2.5">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ background: "var(--accent)" }}
          aria-hidden="true"
        >
          FH
        </div>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-medium">Ferdinand Herrera</div>
          <div className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
            Consultores
          </div>
        </div>
      </div>
    </div>
  );
}

function ico(active?: boolean) {
  return {
    width: 17,
    height: 17,
    fill: "none",
    stroke: active ? "var(--accent)" : "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}
function IconGavel({ active }: { active?: boolean }) {
  return (
    <svg {...ico(active)} viewBox="0 0 24 24">
      <path d="m14 13-7 7M11 6l7 7M9 4l6 6M16 9l4 4" />
      <path d="M3 21h8" />
    </svg>
  );
}
function IconShield({ active }: { active?: boolean }) {
  return (
    <svg {...ico(active)} viewBox="0 0 24 24">
      <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
    </svg>
  );
}
function IconList({ active }: { active?: boolean }) {
  return (
    <svg {...ico(active)} viewBox="0 0 24 24">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}
function IconRss({ active }: { active?: boolean }) {
  return (
    <svg {...ico(active)} viewBox="0 0 24 24">
      <path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  );
}
function IconCalendar({ active }: { active?: boolean }) {
  return (
    <svg {...ico(active)} viewBox="0 0 24 24">
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}
function IconShieldCheck({ active }: { active?: boolean }) {
  return (
    <svg {...ico(active)} viewBox="0 0 24 24">
      <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
function IconMegaphone({ active }: { active?: boolean }) {
  return (
    <svg {...ico(active)} viewBox="0 0 24 24">
      <path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" />
      <path d="M15 8a4 4 0 0 1 0 8" />
    </svg>
  );
}
function IconUsers({ active }: { active?: boolean }) {
  return (
    <svg {...ico(active)} viewBox="0 0 24 24">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconDatabase({ active }: { active?: boolean }) {
  return (
    <svg {...ico(active)} viewBox="0 0 24 24">
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </svg>
  );
}
