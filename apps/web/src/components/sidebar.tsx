"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { langQuery, type Lang } from "@/lib/i18n";

/**
 * Left module rail — brand, real navigation, user footer.
 * Desktop (lg+): sticky rail, always visible. Below lg: a fixed hamburger
 * button (the top bar pads left for it) opens the same nav as a slide-over
 * drawer with a backdrop; it closes on route change, backdrop click or Escape,
 * and locks body scroll while open.
 */
export function Sidebar({ lang }: { lang: Lang }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer whenever the route changes (nav link clicks).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // While open: Escape closes, body scroll is locked.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      {/* Mobile hamburger — fixed so it rides above the sticky top bar. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={lang === "es" ? "Abrir menú de navegación" : "Open navigation menu"}
        aria-expanded={open}
        aria-controls="mobile-sidebar"
        className="fixed left-4 top-4 z-30 flex h-9 w-9 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--surface-2)] lg:hidden"
        style={{ cursor: "pointer", background: "var(--surface)" }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Mobile backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          style={{ background: "var(--modal-overlay)" }}
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      {/* Mobile slide-over drawer — same content as the desktop rail. */}
      <aside
        id="mobile-sidebar"
        inert={!open}
        aria-hidden={!open}
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col justify-between gap-6 overflow-y-auto border-r px-4 py-5 transition-transform duration-200 lg:hidden ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={{ background: "var(--surface)" }}
      >
        <SidebarContent lang={lang} pathname={pathname} onNavigate={() => setOpen(false)} />
      </aside>

      {/* Desktop rail — unchanged behavior. */}
      <aside
        className="sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col justify-between border-r px-4 py-5 lg:flex"
        style={{ background: "var(--surface)" }}
      >
        <SidebarContent lang={lang} pathname={pathname} />
      </aside>
    </>
  );
}

/** Brand block + grouped nav + user footer, shared by the rail and the drawer. */
function SidebarContent({
  lang,
  pathname,
  onNavigate,
}: {
  lang: Lang;
  pathname: string;
  onNavigate?: () => void;
}) {
  const q = langQuery(lang);

  const groups = [
    {
      title: null,
      items: [
        {
          href: "/",
          label: lang === "es" ? "Resumen Ejecutivo" : "Executive Summary",
          icon: IconHome,
          match: (p: string) => p === "/",
        },
      ],
    },
    {
      title: lang === "es" ? "Monitoreo Legislativo" : "Legislative Monitoring",
      items: [
        { href: "/feed", label: "Feed", icon: IconRss, match: (p: string) => p.startsWith("/feed") },
        { href: "/hoy", label: lang === "es" ? "Hoy" : "Today", icon: IconCalendar, match: (p: string) => p.startsWith("/hoy") },
        { href: "/diputados", label: lang === "es" ? "Diputados" : "Deputies", icon: IconGavel, match: (p: string) => p.startsWith("/diputados") },
        { href: "/senado", label: lang === "es" ? "Senado" : "Senate", icon: IconShield, match: (p: string) => p.startsWith("/senado") },
        { href: "/congreso", label: lang === "es" ? "Congresistas" : "Congress members", icon: IconUsers, match: (p: string) => p.startsWith("/congreso") },
        { href: "/initiatives", label: lang === "es" ? "Iniciativas" : "Initiatives", icon: IconList, match: (p: string) => p.startsWith("/initiatives") },
      ],
    },
    {
      title: lang === "es" ? "Monitoreo Regulatorio" : "Regulatory Monitoring",
      items: [
        { href: "/regulatorio", label: lang === "es" ? "Resumen regulatorio" : "Overview", icon: IconShieldCheck, match: (p: string) => p === "/regulatorio" },
        { href: "/regulatorio/consultas", label: lang === "es" ? "Consultas públicas" : "Public consultations", icon: IconMegaphone, match: (p: string) => p.startsWith("/regulatorio/consultas") },
      ],
    },
  ];

  return (
    <>
      <div>
        <div className="px-1">
          {/* Official Ferdinand Herrera Consultants logo → home. White plate so it reads in light + dark. */}
          <Link href={`/${q}`} onClick={onNavigate} className="block" style={{ cursor: "pointer" }}>
            <div className="rounded-lg bg-white p-2.5 ring-1 ring-black/5">
              <img src="/fhc-logo.jpg" alt="Ferdinand Herrera Consultants" className="w-full" />
            </div>
          </Link>
          {/* Oculis Auribus — primary platform brand → home. Blue icon adapts to light + dark. */}
          <Link
            href={`/${q}`}
            onClick={onNavigate}
            className="mt-3 flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-[var(--surface-2)]"
            style={{ cursor: "pointer" }}
          >
            <img src="/oculis-mark.png" alt="Oculis Auribus" className="h-7 w-7 shrink-0 object-contain" />
            <div className="leading-tight">
              <div className="serif text-[18px] font-semibold tracking-tight">Oculis Auribus</div>
              <div className="eyebrow mt-0.5">
                {lang === "es" ? "Monitoreo Legislativo · Regulatorio" : "Legislative · Regulatory Monitoring"}
              </div>
            </div>
          </Link>
        </div>

        <nav className="mt-7 flex flex-col gap-0.5">
          {groups.map((g, gi) => (
            <div key={g.title ?? gi} className="mb-3">
              {g.title && <div className="eyebrow px-2 pb-2">{g.title}</div>}
              {g.items.map((n) => {
                const active = n.match(pathname);
                return (
                  <Link
                    key={n.href}
                    href={`${n.href}${q}`}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className="group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors hover:bg-[var(--surface-2)]"
                    style={{
                      cursor: "pointer",
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
      </div>

      <div className="rounded-lg border p-3" style={{ background: "var(--surface-2)" }}>
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white"
            style={{ background: "var(--accent)" }}
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
    </>
  );
}

function ico(active?: boolean) {
  return {
    width: 17, height: 17, fill: "none",
    stroke: active ? "var(--accent)" : "currentColor",
    strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
}
function IconHome({ active }: { active?: boolean }) {
  return (<svg {...ico(active)} viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1V10Z" /></svg>);
}
function IconGavel({ active }: { active?: boolean }) {
  return (<svg {...ico(active)} viewBox="0 0 24 24"><path d="m14 13-7 7M11 6l7 7M9 4l6 6M16 9l4 4" /><path d="M3 21h8" /></svg>);
}
function IconShield({ active }: { active?: boolean }) {
  return (<svg {...ico(active)} viewBox="0 0 24 24"><path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" /></svg>);
}
function IconList({ active }: { active?: boolean }) {
  return (<svg {...ico(active)} viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>);
}
function IconRss({ active }: { active?: boolean }) {
  return (<svg {...ico(active)} viewBox="0 0 24 24"><path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" /></svg>);
}
function IconCalendar({ active }: { active?: boolean }) {
  return (<svg {...ico(active)} viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
}
function IconShieldCheck({ active }: { active?: boolean }) {
  return (<svg {...ico(active)} viewBox="0 0 24 24"><path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>);
}
function IconMegaphone({ active }: { active?: boolean }) {
  return (<svg {...ico(active)} viewBox="0 0 24 24"><path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z" /><path d="M15 8a4 4 0 0 1 0 8" /></svg>);
}
function IconUsers({ active }: { active?: boolean }) {
  return (<svg {...ico(active)} viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>);
}
