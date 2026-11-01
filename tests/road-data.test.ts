import { it, expect, vi } from "vitest";
import { StaticRoads, visibleCells } from "../lib/road-data";
import { road } from "./fixtures";
const bounds: [number, number, number, number] = [-0.17, 51.58, -0.15, 51.6];
it("street geometry is dynamically loaded, deduplicated across cells, cached and request-coalesced", async () => {
  const cells = visibleCells(bounds),
    fetcher = vi.fn(async (url: RequestInfo | URL) =>
      String(url).endsWith("manifest.json")
        ? new Response(
            JSON.stringify({
              format: "swiftfix-road-cells",
              version: 1,
              dataset: "test",
              cellZoom: 12,
              cells,
            }),
          )
        : new Response(
            JSON.stringify({ type: "FeatureCollection", features: [road] }),
          ),
    );
  const data = new StaticRoads(fetcher);
  expect((await data.load(bounds, 10)).features).toHaveLength(0);
  expect(fetcher).not.toHaveBeenCalled();
  const [a, b] = await Promise.all([
    data.load(bounds, 16),
    data.load(bounds, 16),
  ]);
  expect(a.features).toHaveLength(1);
  expect(b.features).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(1 + cells.length);
  await data.load(bounds, 17);
  expect(fetcher).toHaveBeenCalledTimes(1 + cells.length);
});
it("missing road assets fail clearly and are retryable", async () => {
  const fetcher = vi.fn(async () => new Response("", { status: 404 })),
    data = new StaticRoads(fetcher);
  await expect(data.load(bounds, 16)).rejects.toThrow("not installed");
  await expect(data.load(bounds, 16)).rejects.toThrow("not installed");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
