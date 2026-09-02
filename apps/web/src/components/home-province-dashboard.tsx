"use client";

import Link from "next/link";
import { ArrowRight, CaretDown, CaretUp, UserCircle } from "@phosphor-icons/react";
import type { LegislatorSummary } from "@/lib/data";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import * as THREE from "three";
import {
  initiativeChamberLabel,
  legislatorRoleLabel,
  officialStatusLabel,
} from "@/lib/legislative-labels";
import { initiativeTitlePresentation } from "@/lib/initiative-title";
import { partyColor, partyDisplayLabel } from "@/lib/party-presentation";
import { LegislatorProfileTrigger } from "./legislator-profile-provider";
import { ProvinceCompositionCharts } from "./province-composition-charts";
import styles from "./home-province-dashboard.module.css";

const GEOJSON_URL = "/assets/oculis/province-map/dominican-republic-provinces.geojson";
const FALLBACK_MAP_URL = "/assets/oculis/province-map/dominican-republic-outline.png";

const MAP_COLORS = {
  inactiveTop: new THREE.Color("#e8edf4"),
  inactiveSide: new THREE.Color("#68758a"),
  inactiveEdge: new THREE.Color("#aab5c5"),
  availableTopLow: new THREE.Color("#f8fbff"),
  availableTopHigh: new THREE.Color("#c5d9ff"),
  availableSideLow: new THREE.Color("#60708a"),
  availableSideHigh: new THREE.Color("#315d9f"),
  availableEdgeLow: new THREE.Color("#93a3ba"),
  availableEdgeHigh: new THREE.Color("#5685dc"),
  selectedTop: new THREE.Color("#dce8ff"),
  selectedSide: new THREE.Color("#1648b4"),
  selectedEdge: new THREE.Color("#2f6df6"),
} as const;

export interface HomeProvinceInitiative {
  id: number;
  code: string | null;
  title: string;
  titleEn: string | null;
  status: string | null;
  chamber: string | null;
  filedAt: string | null;
  href: string;
}

export type HomeProvinceLegislator = LegislatorSummary;

export interface HomeProvinceDatum {
  id: string;
  featureIds: string[];
  label: string;
  initiativeCount: number;
  activeInitiativeCount: number;
  depositedInitiativeCount: number;
  allDepositedInitiativesHref: string;
  initiatives: HomeProvinceInitiative[];
  deputies: HomeProvinceLegislator[];
  senators: HomeProvinceLegislator[];
}

export interface HomeProvinceDashboardProps {
  provinces: HomeProvinceDatum[];
  lang: "es" | "en";
}

type Position = [number, number];
type PolygonCoordinates = Position[][];
type MultiPolygonCoordinates = Position[][][];

interface ProvinceGeoFeature {
  type: "Feature";
  properties: {
    id: string;
    name: string;
    type?: string;
  };
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: PolygonCoordinates | MultiPolygonCoordinates;
  };
}

interface ProvinceFeatureCollection {
  type: "FeatureCollection";
  features: ProvinceGeoFeature[];
}

interface MapProvinceEntry {
  provinceId: string;
  intensity: number;
}

interface ProvinceVisualData {
  featureId: string;
  available: boolean;
  currentLift: number;
  targetLift: number;
  baseTop: THREE.Color;
  baseSide: THREE.Color;
  baseEdge: THREE.Color;
  topMaterials: THREE.MeshStandardMaterial[];
  sideMaterials: THREE.MeshStandardMaterial[];
  edgeMaterials: THREE.LineBasicMaterial[];
}

type DetailSectionId = "initiatives" | "senate" | "deputies";

const copy = {
  es: {
    eyebrow: "Panorama territorial",
    title: "Mapa Oculis",
    intro:
      "Explora la representación legislativa y las iniciativas según la provincia publicada para su proponente principal.",
    instruction: "Selecciona una provincia directamente en el mapa.",
    selected: "Provincia seleccionada",
    initiatives: "iniciativas",
    initiative: "iniciativa",
    legislators: "congresistas",
    legislator: "congresista",
    activeInitiatives: "vigentes",
    activeInitiative: "vigente",
    preparing: "Preparando mapa provincial",
    mapAlt: "Mapa de las provincias de República Dominicana",
    mapLabel: "Mapa tridimensional de las provincias de República Dominicana",
    tabListLabel: "Provincias de República Dominicana",
    selectProvince: "Seleccionar",
    panelKicker: "Actividad y representación",
    panelTitle: "Detalle de la provincia",
    initiativesHeading: "Últimas iniciativas depositadas",
    initiativeCount: "Iniciativas",
    activeInitiativeCount: "Vigentes (condición oficial)",
    congressCount: "Congresistas",
    senateCount: "Senadores",
    deputyCount: "Diputados",
    senate: "Senado de la República",
    deputies: "Cámara de Diputados",
    noInitiatives:
      "La fuente oficial no reporta iniciativas depositadas para un proponente principal de esta provincia.",
    noSenators: "La fuente consultada no reporta senadores para esta provincia.",
    noDeputies: "La fuente consultada no reporta diputados para esta provincia.",
    showCount: (shown: number, total: number) =>
      `Mostrando las últimas ${shown} de ${total} depositadas`,
    allShown: (count: number) =>
      `${count} ${count === 1 ? "iniciativa depositada" : "iniciativas depositadas"}`,
    viewAllDeposited: (province: string) => `Ver todas las iniciativas depositadas de ${province}`,
    openInitiative: "Abrir ficha de la iniciativa",
    oculisTranslation: "Traducción de Oculis",
    officialSpanishTitle: "Título oficial en español",
    translationPending: "Traducción al inglés pendiente; se muestra el título oficial en español",
    openProfile: (name: string) => `Abrir perfil de ${name}`,
    unknownCode: "Código no informado",
    methodology:
      "Las iniciativas se atribuyen a la provincia publicada para su proponente principal; esto no describe el alcance territorial del proyecto de ley. La lista muestra como máximo las cinco más recientes cuyo Estado oficial es DEPOSITADO. El conteo de «vigentes» incluye únicamente iniciativas cuya fuente publica literalmente Condición oficial = VIGENTE; no se infiere a partir del estado, la actividad ni la ausencia de datos. Los cargos de representación nacional no se asignan a ninguna provincia.",
  },
  en: {
    eyebrow: "Territorial overview",
    title: "Oculis Map",
    intro:
      "Explore legislative representation and initiatives by the principal sponsor's published province.",
    instruction: "Select a province directly on the map.",
    selected: "Selected province",
    initiatives: "initiatives",
    initiative: "initiative",
    legislators: "members of Congress",
    legislator: "member of Congress",
    activeInitiatives: "active initiatives",
    activeInitiative: "active initiative",
    preparing: "Preparing province map",
    mapAlt: "Map of the provinces of the Dominican Republic",
    mapLabel: "Three-dimensional map of the provinces of the Dominican Republic",
    tabListLabel: "Provinces of the Dominican Republic",
    selectProvince: "Select",
    panelKicker: "Activity and representation",
    panelTitle: "Province details",
    initiativesHeading: "Latest filed initiatives",
    initiativeCount: "Initiatives",
    activeInitiativeCount: "Active initiatives (official condition)",
    congressCount: "Members of Congress",
    senateCount: "Senators",
    deputyCount: "Deputies",
    senate: "Senate of the Republic",
    deputies: "Chamber of Deputies",
    noInitiatives:
      "The official source reports no filed initiatives for a principal sponsor from this province.",
    noSenators: "The consulted source does not report senators for this province.",
    noDeputies: "The consulted source does not report deputies for this province.",
    showCount: (shown: number, total: number) =>
      `Showing the latest ${shown} of ${total} filed initiatives`,
    allShown: (count: number) => `${count} filed ${count === 1 ? "initiative" : "initiatives"}`,
    viewAllDeposited: (province: string) => `View all filed initiatives from ${province}`,
    openInitiative: "Open initiative record",
    oculisTranslation: "Oculis translation",
    officialSpanishTitle: "Official title in Spanish",
    translationPending: "English translation pending; official title shown in Spanish",
    openProfile: (name: string) => `Open ${name}'s profile`,
    unknownCode: "Code not reported",
    methodology:
      "Initiatives are attributed to the principal sponsor's published province; this does not describe the bill's territorial scope. The list shows at most the five most recent initiatives whose official status is Filed. The “active” count includes only initiatives whose official condition is Active; it is not inferred from status, activity, or missing data. National representation is not assigned to any province.",
  },
} as const;

function visitCoordinates(coordinates: unknown, visitor: (position: Position) => void) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    visitor([coordinates[0], coordinates[1]]);
    return;
  }
  coordinates.forEach((part) => visitCoordinates(part, visitor));
}

function geometryBounds(featureCollection: ProvinceFeatureCollection) {
  const bounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  featureCollection.features.forEach((feature) => {
    visitCoordinates(feature.geometry.coordinates, ([longitude, latitude]) => {
      bounds.minX = Math.min(bounds.minX, longitude);
      bounds.minY = Math.min(bounds.minY, latitude);
      bounds.maxX = Math.max(bounds.maxX, longitude);
      bounds.maxY = Math.max(bounds.maxY, latitude);
    });
  });

  return bounds;
}

function ringToPoints(
  ring: Position[],
  project: (longitude: number, latitude: number) => [number, number],
  clockwise: boolean,
) {
  const points = ring.map(([longitude, latitude]) => {
    const [x, y] = project(longitude, latitude);
    return new THREE.Vector2(x, y);
  });

  if (points.length > 1 && points[0].equals(points.at(-1)!)) points.pop();
  if (THREE.ShapeUtils.isClockWise(points) !== clockwise) points.reverse();
  return points;
}

function polygonToShape(
  polygon: PolygonCoordinates,
  project: (longitude: number, latitude: number) => [number, number],
) {
  const outer = ringToPoints(polygon[0], project, true);
  const shape = new THREE.Shape(outer);

  polygon.slice(1).forEach((ring) => {
    const holePoints = ringToPoints(ring, project, false);
    if (holePoints.length >= 3) shape.holes.push(new THREE.Path(holePoints));
  });

  return shape;
}

function polygonsForGeometry(feature: ProvinceGeoFeature) {
  return feature.geometry.type === "MultiPolygon"
    ? (feature.geometry.coordinates as MultiPolygonCoordinates)
    : [feature.geometry.coordinates as PolygonCoordinates];
}

function intensityColor(low: THREE.Color, high: THREE.Color, intensity: number) {
  return low.clone().lerp(high, Math.min(1, Math.max(0, Math.sqrt(intensity))));
}

function buildProvinceVisual({
  feature,
  project,
  entry,
}: {
  feature: ProvinceGeoFeature;
  project: (longitude: number, latitude: number) => [number, number];
  entry: MapProvinceEntry | undefined;
}) {
  const group = new THREE.Group();
  const topMaterials: THREE.MeshStandardMaterial[] = [];
  const sideMaterials: THREE.MeshStandardMaterial[] = [];
  const edgeMaterials: THREE.LineBasicMaterial[] = [];
  const meshes: THREE.Mesh[] = [];
  const available = Boolean(entry);
  const baseTop = available
    ? intensityColor(MAP_COLORS.availableTopLow, MAP_COLORS.availableTopHigh, entry!.intensity)
    : MAP_COLORS.inactiveTop.clone();
  const baseSide = available
    ? intensityColor(MAP_COLORS.availableSideLow, MAP_COLORS.availableSideHigh, entry!.intensity)
    : MAP_COLORS.inactiveSide.clone();
  const baseEdge = available
    ? intensityColor(MAP_COLORS.availableEdgeLow, MAP_COLORS.availableEdgeHigh, entry!.intensity)
    : MAP_COLORS.inactiveEdge.clone();

  polygonsForGeometry(feature).forEach((polygon) => {
    const shape = polygonToShape(polygon, project);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: 1.12,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.055,
      bevelThickness: 0.08,
      curveSegments: 1,
      steps: 1,
    });

    const topMaterial = new THREE.MeshStandardMaterial({
      color: baseTop,
      metalness: 0,
      roughness: 0.92,
    });
    const sideMaterial = new THREE.MeshStandardMaterial({
      color: baseSide,
      metalness: 0,
      roughness: 0.98,
    });
    const mesh = new THREE.Mesh(geometry, [topMaterial, sideMaterial]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.featureId = feature.properties.id;
    mesh.userData.available = available;
    meshes.push(mesh);
    group.add(mesh);

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: baseEdge,
      transparent: true,
      opacity: available ? 0.94 : 0.72,
    });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 22), edgeMaterial);
    edges.renderOrder = 3;
    group.add(edges);

    topMaterials.push(topMaterial);
    sideMaterials.push(sideMaterial);
    edgeMaterials.push(edgeMaterial);
  });

  group.userData = {
    featureId: feature.properties.id,
    available,
    currentLift: 0,
    targetLift: 0,
    baseTop,
    baseSide,
    baseEdge,
    topMaterials,
    sideMaterials,
    edgeMaterials,
  } satisfies ProvinceVisualData;

  return { group, meshes };
}

function ProvinceMap3D({
  selectedFeatureIds,
  provinceByFeature,
  selectedProvinceLabel,
  selectedInitiativeCount,
  selectedActiveInitiativeCount,
  onSelectProvince,
  lang,
}: {
  selectedFeatureIds: string[];
  provinceByFeature: Record<string, MapProvinceEntry>;
  selectedProvinceLabel: string;
  selectedInitiativeCount: number;
  selectedActiveInitiativeCount: number;
  onSelectProvince: (provinceId: string) => void;
  lang: "es" | "en";
}) {
  const labels = copy[lang];
  const mountRef = useRef<HTMLDivElement>(null);
  const onSelectRef = useRef(onSelectProvince);
  const selectedIdsRef = useRef(new Set(selectedFeatureIds));
  const provinceMapRef = useRef(provinceByFeature);
  const hoveredFeatureRef = useRef<string | null>(null);
  const syncStateRef = useRef<() => void>(() => undefined);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    onSelectRef.current = onSelectProvince;
  }, [onSelectProvince]);

  useEffect(() => {
    selectedIdsRef.current = new Set(selectedFeatureIds);
    provinceMapRef.current = provinceByFeature;
    syncStateRef.current();
  }, [selectedFeatureIds, provinceByFeature]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    const mountElement = mount;

    let disposed = false;
    let renderer: THREE.WebGLRenderer | undefined;
    let frameId: number | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let visibilityObserver: IntersectionObserver | undefined;
    let reducedMotionQuery: MediaQueryList | undefined;
    let isVisible = true;
    let lastTimestamp = performance.now();
    const disposables: Array<() => void> = [];

    async function initialize() {
      try {
        const response = await fetch(GEOJSON_URL);
        if (!response.ok) throw new Error(`Province geometry request failed: ${response.status}`);
        const featureCollection = (await response.json()) as ProvinceFeatureCollection;
        if (disposed) return;

        const bounds = geometryBounds(featureCollection);
        const centerLongitude = (bounds.minX + bounds.maxX) / 2;
        const centerLatitude = (bounds.minY + bounds.maxY) / 2;
        const latitudeScale = Math.cos((centerLatitude * Math.PI) / 180);
        const project = (longitude: number, latitude: number): [number, number] => [
          (longitude - centerLongitude) * 10.4 * latitudeScale,
          (latitude - centerLatitude) * 10.4,
        ];

        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(-30, 30, 18, -18, 0.1, 180);
        camera.position.set(0, -42, 50);
        camera.lookAt(0, 0.5, 0);

        renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.06;
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.domElement.className = styles.canvas;
        renderer.domElement.setAttribute("aria-hidden", "true");
        mountElement.appendChild(renderer.domElement);

        scene.add(new THREE.HemisphereLight(0xffffff, 0x30415d, 2.15));
        const keyLight = new THREE.DirectionalLight(0xffffff, 3.9);
        keyLight.position.set(-23, -29, 48);
        keyLight.castShadow = true;
        keyLight.shadow.mapSize.set(2048, 2048);
        keyLight.shadow.camera.left = -36;
        keyLight.shadow.camera.right = 36;
        keyLight.shadow.camera.top = 26;
        keyLight.shadow.camera.bottom = -26;
        keyLight.shadow.bias = -0.0003;
        scene.add(keyLight);

        const root = new THREE.Group();
        scene.add(root);
        const pickableMeshes: THREE.Mesh[] = [];
        const provinceVisuals = new Map<string, THREE.Group>();

        featureCollection.features.forEach((feature) => {
          const entry = provinceMapRef.current[feature.properties.id];
          const { group, meshes } = buildProvinceVisual({ feature, project, entry });
          root.add(group);
          provinceVisuals.set(feature.properties.id, group);
          if (entry) pickableMeshes.push(...meshes);
        });

        const rootBounds = new THREE.Box3().setFromObject(root);
        const rootCenter = rootBounds.getCenter(new THREE.Vector3());
        root.position.set(-rootCenter.x, -rootCenter.y, 0);

        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(82, 48),
          new THREE.ShadowMaterial({ color: 0x061a3a, opacity: 0.2, transparent: true }),
        );
        ground.position.z = -0.24;
        ground.receiveShadow = true;
        scene.add(ground);

        const prefersReducedMotion = () => reducedMotionQuery?.matches ?? false;

        function syncVisualState() {
          provinceVisuals.forEach((group, featureId) => {
            const data = group.userData as ProvinceVisualData;
            const isSelected = selectedIdsRef.current.has(featureId);
            const isHovered = hoveredFeatureRef.current === featureId;
            data.targetLift = isSelected ? 2.55 : isHovered && data.available ? 0.48 : 0;
            if (prefersReducedMotion()) {
              data.currentLift = data.targetLift;
              group.position.z = data.currentLift;
            }

            data.topMaterials.forEach((material) => {
              material.color.copy(isSelected ? MAP_COLORS.selectedTop : data.baseTop);
            });
            data.sideMaterials.forEach((material) => {
              material.color.copy(isSelected ? MAP_COLORS.selectedSide : data.baseSide);
            });
            data.edgeMaterials.forEach((material) => {
              material.color.copy(isSelected ? MAP_COLORS.selectedEdge : data.baseEdge);
              material.opacity = isSelected ? 1 : data.available ? 0.94 : 0.72;
            });
          });
        }

        syncStateRef.current = syncVisualState;
        syncVisualState();

        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();

        function pointerFeature(event: PointerEvent | MouseEvent) {
          if (!renderer) return null;
          const rect = renderer.domElement.getBoundingClientRect();
          pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
          pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
          raycaster.setFromCamera(pointer, camera);
          const intersection = raycaster.intersectObjects(pickableMeshes, false)[0];
          return (intersection?.object?.userData?.featureId as string | undefined) ?? null;
        }

        function onPointerMove(event: PointerEvent) {
          const featureId = pointerFeature(event);
          if (hoveredFeatureRef.current === featureId || !renderer) return;
          hoveredFeatureRef.current = featureId;
          renderer.domElement.style.cursor = featureId ? "pointer" : "default";
          syncVisualState();
        }

        function onPointerLeave() {
          hoveredFeatureRef.current = null;
          if (renderer) renderer.domElement.style.cursor = "default";
          syncVisualState();
        }

        function onClick(event: MouseEvent) {
          const featureId = pointerFeature(event);
          const provinceId = featureId ? provinceMapRef.current[featureId]?.provinceId : null;
          if (provinceId) onSelectRef.current(provinceId);
        }

        function onContextLost(event: Event) {
          event.preventDefault();
          if (!disposed) setStatus("error");
        }

        renderer.domElement.addEventListener("pointermove", onPointerMove);
        renderer.domElement.addEventListener("pointerleave", onPointerLeave);
        renderer.domElement.addEventListener("click", onClick);
        renderer.domElement.addEventListener("webglcontextlost", onContextLost);

        disposables.push(() => {
          renderer?.domElement.removeEventListener("pointermove", onPointerMove);
          renderer?.domElement.removeEventListener("pointerleave", onPointerLeave);
          renderer?.domElement.removeEventListener("click", onClick);
          renderer?.domElement.removeEventListener("webglcontextlost", onContextLost);
        });

        function resize() {
          if (!renderer) return;
          const width = Math.max(mountElement.clientWidth, 1);
          const height = Math.max(mountElement.clientHeight, 1);
          const aspect = width / height;
          const designWidth = 44;
          const designHeight = 21.5;
          if (aspect >= designWidth / designHeight) {
            camera.top = designHeight / 2;
            camera.bottom = -designHeight / 2;
            camera.right = (designHeight * aspect) / 2;
            camera.left = -camera.right;
          } else {
            camera.right = designWidth / 2;
            camera.left = -designWidth / 2;
            camera.top = designWidth / aspect / 2;
            camera.bottom = -camera.top;
          }
          camera.updateProjectionMatrix();
          renderer.setSize(width, height, false);
        }

        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(mountElement);
        resize();

        visibilityObserver = new IntersectionObserver(
          ([entry]) => {
            isVisible = entry.isIntersecting;
          },
          { rootMargin: "120px" },
        );
        visibilityObserver.observe(mountElement);

        reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        reducedMotionQuery.addEventListener?.("change", syncVisualState);

        function render(timestamp: number) {
          if (disposed || !renderer) return;
          const delta = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
          lastTimestamp = timestamp;
          if (isVisible) {
            provinceVisuals.forEach((group) => {
              const data = group.userData as ProvinceVisualData;
              const easing =
                1 - Math.exp(-delta * (selectedIdsRef.current.has(data.featureId) ? 9 : 12));
              data.currentLift = THREE.MathUtils.lerp(data.currentLift, data.targetLift, easing);
              group.position.z = data.currentLift;
            });
            renderer.render(scene, camera);
          }
          frameId = requestAnimationFrame(render);
        }

        frameId = requestAnimationFrame(render);
        setStatus("ready");

        disposables.push(() => {
          reducedMotionQuery?.removeEventListener?.("change", syncVisualState);
          root.traverse((object) => {
            if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
              object.geometry.dispose();
              if (Array.isArray(object.material)) {
                object.material.forEach((material: THREE.Material) => material.dispose());
              } else {
                object.material.dispose();
              }
            }
          });
          ground.geometry.dispose();
          ground.material.dispose();
        });
      } catch (error) {
        if (!disposed) {
          console.error(error);
          setStatus("error");
        }
      }
    }

    void initialize();

    return () => {
      disposed = true;
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      visibilityObserver?.disconnect();
      disposables.forEach((dispose) => dispose());
      renderer?.dispose();
      renderer?.domElement.remove();
      syncStateRef.current = () => undefined;
    };
  }, []);

  return (
    <div
      className={`${styles.map3d} ${status === "ready" ? styles.mapReady : ""}`}
      ref={mountRef}
      role="img"
      aria-label={`${labels.mapLabel}. ${labels.selected}: ${selectedProvinceLabel}. ${selectedInitiativeCount} ${
        selectedInitiativeCount === 1 ? labels.initiative : labels.initiatives
      }; ${selectedActiveInitiativeCount} ${
        selectedActiveInitiativeCount === 1 ? labels.activeInitiative : labels.activeInitiatives
      }.`}
    >
      {status === "loading" ? <span className={styles.mapStatus}>{labels.preparing}</span> : null}
      {status === "error" ? (
        <img
          className={styles.fallbackMap}
          src={FALLBACK_MAP_URL}
          width={1280}
          height={700}
          alt={labels.mapAlt}
        />
      ) : null}
      <img
        className={styles.forcedColorsFallback}
        src={FALLBACK_MAP_URL}
        width={1280}
        height={700}
        alt=""
        aria-hidden="true"
      />
    </div>
  );
}

function formatDate(value: string | null, lang: "es" | "en") {
  if (!value) return null;
  const dateInput = /^\d{4}-\d{2}-\d{2}/.test(value) ? `${value.slice(0, 10)}T12:00:00` : value;
  const parsed = new Date(dateInput);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(lang === "es" ? "es-DO" : "en-US", {
    dateStyle: "medium",
    timeZone: "America/Santo_Domingo",
  }).format(parsed);
}

function PersonList({
  people,
  empty,
  openProfile,
  lang,
  singleColumn = false,
}: {
  people: HomeProvinceLegislator[];
  empty: string;
  openProfile: (name: string) => string;
  lang: "es" | "en";
  singleColumn?: boolean;
}) {
  if (people.length === 0) return <p className={styles.emptyState}>{empty}</p>;

  return (
    <ol className={`${styles.personList} ${singleColumn ? styles.personListSingleColumn : ""}`}>
      {people.map((person, index) => {
        const party = partyDisplayLabel(person.party, null, lang);
        return (
          <li key={person.profileId}>
            <span className={styles.personIndex}>{String(index + 1).padStart(2, "0")}</span>
            <LegislatorProfileTrigger
              className={styles.personButton}
              profileId={person.profileId}
              fullName={person.fullName}
              chamber={person.chamber}
              role={person.role}
              party={person.party}
              province={person.province}
              ariaLabel={`${openProfile(person.fullName)}, ${party}`}
            >
              <span>
                <strong>{person.fullName}</strong>
                <small>
                  <span className="inline-flex items-start gap-1.5">
                    <span
                      aria-hidden="true"
                      className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: partyColor(person.party) }}
                    />
                    <span>
                      {[legislatorRoleLabel(person.role, person.chamber, lang), party]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                </small>
              </span>
              <UserCircle
                className={styles.personProfileIcon}
                size={18}
                weight="bold"
                aria-hidden="true"
              />
            </LegislatorProfileTrigger>
          </li>
        );
      })}
    </ol>
  );
}

function moveGlassHighlight(event: ReactPointerEvent<HTMLDivElement>) {
  if (
    event.pointerType === "touch" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    window.matchMedia("(prefers-reduced-transparency: reduce)").matches
  ) {
    return;
  }
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = ((event.clientX - bounds.left) / bounds.width) * 100;
  const y = ((event.clientY - bounds.top) / bounds.height) * 100;
  event.currentTarget.style.setProperty("--province-glass-x", `${x}%`);
  event.currentTarget.style.setProperty("--province-glass-y", `${y}%`);
}

function resetGlassHighlight(event: ReactPointerEvent<HTMLDivElement>) {
  event.currentTarget.style.setProperty("--province-glass-x", "52%");
  event.currentTarget.style.setProperty("--province-glass-y", "0%");
}

export function HomeProvinceDashboard({ provinces, lang }: HomeProvinceDashboardProps) {
  const labels = copy[lang];
  const instanceId = useId().replace(/:/g, "");
  const sortedProvinces = useMemo(
    () =>
      [...provinces].sort((a, b) => a.label.localeCompare(b.label, lang === "es" ? "es-DO" : "en")),
    [lang, provinces],
  );
  const defaultProvince =
    sortedProvinces.find(
      (province) => province.id === "santo-domingo" || province.featureIds.includes("DO-32"),
    ) ?? sortedProvinces[0];
  const [selectedProvinceId, setSelectedProvinceId] = useState(defaultProvince?.id ?? "");
  const [expandedDetail, setExpandedDetail] = useState<{
    provinceId: string;
    section: DetailSectionId;
  } | null>(null);
  useEffect(() => {
    if (!sortedProvinces.some((province) => province.id === selectedProvinceId)) {
      setExpandedDetail(null);
      setSelectedProvinceId(defaultProvince?.id ?? "");
    }
  }, [defaultProvince?.id, selectedProvinceId, sortedProvinces]);

  const selectedProvince =
    sortedProvinces.find((province) => province.id === selectedProvinceId) ?? defaultProvince;
  const expandedDetailSection =
    expandedDetail?.provinceId === selectedProvince?.id ? expandedDetail.section : null;
  const maxInitiativeCount = Math.max(
    1,
    ...sortedProvinces.map((province) => province.initiativeCount),
  );
  const provinceByFeature = useMemo(
    () =>
      Object.fromEntries(
        sortedProvinces.flatMap((province) =>
          province.featureIds.map((featureId) => [
            featureId,
            {
              provinceId: province.id,
              intensity: province.initiativeCount / maxInitiativeCount,
            } satisfies MapProvinceEntry,
          ]),
        ),
      ),
    [maxInitiativeCount, sortedProvinces],
  );

  if (!selectedProvince) {
    return (
      <section className={styles.section} aria-labelledby={`province-title-${instanceId}`}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>{labels.eyebrow}</p>
          <h2 className={styles.title} id={`province-title-${instanceId}`}>
            {labels.title}
          </h2>
          <p className={styles.intro}>{labels.noInitiatives}</p>
        </header>
      </section>
    );
  }

  const totalLegislators = selectedProvince.deputies.length + selectedProvince.senators.length;
  const initiativeNoun =
    selectedProvince.initiativeCount === 1 ? labels.initiative : labels.initiatives;
  const activeInitiativeNoun =
    selectedProvince.activeInitiativeCount === 1
      ? labels.activeInitiative
      : labels.activeInitiatives;
  const legislatorNoun = totalLegislators === 1 ? labels.legislator : labels.legislators;
  const initiativePanelMeta =
    selectedProvince.initiatives.length < selectedProvince.depositedInitiativeCount
      ? labels.showCount(
          selectedProvince.initiatives.length,
          selectedProvince.depositedInitiativeCount,
        )
      : labels.allShown(selectedProvince.initiatives.length);

  function selectProvince(provinceId: string) {
    if (provinceId !== selectedProvinceId) {
      setExpandedDetail(null);
    }
    setSelectedProvinceId(provinceId);
  }

  function toggleDetailSection(sectionId: DetailSectionId) {
    setExpandedDetail((current) =>
      current?.provinceId === selectedProvince.id && current.section === sectionId
        ? null
        : { provinceId: selectedProvince.id, section: sectionId },
    );
  }

  return (
    <section className={styles.section} aria-labelledby={`province-title-${instanceId}`}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{labels.eyebrow}</p>
          <h2 className={styles.title} id={`province-title-${instanceId}`}>
            {labels.title}
          </h2>
        </div>
        <div className={styles.headerCopy}>
          <p className={styles.intro}>{labels.intro}</p>
          <p className={styles.instruction}>{labels.instruction}</p>
        </div>
      </header>

      <div className={styles.provinceWorkspace}>
        <figure className={styles.mapFigure}>
          <div className={styles.mapStage}>
            <ProvinceMap3D
              selectedFeatureIds={selectedProvince.featureIds}
              provinceByFeature={provinceByFeature}
              selectedProvinceLabel={selectedProvince.label}
              selectedInitiativeCount={selectedProvince.initiativeCount}
              selectedActiveInitiativeCount={selectedProvince.activeInitiativeCount}
              onSelectProvince={selectProvince}
              lang={lang}
            />
          </div>
          <figcaption className={styles.mapCaption}>
            <div className={styles.mapCaptionText}>
              <strong>{selectedProvince.label}</strong>
              <span>
                {labels.selected} · {selectedProvince.initiativeCount} {initiativeNoun} ·{" "}
                {selectedProvince.activeInitiativeCount} {activeInitiativeNoun} · {totalLegislators}{" "}
                {legislatorNoun}
              </span>
            </div>
            <label className={styles.provincePicker}>
              <span>{labels.selectProvince}</span>
              <select
                aria-label={labels.tabListLabel}
                value={selectedProvince.id}
                onChange={(event) => selectProvince(event.currentTarget.value)}
              >
                {sortedProvinces.map((province) => (
                  <option value={province.id} key={province.id}>
                    {province.label}
                  </option>
                ))}
              </select>
            </label>
          </figcaption>
        </figure>

        <div
          className={styles.glassPanel}
          onPointerMove={moveGlassHighlight}
          onPointerLeave={resetGlassHighlight}
        >
          <div
            className={styles.detailPanel}
            id={`province-panel-${instanceId}`}
            role="region"
            aria-labelledby={`province-detail-title-${instanceId}`}
          >
            <div className={styles.liveRegion} aria-live="polite" aria-atomic="true">
              {selectedProvince.label}: {selectedProvince.initiativeCount} {initiativeNoun};{" "}
              {selectedProvince.activeInitiativeCount} {activeInitiativeNoun}; {totalLegislators}{" "}
              {legislatorNoun}.
            </div>

            <header className={styles.detailHeader}>
              <div>
                <p>{labels.panelKicker}</p>
                <h3 id={`province-detail-title-${instanceId}`}>{selectedProvince.label}</h3>
              </div>
              <span>{labels.panelTitle}</span>
            </header>

            <ProvinceCompositionCharts
              province={selectedProvince.label}
              totalInitiatives={selectedProvince.initiativeCount}
              activeInitiatives={selectedProvince.activeInitiativeCount}
              partyAffiliations={[
                ...selectedProvince.senators.map((member) => member.party),
                ...selectedProvince.deputies.map((member) => member.party),
              ]}
              lang={lang}
            />

            <div className={styles.detailGrid} key={selectedProvince.id}>
              <section
                className={styles.detailSection}
                aria-labelledby={`initiatives-${instanceId}`}
                data-expanded={expandedDetailSection === "initiatives"}
              >
                <header className={styles.sectionHeader}>
                  <h4>
                    <button
                      className={styles.sectionToggle}
                      id={`initiatives-${instanceId}`}
                      type="button"
                      aria-expanded={expandedDetailSection === "initiatives"}
                      aria-controls={`initiatives-content-${instanceId}`}
                      onClick={() => toggleDetailSection("initiatives")}
                    >
                      <span>{labels.initiativesHeading}</span>
                      <span className={styles.sectionToggleMeta}>
                        <span>{selectedProvince.depositedInitiativeCount}</span>
                        {expandedDetailSection === "initiatives" ? (
                          <CaretUp size={18} weight="bold" aria-hidden="true" />
                        ) : (
                          <CaretDown size={18} weight="bold" aria-hidden="true" />
                        )}
                      </span>
                    </button>
                  </h4>
                </header>
                <div
                  className={styles.sectionBody}
                  id={`initiatives-content-${instanceId}`}
                  role="region"
                  aria-labelledby={`initiatives-${instanceId}`}
                  hidden={expandedDetailSection !== "initiatives"}
                >
                  <p className={styles.sectionMeta}>{initiativePanelMeta}</p>
                  {selectedProvince.initiatives.length === 0 ? (
                    <p className={styles.emptyState}>{labels.noInitiatives}</p>
                  ) : (
                    <ol className={styles.initiativeList}>
                      {selectedProvince.initiatives.map((initiative, index) => {
                        const filedAt = formatDate(initiative.filedAt, lang);
                        const title = initiativeTitlePresentation(initiative, lang);
                        const pendingDescriptionId = title.isTranslationPending
                          ? `initiative-translation-pending-${instanceId}-${initiative.id}`
                          : undefined;
                        const metadata = [
                          initiativeChamberLabel(initiative.chamber, lang),
                          officialStatusLabel(initiative.status, lang),
                          filedAt,
                        ].filter(Boolean);
                        return (
                          <li key={initiative.id}>
                            <span className={styles.initiativeIndex}>
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <Link
                              className={styles.initiativeLink}
                              href={initiative.href}
                              aria-label={`${labels.openInitiative}: ${title.text}`}
                              aria-describedby={pendingDescriptionId}
                            >
                              <span>
                                <small>{initiative.code || labels.unknownCode}</small>
                                <strong lang={title.contentLanguage}>{title.text}</strong>
                                {title.isOculisTranslation ? (
                                  <span className={styles.translationBadge}>
                                    {labels.oculisTranslation}
                                  </span>
                                ) : null}
                                {title.isTranslationPending ? (
                                  <span
                                    className={styles.translationPendingNotice}
                                    id={pendingDescriptionId}
                                  >
                                    {labels.translationPending}
                                  </span>
                                ) : null}
                                {metadata.length > 0 ? <em>{metadata.join(" · ")}</em> : null}
                              </span>
                              <ArrowRight size={17} weight="bold" aria-hidden="true" />
                            </Link>
                            {title.isOculisTranslation ? (
                              <details className={styles.officialTitleDisclosure}>
                                <summary>{labels.officialSpanishTitle}</summary>
                                <p lang="es">{title.officialSpanishTitle}</p>
                              </details>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  <Link
                    className={styles.viewAllLink}
                    href={selectedProvince.allDepositedInitiativesHref}
                  >
                    <span>{labels.viewAllDeposited(selectedProvince.label)}</span>
                    <ArrowRight size={17} weight="bold" aria-hidden="true" />
                  </Link>
                </div>
              </section>

              <section
                className={styles.detailSection}
                aria-labelledby={`senate-${instanceId}`}
                data-expanded={expandedDetailSection === "senate"}
              >
                <header className={styles.sectionHeader}>
                  <h4>
                    <button
                      className={styles.sectionToggle}
                      id={`senate-${instanceId}`}
                      type="button"
                      aria-expanded={expandedDetailSection === "senate"}
                      aria-controls={`senate-content-${instanceId}`}
                      onClick={() => toggleDetailSection("senate")}
                    >
                      <span>{labels.senate}</span>
                      <span className={styles.sectionToggleMeta}>
                        <span>{selectedProvince.senators.length}</span>
                        {expandedDetailSection === "senate" ? (
                          <CaretUp size={18} weight="bold" aria-hidden="true" />
                        ) : (
                          <CaretDown size={18} weight="bold" aria-hidden="true" />
                        )}
                      </span>
                    </button>
                  </h4>
                </header>
                <div
                  className={styles.sectionBody}
                  id={`senate-content-${instanceId}`}
                  role="region"
                  aria-labelledby={`senate-${instanceId}`}
                  hidden={expandedDetailSection !== "senate"}
                >
                  <PersonList
                    people={selectedProvince.senators}
                    empty={labels.noSenators}
                    openProfile={labels.openProfile}
                    lang={lang}
                    singleColumn
                  />
                </div>
              </section>

              <section
                className={styles.detailSection}
                aria-labelledby={`deputies-${instanceId}`}
                data-expanded={expandedDetailSection === "deputies"}
              >
                <header className={styles.sectionHeader}>
                  <h4>
                    <button
                      className={styles.sectionToggle}
                      id={`deputies-${instanceId}`}
                      type="button"
                      aria-expanded={expandedDetailSection === "deputies"}
                      aria-controls={`deputies-content-${instanceId}`}
                      onClick={() => toggleDetailSection("deputies")}
                    >
                      <span>{labels.deputies}</span>
                      <span className={styles.sectionToggleMeta}>
                        <span>{selectedProvince.deputies.length}</span>
                        {expandedDetailSection === "deputies" ? (
                          <CaretUp size={18} weight="bold" aria-hidden="true" />
                        ) : (
                          <CaretDown size={18} weight="bold" aria-hidden="true" />
                        )}
                      </span>
                    </button>
                  </h4>
                </header>
                <div
                  className={styles.sectionBody}
                  id={`deputies-content-${instanceId}`}
                  role="region"
                  aria-labelledby={`deputies-${instanceId}`}
                  hidden={expandedDetailSection !== "deputies"}
                >
                  <PersonList
                    people={selectedProvince.deputies}
                    empty={labels.noDeputies}
                    openProfile={labels.openProfile}
                    lang={lang}
                  />
                </div>
              </section>
            </div>

            <p className={styles.methodology}>{labels.methodology}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
