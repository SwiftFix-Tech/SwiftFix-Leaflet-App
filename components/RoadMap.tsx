"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type GeoJSONSource, type Map as GLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Crosshair,
  Minus,
  Plus,
  MapPin,
  Check,
  Trash2,
  LoaderCircle,
} from "lucide-react";
import { LongPress } from "../lib/gestures";
import type { Bounds, Road, Roads } from "../lib/types";
import type { Place } from "./Search";
const HOME: [number, number] = [-0.164, 51.587];
type Props = {
  roads: Roads;
  completed: Roads;
  place: Place | null;
  loading: boolean;
  onView: (b: Bounds, z: number) => void;
  onMark: (r: Road, c: boolean) => void;
};
type Menu = { road: Road; completed: boolean; x: number; y: number };
export default function RoadMap({
  roads,
  completed,
  place,
  loading,
  onView,
  onMark,
}: Props) {
  const index = useMemo(
    () =>
      new Map(
        [...roads.features, ...completed.features].map((road) => [
          road.properties.id,
          road,
        ]),
      ),
    [roads, completed],
  );
  const roadIndex = useRef(index);
  roadIndex.current = index;
  const host = useRef<HTMLDivElement>(null),
    map = useRef<GLMap | null>(null),
    props = useRef({ roads, completed, onView, onMark });
  props.current = { roads, completed, onView, onMark };
  const [ready, setReady] = useState(false),
    [zoom, setZoom] = useState(15),
    [menu, setMenu] = useState<Menu | null>(null),
    [mapError, setMapError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const mapKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  useEffect(() => {
    if (!host.current || !mapKey) return;
    let alive = true;
    const press = new LongPress();
    let suppressClickUntil = 0;
    const m = new maplibregl.Map({
      container: host.current,
      style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${process.env.NEXT_PUBLIC_MAPTILER_KEY}`,
      center: HOME,
      zoom: 15,
      maxZoom: 20,
      minZoom: 4,
      maxBounds: [
        [-8.9, 49.1],
        [2.8, 61.4],
      ],
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
      touchPitch: false,
    });
    map.current = m;
    m.touchZoomRotate.disableRotation();
    const pick = (x: number, y: number): Road | undefined => {
      if (!m.getLayer("road-hit") || m.getZoom() < 14) return;
      const hit = m.queryRenderedFeatures(
        [
          [x - 7, y - 7],
          [x + 7, y + 7],
        ],
        { layers: ["completed-hit", "road-hit"] },
      );
      // Nearest complete centreline in screen pixels, independent of tile fragments.
      const ids = new Set(hit.map((f) => f.properties.id as string));
      const candidates = [...ids]
        .map((id) => roadIndex.current.get(id))
        .filter((road): road is Road => Boolean(road));
      let best: Road | undefined,
        dist = Infinity;
      for (const road of candidates) {
        const points = road.geometry.coordinates.map((p) =>
          m.project([p[0], p[1]]),
        );
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1],
            b = points[i],
            dx = b.x - a.x,
            dy = b.y - a.y;
          const t = Math.max(
            0,
            Math.min(
              1,
              ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1),
            ),
          );
          const d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
          if (d < dist) {
            dist = d;
            best = road;
          }
        }
      }
      return dist <= 14 ? best : undefined;
    };
    const openMenu = (x: number, y: number) => {
      const road = pick(x, y);
      if (!road) return;
      setMenu({
        road,
        completed: props.current.completed.features.some(
          (f) => f.properties.id === road.properties.id,
        ),
        x: Math.max(8, Math.min(x, host.current!.clientWidth - 240)),
        y: Math.max(8, Math.min(y, host.current!.clientHeight - 180)),
      });
    };
    const report = () => {
      const b = m.getBounds();
      setZoom(m.getZoom());
      props.current.onView(
        [
          Math.max(-8.9, Math.floor(b.getWest() * 500) / 500),
          Math.max(49.1, Math.floor(b.getSouth() * 500) / 500),
          Math.min(2.8, Math.ceil(b.getEast() * 500) / 500),
          Math.min(61.4, Math.ceil(b.getNorth() * 500) / 500),
        ],
        m.getZoom(),
      );
    };
    m.on("load", () => {
      if (!alive) return;
      m.addSource("roads", { type: "geojson", data: props.current.roads });
      m.addSource("completed", {
        type: "geojson",
        data: props.current.completed,
        attribution:
          'Road geometry © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (ODbL)',
      });
      const before = m.getStyle().layers?.find((l) => l.type === "symbol")?.id;
      m.addLayer(
        {
          id: "completed-line",
          type: "line",
          source: "completed",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#1683FF",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              12,
              2,
              16,
              6,
              20,
              11,
            ],
            "line-opacity": 0.92,
          },
        },
        before,
      );
      m.addLayer({
        id: "road-hit",
        type: "line",
        source: "roads",
        minzoom: 14,
        paint: {
          "line-width": 20,
          "line-color": "#1683FF",
          "line-opacity": 0.001,
        },
      });
      m.addLayer({
        id: "completed-hit",
        type: "line",
        source: "completed",
        minzoom: 14,
        paint: {
          "line-width": 20,
          "line-color": "#1683FF",
          "line-opacity": 0.001,
        },
      });
      setReady(true);
      report();
    });
    m.on("moveend", report);
    m.on("dragstart", () => {
      press.cancel();
      setMenu(null);
    });
    m.on("zoomstart", () => {
      press.cancel();
      setMenu(null);
    });
    m.on("click", (e) => {
      if (Date.now() < suppressClickUntil) return;
      setMenu(null);
      const road = pick(e.point.x, e.point.y);
      if (road) props.current.onMark(road, true);
    });
    m.on("contextmenu", (e) => {
      e.preventDefault();
      e.originalEvent.preventDefault();
      openMenu(e.point.x, e.point.y);
    });
    m.on("mousemove", (e) => {
      m.getCanvas().style.cursor = pick(e.point.x, e.point.y) ? "pointer" : "";
    });
    m.on("error", () => {
      if (alive)
        setMapError(
          "A map resource failed to load. Check your connection and MapTiler key.",
        );
    });
    const canvas = m.getCanvas();
    const local = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse") return;
      const p = local(e);
      if (!e.isPrimary) {
        press.cancel();
        return;
      }
      press.start(p.x, p.y, () => {
        suppressClickUntil = Date.now() + 900;
        openMenu(p.x, p.y);
      });
    };
    const move = (e: PointerEvent) => {
      const p = local(e);
      press.move(p.x, p.y);
    };
    const end = () => {
      press.cancel();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    return () => {
      alive = false;
      press.cancel();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", end);
      canvas.removeEventListener("pointercancel", end);
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (ready)
      (map.current?.getSource("roads") as GeoJSONSource)?.setData(roads);
  }, [roads, ready]);
  useEffect(() => {
    if (ready)
      (map.current?.getSource("completed") as GeoJSONSource)?.setData(
        completed,
      );
  }, [completed, ready]);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || !place) return;
    if (place.bbox)
      m.fitBounds(
        [
          [place.bbox[0], place.bbox[1]],
          [place.bbox[2], place.bbox[3]],
        ],
        { padding: 70, maxZoom: 17, duration: 1200 },
      );
    else m.flyTo({ center: place.center, zoom: 16, duration: 1200 });
  }, [place, ready]);
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector("button")?.focus();
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenu(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [menu]);
  return (
    <main className="map-shell" aria-label="UK leaflet distribution map">
      <div className="map-canvas" ref={host} />
      {!mapKey && (
        <div className="map-setup" role="status">
          <MapPin size={26} />
          <strong>Add your MapTiler key to open the UK map</strong>
          <p>
            Set NEXT_PUBLIC_MAPTILER_KEY and redeploy. Local backup and restore
            are available here.
          </p>
        </div>
      )}
      <div className="location-chip">
        <MapPin size={15} />
        <span>
          {place?.place_name.split(",")[0] || "East Finchley, London"}
        </span>
        <span className="country-tag">UK</span>
      </div>
      <div className="map-controls">
        <button
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => map.current?.zoomIn()}
        >
          <Plus size={20} />
        </button>
        <button
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => map.current?.zoomOut()}
        >
          <Minus size={20} />
        </button>
        <div />
        <button
          aria-label="Re-centre on East Finchley"
          title="Re-centre on East Finchley"
          onClick={() =>
            map.current?.flyTo({ center: HOME, zoom: 15, duration: 1000 })
          }
        >
          <Crosshair size={20} />
        </button>
      </div>
      <div className="map-hint">
        {loading ? (
          <>
            <LoaderCircle className="spin" size={15} />
            Loading road sections…
          </>
        ) : zoom < 14 ? (
          "Zoom in to select individual road sections"
        ) : (
          <>
            <span className="blue-dot" />
            Click a road to mark it completed
          </>
        )}
      </div>
      {mapError && (
        <div className="map-error" role="alert">
          {mapError}
          <button
            onClick={() => setMapError("")}
            aria-label="Dismiss map error"
          >
            ×
          </button>
        </div>
      )}
      {menu && (
        <div
          className="road-menu"
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
          role="dialog"
          aria-label="Road section actions"
        >
          <strong>{menu.road.properties.name || "Unnamed road"}</strong>
          <p>
            <span className={menu.completed ? "blue-dot" : "grey-dot"} />
            {menu.completed ? "Completed" : "Not completed"}
          </p>
          <button
            onClick={() => {
              onMark(menu.road, !menu.completed);
              setMenu(null);
            }}
          >
            {menu.completed ? <Trash2 size={16} /> : <Check size={16} />}{" "}
            {menu.completed ? "Remove Highlight" : "Mark as Completed"}
          </button>
        </div>
      )}
    </main>
  );
}
