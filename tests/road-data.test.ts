import { it, expect, vi } from "vitest";
import { StaticRoads, visibleCells } from "../lib/road-data";
import { road } from "./fixtures";
import { roadSource } from "../lib/road-source";
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
  await expect(data.load(bounds, 16)).rejects.toThrow("unavailable");
  await expect(data.load(bounds, 16)).rejects.toThrow("unavailable");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("loads manifest and cells from the same public CDN directory", async () => {
  const cells = visibleCells(bounds);
  const fetcher = vi.fn(
    async (url: RequestInfo | URL) =>
      new Response(
        JSON.stringify(
          String(url).endsWith("manifest.json")
            ? {
                format: "swiftfix-road-cells",
                version: 1,
                dataset: "uk_pinned",
                cellZoom: 12,
                cells,
              }
            : { type: "FeatureCollection", features: [road] },
        ),
      ),
  );
  const data = new StaticRoads(
    fetcher,
    roadSource("https://roads.example.org/uk/"),
  );
  expect((await data.load(bounds, 16)).features).toHaveLength(1);
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([
    "https://roads.example.org/uk/manifest.json",
    ...cells.map(
      (cell) => `https://roads.example.org/uk/uk_pinned/12/${cell}.json.gz`,
    ),
  ]);
  expect(roadSource()).toBe("/roads");
  for (const url of [
    "http://example.org",
    "https://user:secret@example.org",
    "https://example.org/?key=secret",
    "https://example.org/#x",
  ])
    expect(() => roadSource(url)).toThrow();
});
