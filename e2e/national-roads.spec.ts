import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { cellAt } from "../lib/road-data";
import type { Roads } from "../lib/types";
import { mark, menu, canvasCentre } from "./helpers";

async function bluePixels(page: Page) {
  const { screenX, screenY } = await canvasCentre(page);
  const png = await page.screenshot({
    clip: { x: screenX - 100, y: screenY - 100, width: 200, height: 200 },
  });
  return page.evaluate(async (base64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${base64}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(img, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let blue = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (
        pixels[i] < 100 &&
        pixels[i + 1] > 80 &&
        pixels[i + 1] < 190 &&
        pixels[i + 2] > 220
      )
        blue++;
    return blue;
  }, png.toString("base64"));
}

// Opt-in acceptance of the actual generated release; no road requests are intercepted.
test.describe("generated national road release", () => {
  test.skip(
    process.env.NATIONAL_ROADS_CHECK !== "1",
    "Requires complete generated public/roads assets",
  );
  for (const [city, lon, lat] of [
    ["East Finchley", -0.164, 51.587],
    ["Manchester", -2.24, 53.48],
    ["Glasgow", -4.25, 55.86],
    ["Cardiff", -3.18, 51.48],
    ["Belfast", -5.93, 54.6],
  ] as const) {
    test(`${city}: actual generated geometry can be selected, restored and removed`, async ({
      page,
      context,
    }, info) => {
      const manifest = JSON.parse(
        await readFile("public/roads/manifest.json", "utf8"),
      );
      const [x, y] = cellAt(lon, lat);
      const cell = JSON.parse(
        gunzipSync(
          await readFile(
            `public/roads/${manifest.dataset}/12/${x}/${y}.json.gz`,
          ),
        ).toString("utf8"),
      ) as Roads;
      const road = cell.features
        .filter((f) => f.properties.name && f.geometry.coordinates.length > 2)
        .sort(
          (a, b) =>
            Math.hypot(
              a.geometry.coordinates[0][0] - lon,
              a.geometry.coordinates[0][1] - lat,
            ) -
            Math.hypot(
              b.geometry.coordinates[0][0] - lon,
              b.geometry.coordinates[0][1] - lat,
            ),
        )[0];
      expect(road).toBeTruthy();
      const coords = road.geometry.coordinates;
      const i = Math.max(1, Math.floor(coords.length / 2));
      const center = [
        (coords[i - 1][0] + coords[i][0]) / 2,
        (coords[i - 1][1] + coords[i][1]) / 2,
      ];
      await context.route("https://api.maptiler.com/**", (route) =>
        route.fulfill({
          json: route.request().url().includes("/geocoding/")
            ? { features: [{ id: city, place_name: city, center }] }
            : {
                version: 8,
                sources: {},
                layers: [
                  {
                    id: "background",
                    type: "background",
                    paint: { "background-color": "#eeeeee" },
                  },
                ],
              },
        }),
      );
      await page.goto("/");
      await page.getByLabel("Search UK locations").fill(city);
      await page.getByRole("option").filter({ hasText: city }).click();
      await expect(async () => {
        await menu(page);
        await expect(page.getByRole("dialog")).toContainText(
          road.properties.name,
        );
      }).toPass({ timeout: 15000 });
      await page.keyboard.press("Escape");
      await mark(page);
      await expect(async () =>
        expect(await bluePixels(page)).toBeGreaterThan(4),
      ).toPass({ timeout: 10000 });
      await page.screenshot({
        path: info.outputPath("completed-real-road.png"),
      });
      const downloadPromise = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Export Backup", exact: true })
        .click();
      const path = await (await downloadPromise).path();
      const backup = JSON.parse(await readFile(path!, "utf8"));
      expect(backup.roads[0].id).toBe(road.properties.id);
      expect(backup.roads[0].road.geometry).toEqual(road.geometry);
      await page.reload();
      await expect(page.getByTestId("completed-count")).toHaveText("1");
      await page.getByLabel("Search UK locations").fill(city);
      await page.getByRole("option").filter({ hasText: city }).click();
      await expect(async () => {
        await menu(page);
        await expect(
          page.getByRole("button", { name: "Remove Highlight" }),
        ).toBeVisible();
      }).toPass({ timeout: 15000 });
      await page.getByRole("button", { name: "Remove Highlight" }).click();
      await expect(page.getByTestId("completed-count")).toHaveText("0");
      // Counter changes optimistically; refresh only after the IndexedDB commit.
      await expect(
        page.getByRole("status").filter({ hasText: "Highlight removed" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Undo", exact: true }),
      ).toBeEnabled();
      await expect(async () => expect(await bluePixels(page)).toBe(0)).toPass({
        timeout: 10000,
      });
      await page.reload();
      await expect(page.getByTestId("completed-count")).toHaveText("0");
    });
  }
});
