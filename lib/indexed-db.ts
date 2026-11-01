import type { Bounds, Mutation, Road } from "./types";
import {
  intersects,
  makeBackup,
  roadBounds,
  validateRoad,
  type CompletedRoad,
  type ImportResult,
} from "./backup";

const DB_NAME = "swiftfix-leaflet-tracker";
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error || new Error("Browser storage request failed."));
  });
}
function complete(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        tx.error || new Error("Browser storage transaction was cancelled."),
      );
    tx.onerror = () => {};
  });
}
function transaction(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(["completed", "revisions", "meta"], mode);
}
export class RoadDatabase {
  private opening?: Promise<IDBDatabase>;
  private channel?: BroadcastChannel;
  private listeners = new Set<() => void>();
  constructor(
    private name = DB_NAME,
    private factory?: IDBFactory,
  ) {}
  private open(): Promise<IDBDatabase> {
    if (this.opening) return this.opening;
    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = this.factory ?? globalThis.indexedDB;
      if (!factory) {
        reject(
          new Error(
            "IndexedDB is unavailable. Enable browser storage before marking roads.",
          ),
        );
        return;
      }
      const req = factory.open(this.name, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const roads = db.createObjectStore("completed", { keyPath: "id" });
        roads.createIndex("west", "west");
        db.createObjectStore("revisions", { keyPath: "id" });
        db.createObjectStore("meta");
      };
      req.onerror = () =>
        reject(
          new Error(
            `Could not open browser storage: ${req.error?.message || "permission denied"}`,
          ),
        );
      req.onblocked = () =>
        reject(
          new Error(
            "Browser storage upgrade is blocked. Close other SwiftFix tabs and reload.",
          ),
        );
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          this.opening = undefined;
          this.emit();
        };
        resolve(db);
      };
    }).catch((error) => {
      this.opening = undefined;
      throw error;
    });
    return this.opening;
  }
  private emit() {
    this.listeners.forEach((listener) => listener());
  }
  private changed() {
    this.emit();
    this.channel?.postMessage("changed");
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    if (typeof BroadcastChannel !== "undefined" && !this.channel) {
      this.channel = new BroadcastChannel(this.name);
      this.channel.onmessage = () => this.emit();
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.channel?.close();
        this.channel = undefined;
      }
    };
  }
  async view(bounds: Bounds) {
    const db = await this.open(),
      tx = transaction(db, "readonly"),
      done = complete(tx),
      store = tx.objectStore("completed");
    const count = request(store.count()),
      revision = request<number | undefined>(
        tx.objectStore("meta").get("revision"),
      );
    const records: CompletedRoad[] = [];
    const scan = new Promise<void>((resolve, reject) => {
      const cursor = store
        .index("west")
        .openCursor(IDBKeyRange.upperBound(bounds[2]));
      cursor.onerror = () => reject(cursor.error);
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) {
          resolve();
          return;
        }
        const record = c.value as CompletedRoad;
        if (intersects(record.bounds, bounds)) records.push(record);
        c.continue();
      };
    });
    const [total, rev] = await Promise.all([count, revision, scan, done]);
    return {
      completed: {
        type: "FeatureCollection" as const,
        features: records.map((r) => r.road),
      },
      count: total,
      revision: rev || 0,
    };
  }
  async set(
    input: Road,
    completed: boolean,
    expected?: string,
  ): Promise<Mutation> {
    const road = validateRoad(input),
      id = road.properties.id,
      db = await this.open(),
      tx = transaction(db, "readwrite"),
      done = complete(tx);
    // Rejection is observed immediately, including intentional conflict aborts.
    void done.catch(() => {});
    try {
      const roads = tx.objectStore("completed"),
        revisions = tx.objectStore("revisions");
      const [prior, previous, globalRevision] = await Promise.all([
        request<CompletedRoad | undefined>(roads.get(id)),
        request<{ id: string; revision: string } | undefined>(
          revisions.get(id),
        ),
        request<number | undefined>(tx.objectStore("meta").get("revision")),
      ]);
      if (expected !== undefined && expected !== previous?.revision)
        throw new Error(
          "This road changed in another tab. Refresh before using Undo.",
        );
      if (Boolean(prior) === completed) {
        await done;
        return {
          changed: false,
          completed,
          revision: previous?.revision || "",
        };
      }
      const revision = crypto.randomUUID(),
        now = new Date().toISOString();
      if (completed) {
        const bounds = roadBounds(road);
        roads.put({
          id,
          road,
          bounds,
          west: bounds[0],
          completedAt: now,
          updatedAt: now,
        } satisfies CompletedRoad);
      } else roads.delete(id);
      revisions.put({ id, revision });
      tx.objectStore("meta").put((globalRevision || 0) + 1, "revision");
      await done;
      this.changed();
      return { changed: true, completed, revision };
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async exportBackup() {
    const db = await this.open(),
      tx = transaction(db, "readonly"),
      done = complete(tx);
    const records = await request<CompletedRoad[]>(
      tx.objectStore("completed").getAll(),
    );
    await done;
    return makeBackup(records);
  }
  async importRecords(
    records: CompletedRoad[],
    duplicates = 0,
  ): Promise<ImportResult> {
    const db = await this.open(),
      tx = transaction(db, "readwrite"),
      done = complete(tx);
    void done.catch(() => {});
    try {
      const roads = tx.objectStore("completed"),
        revisionStore = tx.objectStore("revisions");
      const globalRevision = await request<number | undefined>(
        tx.objectStore("meta").get("revision"),
      );
      let added = 0,
        skipped = duplicates;
      // All reads are enqueued in the same task; no network awaits inside an IDB transaction.
      await Promise.all(
        records.map(
          (record) =>
            new Promise<void>((resolve, reject) => {
              const req = roads.get(record.id);
              req.onerror = () => reject(req.error);
              req.onsuccess = () => {
                const prior = req.result as CompletedRoad | undefined;
                if (prior) {
                  if (
                    JSON.stringify(prior.road.geometry) !==
                    JSON.stringify(record.road.geometry)
                  ) {
                    reject(
                      new Error(
                        `Conflicting saved geometry for road ${record.id}. No roads were imported.`,
                      ),
                    );
                    return;
                  }
                  skipped++;
                } else {
                  roads.add(record);
                  revisionStore.put({
                    id: record.id,
                    revision: crypto.randomUUID(),
                  });
                  added++;
                }
                resolve();
              };
            }),
        ),
      );
      if (added)
        tx.objectStore("meta").put((globalRevision || 0) + 1, "revision");
      const total = await request(roads.count());
      await done;
      if (added) this.changed();
      return { added, skipped, total };
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async close() {
    if (this.opening) (await this.opening).close();
    this.opening = undefined;
    this.channel?.close();
    this.channel = undefined;
  }
}
export const database = new RoadDatabase();
