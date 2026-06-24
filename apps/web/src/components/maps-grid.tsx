"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import {
  PROVINCIAS_FC,
  DR_CENTER,
  DR_ZOOM,
  RIESGO_COLORS,
} from "@/lib/province-data";
import type { ProvinceFC } from "@/lib/data";
import { ProvinceBubbleMap } from "@/components/province-bubble-map";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

type Builder = (map: mapboxgl.Map) => void;

/** Draft 2 — heatmap of legislative activity density. */
const buildCalor: Builder = (map) => {
  map.addSource("prov", { type: "geojson", data: PROVINCIAS_FC });
  map.addLayer({
    id: "prov-heat",
    type: "heatmap",
    source: "prov",
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "actividad"], 0, 0, 100, 1],
      "heatmap-intensity": 1.1,
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 6, 28, 9, 60],
      "heatmap-opacity": 0.85,
      "heatmap-color": [
        "interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(8,11,10,0)",
        0.2, "#104f86",
        0.45, "#1e7fc0",
        0.7, "#4aa3e0",
        1, "#bfe2fb",
      ],
    },
  });
  map.addLayer({
    id: "prov-heat-dots",
    type: "circle",
    source: "prov",
    paint: { "circle-radius": 2.5, "circle-color": "#dbeeff", "circle-opacity": 0.5 },
  });
};

/** Draft 3 — categorical dots colored by dominant business-risk level. */
const buildRiesgo: Builder = (map) => {
  map.addSource("prov", { type: "geojson", data: PROVINCIAS_FC });
  map.addLayer({
    id: "prov-riesgo",
    type: "circle",
    source: "prov",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["get", "iniciativas"], 5, 7, 150, 26],
      "circle-color": [
        "match", ["get", "riesgo"],
        "alto", RIESGO_COLORS.alto,
        "medio", RIESGO_COLORS.medio,
        RIESGO_COLORS.bajo,
      ],
      "circle-opacity": 0.85,
      "circle-stroke-width": 1,
      "circle-stroke-color": "rgba(0,0,0,0.35)",
    },
  });
};

interface MapSpec {
  key: string;
  title: string;
  subtitle: string;
  build: Builder;
  legend: React.ReactNode;
}

const SPECS: MapSpec[] = [
  {
    key: "calor",
    title: "Mapa de calor de actividad",
    subtitle: "Densidad de movimientos en comisión y pleno (heatmap)",
    build: buildCalor,
    legend: (
      <LegendRow>
        <span>Baja</span>
        <span className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(90deg,#104f86,#4aa3e0,#bfe2fb)" }} />
        <span>Alta</span>
      </LegendRow>
    ),
  },
  {
    key: "riesgo",
    title: "Riesgo de negocio por provincia",
    subtitle: "Nivel de riesgo dominante · tamaño = volumen de iniciativas",
    build: buildRiesgo,
    legend: (
      <LegendRow>
        <Swatch color={RIESGO_COLORS.alto} label="Alto" />
        <Swatch color={RIESGO_COLORS.medio} label="Medio" />
        <Swatch color={RIESGO_COLORS.bajo} label="Bajo" />
      </LegendRow>
    ),
  },
];

export function MapsGrid({ iniciativas }: { iniciativas: ProvinceFC }) {
  if (!TOKEN) return <MissingToken />;
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      {/* Map 1 — real data via the reusable bubble map (the one chosen for the dashboard). */}
      <div className="card overflow-hidden">
        <div className="border-b px-4 py-3">
          <div className="text-sm font-semibold">Iniciativas por provincia</div>
          <div className="eyebrow mt-0.5">Datos reales</div>
          <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
            Burbujas proporcionales · volumen de iniciativas por provincia del proponente
          </p>
        </div>
        <ProvinceBubbleMap data={iniciativas} />
      </div>
      {/* Maps 2 & 3 — still illustrative drafts. */}
      {SPECS.map((s) => (
        <DraftMap key={s.key} spec={s} />
      ))}
    </div>
  );
}

function DraftMap({ spec }: { spec: MapSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    mapboxgl.accessToken = TOKEN;
    let map: mapboxgl.Map | null = null;
    try {
      map = new mapboxgl.Map({
        container: ref.current,
        style: "mapbox://styles/mapbox/dark-v11",
        center: DR_CENTER,
        zoom: DR_ZOOM,
        attributionControl: false,
        cooperativeGestures: true,
      });
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => {
        try {
          spec.build(map!);
        } catch (e) {
          setErr((e as Error).message);
        }
      });
      map.on("error", (e) => setErr(e.error?.message ?? "Error de Mapbox"));
    } catch (e) {
      setErr((e as Error).message);
    }
    return () => map?.remove();
  }, [spec]);

  return (
    <div className="card overflow-hidden">
      <div className="border-b px-4 py-3">
        <div className="text-sm font-semibold">{spec.title}</div>
        <div className="eyebrow mt-0.5">Borrador</div>
        <p className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>{spec.subtitle}</p>
      </div>
      <div className="relative">
        <div ref={ref} className="h-[420px] w-full" style={{ background: "#0a0f14" }} />
        {err && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[12px]"
            style={{ background: "rgba(8,11,10,0.85)", color: "var(--text-muted)" }}>
            {err}
          </div>
        )}
        <div className="absolute bottom-3 left-3 rounded-lg px-2.5 py-1.5"
          style={{ background: "rgba(8,11,10,0.7)", backdropFilter: "blur(4px)" }}>
          {spec.legend}
        </div>
      </div>
    </div>
  );
}

function LegendRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-[10px] font-medium text-white/85">{children}</div>;
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function MissingToken() {
  return (
    <div className="card p-8 text-center">
      <div className="serif text-lg font-semibold">Falta el token de Mapbox</div>
      <p className="mx-auto mt-2 max-w-xl text-sm" style={{ color: "var(--text-muted)" }}>
        Para ver los borradores de mapas, agrega tu token público de Mapbox como
        <code className="mx-1 rounded px-1.5 py-0.5" style={{ background: "var(--surface-2)" }}>NEXT_PUBLIC_MAPBOX_TOKEN</code>
        en <code className="rounded px-1.5 py-0.5" style={{ background: "var(--surface-2)" }}>apps/web/.env.local</code> y reinicia el dev server.
      </p>
      <p className="mt-3 text-[12px]" style={{ color: "var(--text-muted)" }}>
        Obtén uno gratis en account.mapbox.com → Access tokens (empieza con <code>pk.</code>).
      </p>
    </div>
  );
}
