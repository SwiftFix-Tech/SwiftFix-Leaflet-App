import type { Road, Bounds } from "./types";

export const BACKUP_FORMAT = "swiftfix-leaflet-backup";
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const MAX_BACKUP_ROADS = 100_000;
const MAX_COORDINATES = 2_000_000;
export type CompletedRoad = {
  id: string;
  road: Road;
  bounds: Bounds;
  west: number;
  completedAt: string;
  updatedAt: string;
};
export type Backup = {
  format: typeof BACKUP_FORMAT;
  version: 1;
  exportedAt: string;
  roads: Omit<CompletedRoad, "bounds" | "west">[];
};
export type ImportResult = { added: number; skipped: number; total: number };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a JSON object.");
  return value as Record<string, unknown>;
}
function date(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT/.test(value) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("Invalid backup timestamp.");
  return new Date(value).toISOString();
}
export function roadBounds(road: Road): Bounds {
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  for (const [x, y] of road.geometry.coordinates) {
    west = Math.min(west, x);
    south = Math.min(south, y);
    east = Math.max(east, x);
    north = Math.max(north, y);
  }
  return [west, south, east, north];
}
export function intersects(a: Bounds, b: Bounds) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
export function validateRoad(value: unknown): Road {
  const f = object(value),
    p = object(f.properties),
    g = object(f.geometry);
  if (
    f.type !== "Feature" ||
    g.type !== "LineString" ||
    typeof p.id !== "string" ||
    !p.id.trim() ||
    p.id.length > 512 ||
    typeof p.name !== "string" ||
    p.name.length > 1024
  )
    throw new Error("Invalid road ID, name or geometry type.");
  if (
    !Array.isArray(g.coordinates) ||
    g.coordinates.length < 2 ||
    g.coordinates.length > 10000
  )
    throw new Error("A road must contain 2–10,000 coordinates.");
  const coordinates = g.coordinates.map((point) => {
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !point.every((n) => typeof n === "number" && Number.isFinite(n)) ||
      point[0] < -9 ||
      point[0] > 3 ||
      point[1] < 49 ||
      point[1] > 61.5
    )
      throw new Error("Invalid UK road coordinates.");
    return [point[0], point[1]] as [number, number];
  });
  if (
    !coordinates.some(
      (p) => p[0] !== coordinates[0][0] || p[1] !== coordinates[0][1],
    )
  )
    throw new Error("Road geometry has no length.");
  return {
    type: "Feature",
    id: p.id,
    properties: { id: p.id, name: p.name },
    geometry: { type: "LineString", coordinates },
  };
}
export function validateBackup(value: unknown): {
  records: CompletedRoad[];
  duplicates: number;
} {
  const doc = object(value);
  if (
    doc.format !== BACKUP_FORMAT ||
    doc.version !== 1 ||
    !Array.isArray(doc.roads)
  )
    throw new Error("Not a supported SwiftFix backup (version 1 required).");
  date(doc.exportedAt);
  if (doc.roads.length > MAX_BACKUP_ROADS)
    throw new Error("Backup contains too many road sections.");
  const records = new Map<string, CompletedRoad>();
  let duplicates = 0,
    coordinates = 0;
  for (const item of doc.roads) {
    const record = object(item),
      road = validateRoad(record.road);
    if (record.id !== road.properties.id)
      throw new Error("Backup road IDs do not match.");
    coordinates += road.geometry.coordinates.length;
    if (coordinates > MAX_COORDINATES)
      throw new Error("Backup contains too much geometry.");
    const bounds = roadBounds(road);
    const next = {
      id: road.properties.id,
      road,
      bounds,
      west: bounds[0],
      completedAt: date(record.completedAt),
      updatedAt: date(record.updatedAt),
    };
    const prior = records.get(next.id);
    if (prior) {
      if (JSON.stringify(prior.road.geometry) !== JSON.stringify(road.geometry))
        throw new Error("Conflicting geometry for a duplicate road ID.");
      duplicates++;
    } else records.set(next.id, next);
  }
  return { records: [...records.values()], duplicates };
}
export function makeBackup(records: CompletedRoad[]): Backup {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    roads: records
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, road, completedAt, updatedAt }) => ({
        id,
        road,
        completedAt,
        updatedAt,
      })),
  };
}
export function parseBackup(text: string) {
  if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
    throw new Error("Backup exceeds the 50 MiB limit.");
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  return validateBackup(doc);
}
