import { describe, it, expect, vi } from "vitest";
import { TrackerStore } from "../lib/tracker-store";
import { backend, road, second } from "./fixtures";
const bounds: [number, number, number, number] = [-0.17, 51.58, -0.15, 51.6];
describe("local persistence and optimistic transactions", () => {
  it("undo still changes the database and global counter after panning away", async () => {
    const db = backend();
    const s = new TrackerStore({
      ...db,
      view: async () => ({
        ...(await db.view()),
        completed: { type: "FeatureCollection", features: [] },
      }),
    });
    await s.mark(road, true);
    await s.load([-5.94, 54.59, -5.92, 54.61], 16, true);
    expect(s.snapshot().completed.features).toHaveLength(0);
    expect(s.snapshot().count).toBe(1);
    await s.undo();
    expect(db.saved.size).toBe(0);
    expect(s.snapshot().count).toBe(0);
  });
  it("click paints exact curved geometry blue immediately and persists", async () => {
    const db = backend(),
      store = new TrackerStore(db);
    await store.load(bounds, 16);
    const promise = store.mark(road, true);
    expect(store.snapshot().completed.features[0].geometry).toEqual(
      road.geometry,
    );
    expect(store.snapshot().count).toBe(1);
    await promise;
    expect(db.saved.size).toBe(1);
  });
  it("refresh restores saved geometry and another UK viewport retains total count", async () => {
    const db = backend();
    await new TrackerStore(db).mark(road, true);
    const reopened = new TrackerStore(db);
    await reopened.load([-5.94, 54.59, -5.92, 54.61], 16);
    expect(reopened.snapshot().completed.features[0]).toEqual(road);
    expect(reopened.snapshot().count).toBe(1);
  });
  it("two rapid clicks cannot create duplicate requests or records", async () => {
    const db = backend(),
      spy = vi.spyOn(db, "set"),
      s = new TrackerStore(db);
    s.mark(road, true);
    s.mark(road, true);
    await s.settled();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(db.saved.size).toBe(1);
  });
  it("a rapid removal while the mark is saving is queued and saved", async () => {
    const db = backend(),
      s = new TrackerStore(db);
    s.mark(road, true);
    s.mark(road, false);
    expect(s.snapshot().count).toBe(0);
    await s.settled();
    expect(db.saved.size).toBe(0);
  });
  it("removing deletes persisted record and undo recreates it", async () => {
    const db = backend(),
      s = new TrackerStore(db);
    await s.mark(road, true);
    await s.mark(road, false);
    expect(db.saved.size).toBe(0);
    expect(s.snapshot().count).toBe(0);
    await s.undo();
    expect(db.saved.size).toBe(1);
  });
  it("undoing mark also deletes from database", async () => {
    const db = backend(),
      s = new TrackerStore(db);
    await s.mark(road, true);
    await s.undo();
    expect(db.saved.size).toBe(0);
  });
  it("rapid independent edits serialize and counter stays accurate", async () => {
    const db = backend(),
      s = new TrackerStore(db);
    s.mark(road, true);
    s.mark(second, true);
    expect(s.snapshot().count).toBe(2);
    await s.settled();
    expect(db.saved.size).toBe(2);
    expect(s.snapshot().pending).toBe(0);
  });
  it("failed mark rolls back geometry and counter with a visible error", async () => {
    const db = backend(),
      s = new TrackerStore(db);
    db.setFail(true);
    await s.mark(road, true);
    expect(s.snapshot().completed.features).toHaveLength(0);
    expect(s.snapshot().count).toBe(0);
    expect(s.snapshot().error).toContain("Database unavailable");
  });
  it("failed deletion restores saved highlight", async () => {
    const db = backend(),
      s = new TrackerStore(db);
    await s.mark(road, true);
    db.setFail(true);
    await s.mark(road, false);
    expect(s.snapshot().completed.features).toHaveLength(1);
    expect(s.snapshot().count).toBe(1);
    expect(db.saved.size).toBe(1);
  });
  it("two tabs using the same browser database see the same map", async () => {
    const db = backend(),
      alice = new TrackerStore(db),
      bob = new TrackerStore(db);
    await alice.mark(road, true);
    await bob.load(bounds, 16);
    expect(bob.snapshot().count).toBe(1);
    await bob.mark(road, false);
    await alice.load(bounds, 16, true);
    expect(alice.snapshot().count).toBe(0);
  });
  it("undo checks revision instead of overwriting another tab's change", async () => {
    const db = backend(),
      s = new TrackerStore(db);
    await s.mark(road, true);
    await db.set(second, true);
    await s.undo();
    expect(s.snapshot().error).toContain("changed");
    expect(db.saved.size).toBe(2);
  });
  it("cached viewport requests coalesce, force refresh bypasses stale cache", async () => {
    const db = backend(),
      spy = vi.spyOn(db, "view"),
      s = new TrackerStore(db);
    await Promise.all([s.load(bounds, 16), s.load(bounds, 16)]);
    await s.load(bounds, 16);
    expect(spy).toHaveBeenCalledTimes(1);
    await s.load(bounds, 16, true);
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it("late viewport responses cannot erase an optimistic pending edit", async () => {
    const db = backend();
    let finish!: (value: Awaited<ReturnType<typeof db.view>>) => void;
    const stale = await db.view();
    const s = new TrackerStore({
      ...db,
      view: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const loading = s.load(bounds, 16);
    const saving = s.mark(road, true);
    finish(stale);
    await loading;
    expect(s.snapshot().completed.features).toHaveLength(1);
    await saving;
  });
});
