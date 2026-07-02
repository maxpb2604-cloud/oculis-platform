"use client";

import dynamic from "next/dynamic";

/**
 * Lazy wrapper so mapbox-gl (the single heaviest client dependency) only loads
 * when the map actually renders — it must never sit in a page's First Load JS.
 * The placeholder mirrors the map's 420px panel footprint to avoid layout shift.
 */
export const ProvinceBubbleMapLazy = dynamic(
  () => import("./province-bubble-map").then((m) => m.ProvinceBubbleMap),
  {
    ssr: false,
    loading: () => <div className="skeleton" style={{ height: 420 }} aria-hidden />,
  },
);
