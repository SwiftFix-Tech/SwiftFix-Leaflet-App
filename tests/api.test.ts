import { it, expect, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({
  supabase: mock,
  workspace: "shared-workspace",
}));
import { api } from "../lib/api";
import { road } from "./fixtures";
const bounds: [number, number, number, number] = [-0.17, 51.58, -0.15, 51.6];
beforeEach(() => mock.rpc.mockReset());
it("set calls the shared Supabase RPC with stable ID, desired state and undo revision", async () => {
  mock.rpc.mockResolvedValue({
    data: { changed: true, completed: true, revision: "v" },
    error: null,
  });
  await api.set(road, true, "previous");
  expect(mock.rpc).toHaveBeenCalledWith("set_completed", {
    p_workspace: "shared-workspace",
    p_segment: road.properties.id,
    p_completed: true,
    p_expected: "previous",
  });
});
it("Supabase errors propagate to the rollback controller", async () => {
  mock.rpc.mockResolvedValue({ data: null, error: { message: "RLS denied" } });
  await expect(api.set(road, true)).rejects.toThrow("RLS denied");
});
it("reads all geometry pages using keysets without duplicating tile fragments", async () => {
  const features = Array.from({ length: 750 }, (_, i) => ({
    ...road,
    properties: { id: `test:${i}`, name: "Test road" },
  }));
  mock.rpc
    .mockResolvedValueOnce({
      data: {
        roads: { type: "FeatureCollection", features },
        completed: { type: "FeatureCollection", features: [] },
        count: 5000,
        revision: 1,
        dataset: "v1",
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { features: [road], revision: 1, dataset: "v1" },
      error: null,
    });
  const result = await api.view(bounds, 16);
  expect(result.roads.features).toHaveLength(751);
  expect(result.count).toBe(5000);
  expect(mock.rpc.mock.calls[1][1].p_after).toBe("test:749");
});
it("retries a cross-page revision change to obtain a consistent view", async () => {
  const features = Array.from({ length: 750 }, (_, i) => ({
    ...road,
    properties: { id: String(i), name: "" },
  }));
  mock.rpc
    .mockResolvedValueOnce({
      data: {
        roads: { type: "FeatureCollection", features },
        completed: { type: "FeatureCollection", features: [] },
        count: 0,
        revision: 1,
        dataset: "v1",
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { features: [], revision: 2, dataset: "v1" },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        roads: { type: "FeatureCollection", features: [] },
        completed: { type: "FeatureCollection", features: [road] },
        count: 1,
        revision: 2,
        dataset: "v1",
      },
      error: null,
    });
  expect((await api.view(bounds, 16)).count).toBe(1);
  expect(mock.rpc).toHaveBeenCalledTimes(3);
});
