"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { dict, type Lang } from "@/lib/i18n";

/** Left module rail — brand, real navigation, user footer. */
export function Sidebar({ lang }: { lang: Lang }) {
  const t = dict[lang];
  const pathname = usePathname();
  const q = lang === "en" ? "?lang=en" : "";

  const nav = [
    { href: "/", label: lang === "es" ? "Resumen" : "Overview", icon: IconGrid, match: (p: string) => p === "/" },
    { href: "/legislative", label: t.legislative, icon: IconGavel, match: (p: string) => p.startsWith("/legislative") },
    { href: "/regulatory", label: t.regulatory, icon: IconShield, match: (p: string) => p.startsWith("/regulatory") },
    { href: "/initiatives", label: lang === "es" ? "Iniciativas" : "Initiatives", icon: IconList, match: (p: string) => p.startsWith("/initiatives") },
  ];

  return (
    <aside
      className="sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col justify-between border-r px-4 py-5 lg:flex"
      style={{ background: "var(--surface)" }}
    >
      <div>
        <Link href={`/${q}`} className="flex items-center gap-2.5 px-2" style={{ cursor: "pointer" }}>
          <EyeMark />
          <div className="leading-tight">
            <div className="serif text-[17px] font-semibold">Oculis Auribus</div>
            <div className="eyebrow mt-0.5">
              {lang === "es" ? "Inteligencia Legislativa" : "Legislative Intelligence"}
            </div>
          </div>
        </Link>

        <nav className="mt-7 flex flex-col gap-0.5">
          <div className="eyebrow px-2 pb-2">{lang === "es" ? "Módulos" : "Modules"}</div>
          {nav.map((n) => {
            const active = n.match(pathname);
            return (
              <Link
                key={n.href}
                href={`${n.href}${q}`}
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
    </aside>
  );
}

function EyeMark() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" fill="none" aria-hidden>
      <circle cx="16" cy="16" r="14.5" stroke="var(--accent)" strokeWidth="1.5" />
      <path d="M5 16c3-5 7-7.5 11-7.5S24 11 27 16c-3 5-7 7.5-11 7.5S8 21 5 16Z" stroke="var(--accent)" strokeWidth="1.5" />
      <circle cx="16" cy="16" r="3.4" fill="var(--accent)" />
    </svg>
  );
}

function ico(active?: boolean) {
  return {
    width: 17, height: 17, fill: "none",
    stroke: active ? "var(--accent)" : "currentColor",
    strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
}
function IconGrid({ active }: { active?: boolean }) {
  return (<svg {...ico(active)} viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>);
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
