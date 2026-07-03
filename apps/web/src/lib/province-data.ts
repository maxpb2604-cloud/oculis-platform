/**
 * Draft province dataset for the map sketches — the 32 provinces of the Dominican
 * Republic (incl. Distrito Nacional) with approximate centroids and PLACEHOLDER
 * aggregates. Numbers here are illustrative for the map drafts; once wired to the DB
 * these come from sponsor-province aggregation over `initiatives` / `activity_events`.
 */
export type Riesgo = "alto" | "medio" | "bajo";

export interface ProvinciaProps {
  nombre: string;
  iniciativas: number; // total initiatives sponsored from the province
  actividad: number; //   committee/plenary touches (heatmap weight)
  riesgo: Riesgo; //       dominant business-risk level
}

export interface ProvinciaFeature {
  type: "Feature";
  properties: ProvinciaProps;
  geometry: { type: "Point"; coordinates: [number, number] };
}

const RAW: Array<[string, number, number, number, number, Riesgo]> = [
  // nombre, lng, lat, iniciativas, actividad, riesgo
  ["Distrito Nacional", -69.931, 18.486, 142, 96, "alto"],
  ["Santo Domingo", -69.85, 18.55, 118, 88, "alto"],
  ["Santiago", -70.7, 19.45, 87, 64, "alto"],
  ["La Vega", -70.53, 19.22, 41, 33, "medio"],
  ["San Cristóbal", -70.1, 18.42, 38, 29, "medio"],
  ["Puerto Plata", -70.69, 19.79, 34, 27, "medio"],
  ["Duarte", -70.07, 19.3, 29, 22, "medio"],
  ["La Altagracia", -68.6, 18.58, 33, 41, "alto"],
  ["San Pedro de Macorís", -69.3, 18.46, 26, 20, "medio"],
  ["Espaillat", -70.28, 19.62, 19, 14, "bajo"],
  ["Azua", -70.73, 18.45, 21, 16, "medio"],
  ["Barahona", -71.1, 18.21, 18, 13, "bajo"],
  ["Monte Plata", -69.78, 18.81, 15, 11, "bajo"],
  ["Peravia", -70.33, 18.28, 17, 12, "bajo"],
  ["Valverde", -70.98, 19.55, 14, 10, "bajo"],
  ["Sánchez Ramírez", -70.15, 19.05, 13, 9, "bajo"],
  ["María Trinidad Sánchez", -69.85, 19.38, 12, 8, "bajo"],
  ["Monseñor Nouel", -70.38, 18.93, 16, 11, "medio"],
  ["La Romana", -68.97, 18.43, 24, 19, "medio"],
  ["Hermanas Mirabal", -70.42, 19.37, 9, 6, "bajo"],
  ["Samaná", -69.34, 19.21, 15, 18, "medio"],
  ["Baoruco", -71.42, 18.48, 8, 5, "bajo"],
  ["Independencia", -71.76, 18.5, 7, 5, "bajo"],
  ["Dajabón", -71.71, 19.55, 9, 7, "bajo"],
  ["Elías Piña", -71.7, 18.88, 6, 4, "bajo"],
  ["San Juan", -71.23, 18.81, 18, 13, "medio"],
  ["Santiago Rodríguez", -71.34, 19.47, 7, 5, "bajo"],
  ["Monte Cristi", -71.65, 19.85, 10, 8, "bajo"],
  ["El Seibo", -69.04, 18.77, 9, 7, "bajo"],
  ["Hato Mayor", -69.26, 18.76, 8, 6, "bajo"],
  ["San José de Ocoa", -70.5, 18.55, 6, 4, "bajo"],
  ["Pedernales", -71.74, 18.04, 5, 4, "bajo"],
];

export const PROVINCIAS: ProvinciaFeature[] = RAW.map(
  ([nombre, lng, lat, iniciativas, actividad, riesgo]) => ({
    type: "Feature",
    properties: { nombre, iniciativas, actividad, riesgo },
    geometry: { type: "Point", coordinates: [lng, lat] },
  }),
);

/** Map centering for all three sketches. */
export const DR_CENTER: [number, number] = [-70.3, 18.9];
export const DR_ZOOM = 7.1;
