"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Broadcast,
  Buildings,
  CalendarDots,
  Database,
  FileMagnifyingGlass,
  Gavel,
  House,
  List,
  Shield,
  SidebarSimple,
  UserList,
  X,
} from "@/components/ui/icons";
import { langQuery, type Lang } from "@/lib/i18n";

/** Persistent editorial rail. Oculis is the primary product identity. */
export function Sidebar({ lang, open }: { lang: Lang; open: boolean }) {
  return (
    <aside
      id="desktop-navigation"
      aria-label={lang === "es" ? "Navegación principal" : "Main navigation"}
      aria-hidden={!open}
      className={
        open
          ? "sticky top-0 hidden h-dvh w-[264px] shrink-0 flex-col overflow-y-auto border-r border-[var(--nav-border)] bg-[var(--nav-bg)] px-5 py-5 text-[var(--nav-text)] lg:flex"
          : "hidden"
      }
    >
      <Brand lang={lang} />
      <Navigation lang={lang} />
      <Endorsement lang={lang} />
    </aside>
  );
}

/** Focus-managed navigation drawer for tablet and mobile. */
export function MobileNavigation({ lang }: { lang: Lang }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMounted(true);

    const desktop = window.matchMedia("(min-width: 64rem)");
    const closeAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeAtDesktop);
    return () => desktop.removeEventListener("change", closeAtDesktop);
  }, []);

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

  return (
    <>
      <span className="lg:hidden">
        <button
          type="button"
          aria-controls="mobile-navigation"
          aria-expanded={open}
          aria-label={lang === "es" ? "Abrir menú principal" : "Open main menu"}
          onClick={() => setOpen(true)}
          className="ui-button min-h-10 min-w-10 px-2.5"
        >
          <SidebarSimple size={19} aria-hidden="true" />
        </button>
      </span>

      {mounted &&
        open &&
        createPortal(
          <div className="fixed inset-0 z-[70] lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-[#031026]/70 backdrop-blur-sm"
              aria-label={lang === "es" ? "Cerrar navegación" : "Close navigation"}
              onClick={() => setOpen(false)}
            />
            <aside
              ref={panelRef}
              id="mobile-navigation"
              role="dialog"
              aria-modal="true"
              aria-label={lang === "es" ? "Navegación principal" : "Main navigation"}
              className="relative flex h-dvh w-[min(88vw,360px)] flex-col overflow-y-auto border-r border-[var(--nav-border)] bg-[var(--nav-bg)] px-5 py-5 text-[var(--nav-text)] shadow-2xl"
            >
              <div className="mb-5 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Brand lang={lang} compact />
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-md)] border border-[var(--nav-border)] text-[var(--nav-text)] hover:bg-white/10"
                  aria-label={lang === "es" ? "Cerrar menú" : "Close menu"}
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>
              <Navigation lang={lang} onNavigate={() => setOpen(false)} />
              <Endorsement lang={lang} />
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}

function Brand({ lang, compact = false }: { lang: Lang; compact?: boolean }) {
  const q = langQuery(lang);
  return (
    <div className={compact ? "pr-1" : "mb-2"}>
      <Link
        href={`/${q}`}
        className="block rounded-[var(--radius-md)] bg-white p-3 shadow-sm ring-1 ring-white/20 transition-transform hover:-translate-y-0.5"
      >
        <Image
          src="/oculis-lockup.png"
          alt="Oculis Auribus"
          width={991}
          height={474}
          priority
          sizes={compact ? "220px" : "224px"}
          className="h-auto w-full"
        />
      </Link>
      <p className="mt-3 px-1 text-[11px] font-semibold uppercase leading-relaxed tracking-[0.12em] text-[var(--nav-muted)]">
        {lang === "es"
          ? "Monitoreo legislativo y regulatorio"
          : "Legislative and regulatory monitoring"}
      </p>
    </div>
  );
}

function Navigation({ lang, onNavigate }: { lang: Lang; onNavigate?: () => void }) {
  const pathname = usePathname();
  const q = langQuery(lang);
  const es = lang === "es";

  const items = [
    {
      href: "/",
      label: es ? "Tablero inicial" : "Main Dashboard",
      icon: House,
    },
    {
      href: "/feed",
      label: es ? "Movimientos del Congreso" : "Congressional movements",
      icon: Broadcast,
    },
    { href: "/hoy", label: es ? "Agenda" : "Agenda", icon: CalendarDots },
    {
      href: "/regulatorio/consultas",
      label: es ? "Consultas públicas" : "Public consultations",
      icon: FileMagnifyingGlass,
    },
    { href: "/initiatives", label: es ? "Iniciativas" : "Initiatives", icon: List },
    {
      href: "/regulatorio",
      label: es ? "Instrumentos regulatorios" : "Regulatory instruments",
      icon: Gavel,
    },
    {
      href: "/congreso",
      label: es ? "Legisladores y comisiones" : "Legislators and committees",
      icon: UserList,
    },
    {
      href: "/diputados",
      label: es ? "Cámara de Diputados" : "Chamber of Deputies",
      icon: Buildings,
    },
    { href: "/senado", label: es ? "Senado" : "Senate", icon: Shield },
    {
      href: "/estado-fuentes",
      label: es ? "Fuentes y cobertura" : "Sources and coverage",
      icon: Database,
    },
  ];

  const activeFor = (href: string) => {
    if (href === "/") return pathname === "/";
    if (href === "/hoy") return pathname.startsWith("/hoy") || pathname.startsWith("/agenda/");
    if (href === "/regulatorio") return pathname === "/regulatorio" || pathname === "/regulatory";
    return pathname.startsWith(href);
  };

  return (
    <nav
      className="mt-6 flex flex-col gap-0.5"
      aria-label={es ? "Navegación principal" : "Main navigation"}
    >
      {items.map((item) => {
        const active = activeFor(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={`${item.href}${q}`}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className="group relative flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 text-[13.5px] font-medium transition-colors"
            style={{
              color: active ? "var(--nav-text)" : "var(--nav-muted)",
              background: active ? "var(--nav-bg-2)" : "transparent",
            }}
          >
            {active && (
              <span className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-[#4f80ff]" />
            )}
            <Icon
              size={19}
              weight={active ? "fill" : "regular"}
              aria-hidden="true"
              className={active ? "text-[#6f9cff]" : "text-current"}
            />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Endorsement({ lang }: { lang: Lang }) {
  return (
    <div className="mt-auto border-t border-[var(--nav-border)] px-2 pt-5 text-xs leading-relaxed text-[var(--nav-muted)]">
      <span className="block">{lang === "es" ? "Una plataforma de" : "A platform by"}</span>
      <span className="mt-1 block font-semibold text-[var(--nav-text)]">
        {lang === "es" ? "Ferdinand Herrera Consultores" : "Ferdinand Herrera Consultants"}
      </span>
    </div>
  );
}
