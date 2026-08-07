"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { DR_CENTER, DR_ZOOM } from "@/lib/province-data";
import { resolveProvince } from "@/lib/provinces";
import { t, type Lang } from "@/lib/i18n";
import type { ProvinceFC, LegislatorsByProvince, Legislator } from "@/lib/data";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

interface Selected {
  nombre: string;
  iniciativas: number;
  diputados: Legislator[];
  senadores: Legislator[];
}

/**
 * "Iniciativas por provincia" bubble map — proportional circles by initiative count.
 * Clicking a province opens a readable side panel listing its full elected roster — every
 * senator and deputy for that province (from the `legislators` table). Driven by real DB data.
 */
export interface ProvinceBubbleMapProps {
  data: ProvinceFC;
  legislators?: LegislatorsByProvince;
  height?: number;
  labelThreshold?: number;
  lang?: Lang;
}

export function ProvinceBubbleMap({
  data,
  legislators,
  height = 420,
  labelThreshold = 25,
  lang = "es",
}: ProvinceBubbleMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Selected | null>(null);

  const maxVal = Math.max(10, ...data.features.map((f) => f.properties.iniciativas));

  useEffect(() => {
    if (!TOKEN) {
      setErr(t(lang, "mapMissingToken"));
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
              "circle-radius": [
                "interpolate",
                ["linear"],
                ["get", "iniciativas"],
                0,
                5,
                maxVal,
                46,
              ],
              "circle-color": [
                "interpolate",
                ["linear"],
                ["get", "iniciativas"],
                0,
                "#274b6b",
                maxVal * 0.4,
                "#5aa8e6",
                maxVal,
                "#bfe3ff",
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
              "text-field": [
                "concat",
                ["get", "nombre"],
                "\n",
                ["to-string", ["get", "iniciativas"]],
              ],
              "text-size": 11,
              "text-allow-overlap": false,
            },
            paint: {
              "text-color": "#eaf2fb",
              "text-halo-color": "#06121f",
              "text-halo-width": 1.4,
            },
          });

          const onClick = (e: mapboxgl.MapLayerMouseEvent) => {
            const f = e.features?.[0];
            if (!f) return;
            const p = f.properties as { nombre: string; iniciativas: number };
            const legs = legislators?.[resolveProvince(p.nombre)] ?? {
              diputados: [],
              senadores: [],
            };
            setSel({
              nombre: p.nombre,
              iniciativas: p.iniciativas,
              diputados: legs.diputados,
              senadores: legs.senadores,
            });
          };
          map!.on("click", "prov-circles", onClick);
          map!.on("mouseenter", "prov-circles", () => (map!.getCanvas().style.cursor = "pointer"));
          map!.on("mouseleave", "prov-circles", () => (map!.getCanvas().style.cursor = ""));
        } catch (e) {
          setErr((e as Error).message);
        }
      });
      map.on("error", (e) => setErr(e.error?.message ?? t(lang, "mapError")));
    } catch (e) {
      setErr((e as Error).message);
    }
    return () => map?.remove();
  }, [data, maxVal, labelThreshold, legislators, lang]);

  return (
    <div className="relative">
      <div
        ref={ref}
        role="img"
        aria-label={t(lang, "mapAriaLabel")}
        style={{ height, width: "100%", background: "#0a0f14" }}
      />
      <div
        className="absolute left-3 top-3 z-10 rounded-lg p-2"
        style={{ background: "rgba(8,11,10,0.82)" }}
      >
        <label htmlFor="province-map-select" className="sr-only">
          {lang === "es" ? "Seleccionar provincia" : "Select province"}
        </label>
        <select
          id="province-map-select"
          value={sel?.nombre ?? ""}
          onChange={(event) => {
            const feature = data.features.find(
              (candidate) => candidate.properties.nombre === event.target.value,
            );
            if (!feature) {
              setSel(null);
              return;
            }
            const people = legislators?.[resolveProvince(feature.properties.nombre)] ?? {
              diputados: [],
              senadores: [],
            };
            setSel({
              nombre: feature.properties.nombre,
              iniciativas: feature.properties.iniciativas,
              diputados: people.diputados,
              senadores: people.senadores,
            });
          }}
          className="max-w-[220px] rounded-md border px-2 py-1 text-xs text-white"
          style={{ background: "#101923", borderColor: "rgba(255,255,255,0.24)" }}
        >
          <option value="">{lang === "es" ? "Seleccionar provincia" : "Select province"}</option>
          {data.features
            .slice()
            .sort((a, b) => a.properties.nombre.localeCompare(b.properties.nombre, "es"))
            .map((feature) => (
              <option key={feature.properties.nombre} value={feature.properties.nombre}>
                {feature.properties.nombre} · {feature.properties.iniciativas}
              </option>
            ))}
        </select>
      </div>
      {err && (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center p-4 text-center text-[12px]"
          style={{ background: "rgba(8,11,10,0.85)", color: "var(--text-muted)" }}
        >
          {err}
        </div>
      )}

      {/* Legend (decorative colour scale) */}
      <div
        aria-hidden
        className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-white/85"
        style={{ background: "rgba(8,11,10,0.7)", backdropFilter: "blur(4px)" }}
      >
        <span>{t(lang, "mapLess")}</span>
        <span
          className="h-2 w-24 rounded-full"
          style={{ background: "linear-gradient(90deg,#274b6b,#5aa8e6,#bfe3ff)" }}
        />
        <span>{t(lang, "mapMore")}</span>
      </div>

      {/* Click panel — readable list of legislators for the selected province */}
      {sel && (
        <div
          className="absolute right-3 top-3 bottom-3 flex w-[270px] flex-col rounded-xl text-white shadow-xl"
          style={{
            background: "rgba(10,15,20,0.94)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          {/* Scrollable content */}
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="serif text-[15px] font-semibold leading-tight">{sel.nombre}</div>
                <div className="mt-0.5 text-[11px] text-white/60">
                  {sel.iniciativas}{" "}
                  {t(lang, sel.iniciativas === 1 ? "initiative" : "initiativePlural")}
                </div>
              </div>
              <button
                onClick={() => setSel(null)}
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-white/70 hover:text-white"
                style={{ background: "rgba(255,255,255,0.08)" }}
              >
                {t(lang, "close")}
              </button>
            </div>

            <LegGroup
              title={t(lang, "senators")}
              legs={sel.senadores}
              empty={t(lang, "noSenator")}
            />
            <LegGroup
              title={t(lang, "deputies")}
              legs={sel.diputados}
              empty={t(lang, "noDeputies")}
            />
          </div>

          {/* Sticky close button at the bottom */}
          <div className="border-t p-3" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
            <button
              onClick={() => setSel(null)}
              className="w-full rounded-lg py-2 text-[13px] font-semibold text-white transition hover:brightness-110"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              {t(lang, "close")}
            </button>
          </div>
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
