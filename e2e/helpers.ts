import { expect, type BrowserContext, type Page } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { road } from "../tests/fixtures";
import { visibleCells } from "../lib/road-data";
export const belfast = {
  ...road,
  geometry: {
    type: "LineString" as const,
    coordinates: [
      [-5.93, 54.6],
      [-5.929, 54.6003],
      [-5.928, 54.6001],
    ],
  },
  properties: { id: "test:belfast:1", name: "Belfast Test Road" },
};
export async function fixtures(context: BrowserContext) {
  await context.route("https://api.maptiler.com/**", async (route) => {
    if (route.request().url().includes("/geocoding/")) {
      await route.fulfill({
        json: {
          features: [
            {
              id: "test:belfast",
              place_name: "Belfast, Northern Ireland, United Kingdom",
              center: [-5.93, 54.6],
            },
          ],
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        version: 8,
        sources: {
          normal: {
            type: "geojson",
            data: { type: "FeatureCollection", features: [road, belfast] },
          },
        },
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#e9efe8" },
          },
          {
            id: "normal-roads",
            type: "line",
            source: "normal",
            paint: { "line-color": "#ffffff", "line-width": 12 },
          },
        ],
      },
    });
  });
  const cells = [
    ...new Set([
      ...visibleCells([-0.2, 51.55, -0.1, 51.62]),
      ...visibleCells([-6, 54.55, -5.85, 54.65]),
    ]),
  ];
  await context.route("**/roads/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/manifest.json"))
      await route.fulfill({
        json: {
          format: "swiftfix-road-cells",
          version: 1,
          dataset: "test",
          cellZoom: 12,
          cells,
        },
      });
    else
      await route.fulfill({
        body: gzipSync(
          JSON.stringify({
            type: "FeatureCollection",
            features: [road, belfast],
          }),
        ),
        contentType: "application/gzip",
      });
  });
}
export async function canvasCentre(page: Page) {
  const canvas = page.getByRole("region", { name: "Map", exact: true });
  await expect(canvas).toBeVisible({ timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw Error("Map canvas missing");
  return {
    canvas,
    x: box.width / 2,
    y: box.height / 2,
    screenX: box.x + box.width / 2,
    screenY: box.y + box.height / 2,
  };
}
export async function mark(page: Page, total = 1) {
  await expect(async () => {
    const { canvas, x, y } = await canvasCentre(page);
    await canvas.click({ position: { x, y } });
    await expect(page.getByTestId("completed-count")).toHaveText(
      String(total),
      { timeout: 500 },
    );
  }).toPass({ timeout: 15000, intervals: [250, 500, 1000] });
  await expect(page.getByText("Saved locally", { exact: false })).toBeVisible();
}
export async function menu(page: Page) {
  await expect(async () => {
    const { canvas, x, y } = await canvasCentre(page);
    await canvas.click({ button: "right", position: { x, y } });
    await expect(
      page.getByRole("dialog", { name: "Road section actions" }),
    ).toBeVisible({ timeout: 500 });
  }).toPass({ timeout: 10000, intervals: [250, 500] });
}
