/**
 * Province centroids used only to position the official-data aggregates on the map.
 * No counts or inferred values live in this static geometry file.
 */

export interface ProvinciaProps {
  nombre: string;
}

export interface ProvinciaFeature {
  type: "Feature";
  properties: ProvinciaProps;
  geometry: { type: "Point"; coordinates: [number, number] };
}

const RAW: Array<[string, number, number]> = [
  ["Distrito Nacional", -69.931, 18.486],
  ["Santo Domingo", -69.85, 18.55],
  ["Santiago", -70.7, 19.45],
  ["La Vega", -70.53, 19.22],
  ["San Cristóbal", -70.1, 18.42],
  ["Puerto Plata", -70.69, 19.79],
  ["Duarte", -70.07, 19.3],
  ["La Altagracia", -68.6, 18.58],
  ["San Pedro de Macorís", -69.3, 18.46],
  ["Espaillat", -70.28, 19.62],
  ["Azua", -70.73, 18.45],
  ["Barahona", -71.1, 18.21],
  ["Monte Plata", -69.78, 18.81],
  ["Peravia", -70.33, 18.28],
  ["Valverde", -70.98, 19.55],
  ["Sánchez Ramírez", -70.15, 19.05],
  ["María Trinidad Sánchez", -69.85, 19.38],
  ["Monseñor Nouel", -70.38, 18.93],
  ["La Romana", -68.97, 18.43],
  ["Hermanas Mirabal", -70.42, 19.37],
  ["Samaná", -69.34, 19.21],
  ["Baoruco", -71.42, 18.48],
  ["Independencia", -71.76, 18.5],
  ["Dajabón", -71.71, 19.55],
  ["Elías Piña", -71.7, 18.88],
  ["San Juan", -71.23, 18.81],
  ["Santiago Rodríguez", -71.34, 19.47],
  ["Monte Cristi", -71.65, 19.85],
  ["El Seibo", -69.04, 18.77],
  ["Hato Mayor", -69.26, 18.76],
  ["San José de Ocoa", -70.5, 18.55],
  ["Pedernales", -71.74, 18.04],
];

export const PROVINCIAS: ProvinciaFeature[] = RAW.map(([nombre, lng, lat]) => ({
  type: "Feature",
  properties: { nombre },
  geometry: { type: "Point", coordinates: [lng, lat] },
}));

export const PROVINCIAS_FC = {
  type: "FeatureCollection" as const,
  features: PROVINCIAS,
};

/** ISO 3166-2 ids used by the source-backed province boundary asset on HOME. */
export const PROVINCE_FEATURE_ID_BY_NAME: Readonly<Record<string, string>> = {
  "Distrito Nacional": "DO-01",
  Azua: "DO-02",
  Baoruco: "DO-03",
  Barahona: "DO-04",
  Dajabón: "DO-05",
  Duarte: "DO-06",
  "Elías Piña": "DO-07",
  "El Seibo": "DO-08",
  Espaillat: "DO-09",
  Independencia: "DO-10",
  "La Altagracia": "DO-11",
  "La Romana": "DO-12",
  "La Vega": "DO-13",
  "María Trinidad Sánchez": "DO-14",
  "Monte Cristi": "DO-15",
  Pedernales: "DO-16",
  Peravia: "DO-17",
  "Puerto Plata": "DO-18",
  "Hermanas Mirabal": "DO-19",
  Samaná: "DO-20",
  "San Cristóbal": "DO-21",
  "San Juan": "DO-22",
  "San Pedro de Macorís": "DO-23",
  "Sánchez Ramírez": "DO-24",
  Santiago: "DO-25",
  "Santiago Rodríguez": "DO-26",
  Valverde: "DO-27",
  "Monseñor Nouel": "DO-28",
  "Monte Plata": "DO-29",
  "Hato Mayor": "DO-30",
  "San José de Ocoa": "DO-31",
  "Santo Domingo": "DO-32",
};

/** Map centering for all three sketches. */
export const DR_CENTER: [number, number] = [-70.3, 18.9];
export const DR_ZOOM = 7.1;
