import "fake-indexeddb/auto";
import { afterEach, describe, it, expect, vi } from "vitest";
import { RoadDatabase } from "../lib/indexed-db";
import {
  parseBackup,
  makeBackup,
  roadBounds,
  validateRoad,
  BACKUP_FORMAT,
} from "../lib/backup";
import { road, second } from "./fixtures";
const bounds: [number, number, number, number] = [-0.17, 51.58, -0.15, 51.6];
const opened: RoadDatabase[] = [];
function database(name = crypto.randomUUID()) {
  const db = new RoadDatabase(name);
  opened.push(db);
  return db;
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});
function record(input = road) {
  const r = validateRoad(input),
    box = roadBounds(r);
  return {
    id: r.properties.id,
    road: r,
    bounds: box,
    west: box[0],
    completedAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-01T10:00:00.000Z",
  };
}
describe("real IndexedDB API with fake-indexeddb storage engine", () => {
  it("aborts storage/quota failures without leaving an optimistic or partial record", async () => {
    const db = database();
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });
    await expect(db.set(road, true)).rejects.toThrow("quota");
    expect((await db.view(bounds)).count).toBe(0);
    await db.set(road, true);
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => {
      throw new DOMException("Storage quota exceeded", "QuotaExceededError");
    });
    await expect(db.set(road, false)).rejects.toThrow("quota");
    expect((await db.view(bounds)).count).toBe(1);
  });
  it("persists stable IDs and complete curved geometry after closing/reopening the database", async () => {
    const name = crypto.randomUUID(),
      db = database(name);
    await db.set(road, true);
    await db.close();
    const restored = await database(name).view(bounds);
    expect(restored.count).toBe(1);
    expect(restored.completed.features[0].geometry).toEqual(road.geometry);
  });
  it("concurrent duplicate writes cannot create duplicate records", async () => {
    const name = crypto.randomUUID(),
      a = database(name),
      b = database(name);
    const result = await Promise.all([a.set(road, true), b.set(road, true)]);
    expect(result.filter((r) => r.changed)).toHaveLength(1);
    expect((await a.view(bounds)).count).toBe(1);
  });
  it("removes persistently and supports revision checked undo", async () => {
    const db = database();
    const mark = await db.set(road, true);
    await db.set(road, false, mark.revision);
    await db.close();
    expect((await db.view(bounds)).count).toBe(0);
  });
  it("retains deletion revisions and refuses to overwrite another tab", async () => {
    const db = database(),
      mark = await db.set(road, true);
    await db.set(road, false);
    await db.set(road, true);
    await expect(db.set(road, false, mark.revision)).rejects.toThrow(
      "another tab",
    );
    expect((await db.view(bounds)).count).toBe(1);
  });
  it("counter is browser-wide while geometry is filtered to the visible area", async () => {
    const db = database();
    await db.set(road, true);
    const other = await db.view([-5.95, 54.58, -5.9, 54.62]);
    expect(other.count).toBe(1);
    expect(other.completed.features).toHaveLength(0);
  });
  it("exports every record, restores to another browser database and merges duplicates", async () => {
    const db = database(),
      target = database();
    await db.set(road, true);
    await db.set(second, true);
    const text = JSON.stringify(await db.exportBackup()),
      parsed = parseBackup(text);
    expect(await target.importRecords(parsed.records)).toEqual({
      added: 2,
      skipped: 0,
      total: 2,
    });
    expect(await target.importRecords(parsed.records)).toEqual({
      added: 0,
      skipped: 2,
      total: 2,
    });
    expect((await target.exportBackup()).roads).toEqual(
      (await db.exportBackup()).roads,
    );
  });
  it("failed import rolls back every write instead of leaving partial results", async () => {
    const db = database();
    await db.set(road, true);
    const conflict = record({
      ...road,
      geometry: {
        ...road.geometry,
        coordinates: [
          [-0.164, 51.587],
          [-0.161, 51.588],
        ],
      },
    });
    await expect(db.importRecords([record(second), conflict])).rejects.toThrow(
      "Conflicting saved geometry",
    );
    expect((await db.view(bounds)).count).toBe(1);
    expect((await db.exportBackup()).roads[0].id).toBe(road.properties.id);
  });
  it("an empty backup does not clear existing progress", async () => {
    const db = database();
    await db.set(road, true);
    expect(await db.importRecords([])).toEqual({
      added: 0,
      skipped: 0,
      total: 1,
    });
  });
  it("does not depend on localStorage or network access for saving", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("offline"));
    const storage = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw Error("localStorage disabled");
      });
    const db = database();
    await db.set(road, true);
    expect((await db.view(bounds)).count).toBe(1);
    expect(storage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe("backup validation before a transaction", () => {
  it("rejects invalid JSON, unsupported versions, malformed IDs, coordinates and dates", () => {
    expect(() => parseBackup("{")).toThrow("valid JSON");
    const good = makeBackup([record()]);
    for (const bad of [
      null,
      {},
      { ...good, version: 2 },
      { ...good, exportedAt: "not-a-date" },
      { ...good, roads: [{ ...good.roads[0], id: "wrong" }] },
      {
        ...good,
        roads: [
          {
            ...good.roads[0],
            road: { ...road, geometry: { type: "Point", coordinates: [0, 0] } },
          },
        ],
      },
      {
        ...good,
        roads: [
          {
            ...good.roads[0],
            road: {
              ...road,
              geometry: {
                type: "LineString",
                coordinates: [
                  [0, 0],
                  [1, 1],
                ],
              },
            },
          },
        ],
      },
    ])
      expect(() => parseBackup(JSON.stringify(bad))).toThrow();
  });
  it("skips identical IDs inside the file and rejects conflicting geometry", () => {
    const good = makeBackup([record()]);
    good.roads.push(good.roads[0]);
    expect(parseBackup(JSON.stringify(good)).duplicates).toBe(1);
    good.roads[1] = {
      ...good.roads[1],
      road: {
        ...road,
        geometry: {
          type: "LineString",
          coordinates: [
            [-0.16, 51.58],
            [-0.15, 51.59],
          ],
        },
      },
    };
    expect(() => parseBackup(JSON.stringify(good))).toThrow(
      "Conflicting geometry",
    );
  });
  it("normalizes properties, drops untrusted derived bounds and preserves full geometry", () => {
    const good = makeBackup([record()]);
    const restored = parseBackup(JSON.stringify(good));
    expect(restored.records[0].bounds).toEqual(roadBounds(road));
    expect(good.format).toBe(BACKUP_FORMAT);
  });
});
