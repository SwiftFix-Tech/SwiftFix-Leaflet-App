import { emptyRoads, type Road, type View } from "../lib/types";
// Synthetic test-only geometry. Never loaded by the production app.
export const road: Road = {
  type: "Feature",
  geometry: {
    type: "LineString",
    coordinates: [
      [-0.164, 51.587],
      [-0.163, 51.5873],
      [-0.162, 51.5871],
    ],
  },
  properties: { id: "test:curve:1", name: "Test Road" },
};
export const second: Road = {
  ...road,
  properties: { id: "test:curve:2", name: "Test Street" },
};
export function backend() {
  const saved = new Map<string, Road>();
  let rev = 0,
    fail = false;
  return {
    saved,
    setFail: (value: boolean) => {
      fail = value;
    },
    async view(): Promise<View> {
      return {
        roads: { type: "FeatureCollection", features: [road, second] },
        completed: { type: "FeatureCollection", features: [...saved.values()] },
        count: saved.size,
        revision: rev,
      };
    },
    async set(r: Road, c: boolean, expected?: string) {
      if (fail) throw new Error("Database unavailable");
      if (expected && expected !== String(rev))
        throw new Error("This road changed since your action.");
      const changed = saved.has(r.properties.id) !== c;
      if (c) saved.set(r.properties.id, r);
      else saved.delete(r.properties.id);
      if (changed) rev++;
      return { changed, completed: c, revision: String(rev) };
    },
  };
}
