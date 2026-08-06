"use client";

import dynamic from "next/dynamic";
import type { ProvinceBubbleMapProps } from "@/components/province-bubble-map";

const DeferredProvinceMap = dynamic<ProvinceBubbleMapProps>(
  () => import("@/components/province-bubble-map").then((module) => module.ProvinceBubbleMap),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="flex h-[420px] items-center justify-center bg-[#0a0f14] p-4 text-center text-sm"
        style={{ color: "var(--text-muted)" }}
      >
        Cargando mapa…
      </div>
    ),
  },
);

export function LazyProvinceMap(props: ProvinceBubbleMapProps) {
  return <DeferredProvinceMap {...props} />;
}
