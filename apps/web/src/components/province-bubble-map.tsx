"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { DR_CENTER, DR_ZOOM } from "@/lib/province-data";
import type { ProvinceFC } from "@/lib/data";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

/**
 * Reusable "Iniciativas por provincia" bubble map — proportional circles sized + colored
 * by initiative count, labeled for the busiest provinces. Driven by a GeoJSON
 * FeatureCollection (real data from getInitiativesByProvince). Used on the main dashboard
 * and on /mapas.
 */
export function ProvinceBubbleMap({
  data,
  height = 420,
  labelThreshold = 25,
}: {
  data: ProvinceFC;
  height?: number;
  labelThreshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);

  // Scale the bubble ramp to the actual max so it reads well regardless of data volume.
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
          // Hover popup with the exact count.
          const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false });
          map!.on("mouseenter", "prov-circles", (e) => {
            map!.getCanvas().style.cursor = "pointer";
            const f = e.features?.[0];
            if (!f) return;
            const p = f.properties as { nombre: string; iniciativas: number };
            popup.setLngLat(e.lngLat).setHTML(
              `<strong>${p.nombre}</strong><br/>${p.iniciativas} iniciativa(s)`,
            ).addTo(map!);
          });
          map!.on("mouseleave", "prov-circles", () => {
            map!.getCanvas().style.cursor = "";
            popup.remove();
          });
        } catch (e) {
          setErr((e as Error).message);
        }
      });
      map.on("error", (e) => setErr(e.error?.message ?? "Error de Mapbox"));
    } catch (e) {
      setErr((e as Error).message);
    }
    return () => map?.remove();
  }, [data, maxVal, labelThreshold]);

  return (
    <div className="relative">
      <div ref={ref} style={{ height, width: "100%", background: "#0a0f14" }} />
      {err && (
        <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[12px]"
          style={{ background: "rgba(8,11,10,0.85)", color: "var(--text-muted)" }}>
          {err}
        </div>
      )}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-white/85"
        style={{ background: "rgba(8,11,10,0.7)", backdropFilter: "blur(4px)" }}>
        <span>Menos</span>
        <span className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(90deg,#274b6b,#5aa8e6,#bfe3ff)" }} />
        <span>Más</span>
      </div>
    </div>
  );
}
