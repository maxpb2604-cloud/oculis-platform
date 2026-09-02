"use client";

import { useSyncExternalStore } from "react";
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/topbar";
import { LegislatorProfileProvider } from "@/components/legislator-profile-provider";
import type { Lang } from "@/lib/i18n";

const SIDEBAR_STORAGE_KEY = "oculis-desktop-sidebar";
const SIDEBAR_CHANGE_EVENT = "oculis-sidebar-change";
let volatileSidebarOpen = true;

function readSidebarPreference() {
  if (typeof window === "undefined") return true;

  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (stored === "closed") return false;
    if (stored === "open") return true;
  } catch {
    // Local storage can be unavailable in privacy-restricted browsers.
  }
  return volatileSidebarOpen;
}

function subscribeToSidebarPreference(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SIDEBAR_STORAGE_KEY) onChange();
  };
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SIDEBAR_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function saveSidebarPreference(open: boolean) {
  volatileSidebarOpen = open;
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, open ? "open" : "closed");
  } catch {
    // The in-memory preference still keeps the control functional this session.
  }
  window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
}

export function AppShellFrame({
  lang,
  dateLabel,
  title,
  subtitle,
  titleIsHeading,
  children,
}: {
  lang: Lang;
  dateLabel: string;
  title: string;
  subtitle: string;
  titleIsHeading: boolean;
  children: React.ReactNode;
}) {
  const desktopSidebarOpen = useSyncExternalStore(
    subscribeToSidebarPreference,
    readSidebarPreference,
    () => true,
  );

  return (
    <LegislatorProfileProvider lang={lang}>
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[80] -translate-y-24 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
      >
        {lang === "es" ? "Saltar al contenido" : "Skip to content"}
      </a>
      <div className="flex min-h-dvh bg-[var(--bg)]">
        <Sidebar lang={lang} open={desktopSidebarOpen} />
        <div className="min-w-0 flex-1">
          <TopBar
            lang={lang}
            dateLabel={dateLabel}
            desktopSidebarOpen={desktopSidebarOpen}
            onDesktopSidebarToggle={() => saveSidebarPreference(!desktopSidebarOpen)}
          />
          <main
            id="main-content"
            tabIndex={-1}
            className="mx-auto w-full max-w-[1320px] px-4 pb-10 pt-6 sm:px-7 sm:pb-14 sm:pt-8 xl:px-10"
          >
            <header className="mb-7 border-b pb-6 sm:mb-9 sm:pb-8">
              {titleIsHeading ? (
                <h1 className="page-title max-w-[38ch]">{title}</h1>
              ) : (
                <div className="page-title max-w-[38ch]">{title}</div>
              )}
              {subtitle && <p className="page-subtitle mt-2.5">{subtitle}</p>}
            </header>
            {children}
          </main>
        </div>
      </div>
    </LegislatorProfileProvider>
  );
}
