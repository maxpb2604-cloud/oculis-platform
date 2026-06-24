"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { DR_CENTER, DR_ZOOM } from "@/lib/province-data";
import type { ProvinceFC, LegislatorsByProvince, Legislator } from "@/lib/data";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

interface Selected {
  nombre: string;
  iniciativas: number;
  diputados: Legislator[];
  senadores: Legislator[];
}

/**
 * "Iniciativas por provincia" bubble map — proportional circles by initiative count.
 * Clicking a province opens a readable side panel listing its legislators (deputies and
 * senators known from initiative sponsors). Driven by real data from the DB.
 */
export function ProvinceBubbleMap({
  data,
  legislators,
  height = 420,
  labelThreshold = 25,
}: {
  data: ProvinceFC;
  legislators?: LegislatorsByProvince;
  height?: number;
  labelThreshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Selected | null>(null);

  const maxVal = Math.max(10, ...data.features.map((f) => f.properties.iniciativas));

  useEffect(() => {
    if (!TOKEN) {
      setErr("Falta NEXT_PUBLIC_MAPBOX_TOKEN");
      return;
    }
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
          map!.addSource("prov", { type: "geojson", data });
          map!.addLayer({
            id: "prov-circles",
            type: "circle",
            source: "prov",
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["get", "iniciativas"], 0, 5, maxVal, 46],
              "circle-color": [
                "interpolate", ["linear"], ["get", "iniciativas"],
                0, "#274b6b", maxVal * 0.4, "#5aa8e6", maxVal, "#bfe3ff",
              ],
              "circle-opacity": 0.88,
              "circle-stroke-width": 1.2,
              "circle-stroke-color": "rgba(255,255,255,0.45)",
            },
          });
          map!.addLayer({
            id: "prov-labels",
            type: "symbol",
            source: "prov",
            filter: [">", ["get", "iniciativas"], labelThreshold],
            layout: {
              "text-field": ["concat", ["get", "nombre"], "\n", ["to-string", ["get", "iniciativas"]]],
              "text-size": 11,
              "text-allow-overlap": false,
            },
            paint: { "text-color": "#eaf2fb", "text-halo-color": "#06121f", "text-halo-width": 1.4 },
          });

          const onClick = (e: mapboxgl.MapLayerMouseEvent) => {
            const f = e.features?.[0];
            if (!f) return;
            const p = f.properties as { nombre: string; iniciativas: number };
            const legs = legislators?.[norm(p.nombre)] ?? { diputados: [], senadores: [] };
            setSel({ nombre: p.nombre, iniciativas: p.iniciativas, diputados: legs.diputados, senadores: legs.senadores });
          };
          map!.on("click", "prov-circles", onClick);
          map!.on("mouseenter", "prov-circles", () => (map!.getCanvas().style.cursor = "pointer"));
          map!.on("mouseleave", "prov-circles", () => (map!.getCanvas().style.cursor = ""));
        } catch (e) {
          setErr((e as Error).message);
        }
      });
      map.on("error", (e) => setErr(e.error?.message ?? "Error de Mapbox"));
    } catch (e) {
      setErr((e as Error).message);
    }
    return () => map?.remove();
  }, [data, maxVal, labelThreshold, legislators]);

  return (
    <div className="relative">
      <div ref={ref} style={{ height, width: "100%", background: "#0a0f14" }} />
      {err && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[12px]"
          style={{ background: "rgba(8,11,10,0.85)", color: "var(--text-muted)" }}>
          {err}
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-white/85"
        style={{ background: "rgba(8,11,10,0.7)", backdropFilter: "blur(4px)" }}>
        <span>Menos</span>
        <span className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(90deg,#274b6b,#5aa8e6,#bfe3ff)" }} />
        <span>Más</span>
      </div>

      {/* Click panel — readable list of legislators for the selected province */}
      {sel && (
        <div className="absolute right-3 top-3 bottom-3 w-[270px] overflow-y-auto rounded-xl p-4 text-white shadow-xl"
          style={{ background: "rgba(10,15,20,0.94)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.12)" }}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="serif text-[15px] font-semibold leading-tight">{sel.nombre}</div>
              <div className="mt-0.5 text-[11px] text-white/60">{sel.iniciativas} iniciativa(s)</div>
            </div>
            <button onClick={() => setSel(null)} aria-label="Cerrar"
              className="rounded-md px-1.5 text-white/60 hover:text-white" style={{ background: "rgba(255,255,255,0.08)" }}>✕</button>
          </div>

          <LegGroup title="Diputados" legs={sel.diputados} empty="Sin diputados con iniciativas registradas." />
          <LegGroup title="Senadores" legs={sel.senadores} empty="Roster de senadores aún no integrado en la plataforma." />
        </div>
      )}
    </div>
  );
}

function LegGroup({ title, legs, empty }: { title: string; legs: Legislator[]; empty: string }) {
  return (
    <div className="mt-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-white/45">
        {title} {legs.length > 0 && <span className="text-white/30">· {legs.length}</span>}
      </div>
      {legs.length === 0 ? (
        <p className="mt-1 text-[11px] leading-snug text-white/40">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {legs.map((l, i) => (
            <li key={`${l.name}-${i}`} className="leading-tight">
              <div className="text-[12.5px] font-medium">{l.name}</div>
              <div className="text-[10.5px] text-white/50">
                {[l.role, l.party].filter(Boolean).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
