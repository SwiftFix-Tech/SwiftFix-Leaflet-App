import { RequestCache } from "./cache";
import {
  emptyRoads,
  type Bounds,
  type Mutation,
  type Road,
  type View,
} from "./types";
export type Backend = {
  view(bounds: Bounds, zoom: number): Promise<View>;
  set(road: Road, completed: boolean, expected?: string): Promise<Mutation>;
};
type Undo = { road: Road; completed: boolean; revision: string };
export type TrackerState = View & {
  pending: number;
  loading: boolean;
  error: string;
  notice: string;
  undo: Undo | null;
};
export class TrackerStore {
  private state: TrackerState = {
    roads: emptyRoads(),
    completed: emptyRoads(),
    count: 0,
    revision: 0,
    pending: 0,
    loading: false,
    error: "",
    notice: "",
    undo: null,
  };
  private listeners = new Set<() => void>();
  private cache = new RequestCache<View>(8, 15_000);
  private epoch = 0;
  private request = 0;
  private writeError = "";
  private queue: Promise<void> = Promise.resolve();
  private pendingIDs = new Map<string, number>();
  private viewport?: { bounds: Bounds; zoom: number };
  constructor(private backend: Backend) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.state;
  private update(patch: Partial<TrackerState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  dismiss = () => {
    this.writeError = "";
    this.update({ error: "", notice: "" });
  };
  async load(bounds: Bounds, zoom: number, force = false) {
    this.viewport = { bounds, zoom };
    if (this.state.pending) return;
    if (force) {
      this.epoch++;
      this.cache.clear();
    }
    const ticket = ++this.request,
      epoch = this.epoch;
    this.update({ loading: true });
    try {
      const view = await this.cache.get(
        JSON.stringify([epoch, bounds, Math.floor(zoom)]),
        () => this.backend.view(bounds, zoom),
      );
      if (
        ticket === this.request &&
        epoch === this.epoch &&
        !this.state.pending
      )
        this.update({
          ...view,
          loading: false,
          error: this.writeError || view.warning || "",
        });
    } catch (error) {
      if (ticket === this.request && epoch === this.epoch)
        this.update({
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : "Could not load roads. Please retry.",
        });
    }
  }
  refresh = () => {
    if (this.viewport)
      return this.load(this.viewport.bounds, this.viewport.zoom, true);
  };
  private paint(road: Road, completed: boolean, previous?: boolean) {
    const features = this.state.completed.features.filter(
      (f) => f.properties.id !== road.properties.id,
    );
    const was =
      previous ?? features.length !== this.state.completed.features.length;
    if (completed)
      features.push({
        ...road,
        properties: { ...road.properties, completed: true },
      });
    this.update({
      completed: { type: "FeatureCollection", features },
      count: this.state.count + Number(completed) - Number(was),
    });
  }
  mark(road: Road, completed: boolean, expected?: string) {
    const id = road.properties.id;
    const was =
      expected !== undefined
        ? !completed
        : this.state.completed.features.some((f) => f.properties.id === id);
    if (was === completed) return;
    this.pendingIDs.set(id, (this.pendingIDs.get(id) || 0) + 1);
    this.epoch++;
    this.request++;
    this.cache.clear();
    this.writeError = "";
    this.paint(road, completed, was);
    this.update({
      pending: this.pendingIDs.size,
      loading: false,
      error: "",
      notice: "",
    });
    this.queue = this.queue
      .then(async () => {
        try {
          const result = await this.backend.set(road, completed, expected);
          this.update({
            notice: completed ? "Road section completed" : "Highlight removed",
            undo: result.changed
              ? { road, completed: !completed, revision: result.revision }
              : this.state.undo,
          });
        } catch (error) {
          if (this.pendingIDs.get(id) === 1) this.paint(road, was, completed);
          this.writeError =
            error instanceof Error
              ? error.message
              : "Save failed. Your change was restored.";
          this.update({ error: this.writeError, notice: "" });
        } finally {
          const remaining = (this.pendingIDs.get(id) || 1) - 1;
          if (remaining) this.pendingIDs.set(id, remaining);
          else this.pendingIDs.delete(id);
          this.update({ pending: this.pendingIDs.size });
        }
      })
      .then(() => {
        if (!this.state.pending) void this.refresh();
      });
    return this.queue;
  }
  undo = () => {
    if (this.state.pending || !this.state.undo) return;
    const action = this.state.undo;
    this.update({ undo: null });
    return this.mark(action.road, action.completed, action.revision);
  };
  settled = () => this.queue;
  clearUndo = () => this.update({ undo: null });
}
