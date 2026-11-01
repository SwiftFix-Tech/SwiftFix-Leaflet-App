import { test, expect, chromium } from "@playwright/test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fixtures, mark, menu, canvasCentre } from "./helpers";
test.beforeEach(async ({ context }) => fixtures(context));
test("opens the UK map without sign-in and explains browser-local storage", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("UK LEAFLET TRACKER", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toContainText("Clearing browser data");
  await expect(page.getByRole("note")).toContainText("do not sync");
  await expect(
    page.getByRole("button", { name: "Export Backup", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByLabel("UK leaflet distribution map")).toBeVisible();
});
test("click, duplicate click, refresh, removal and Undo persist in real IndexedDB", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await mark(page);
  await mark(page);
  await page.reload();
  await expect(page.getByTestId("completed-count")).toHaveText("1");
  await menu(page);
  await expect(page.getByRole("dialog")).toContainText("Test Road");
  await page.getByRole("button", { name: "Remove Highlight" }).click();
  await expect(page.getByTestId("completed-count")).toHaveText("0");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByTestId("completed-count")).toHaveText("1");
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto("/");
  await expect(reopened.getByTestId("completed-count")).toHaveText("1");
  await menu(reopened);
  await expect(
    reopened.getByRole("button", { name: "Remove Highlight" }),
  ).toBeVisible();
});
test("downloads a complete backup, merges duplicates, restores deletions and rejects invalid JSON", async ({
  page,
}) => {
  await page.goto("/");
  await mark(page);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export Backup", exact: true })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw Error("Backup not downloaded");
  const backup = JSON.parse(await readFile(path, "utf8"));
  expect(backup.roads).toHaveLength(1);
  expect(backup.roads[0].road.geometry.coordinates).toHaveLength(3);
  await page.getByLabel("Import backup file").setInputFiles(path);
  await expect(
    page.getByRole("status").filter({ hasText: "Skipped 1 duplicates" }),
  ).toBeVisible();
  await expect(page.getByTestId("completed-count")).toHaveText("1");
  await menu(page);
  await page.getByRole("button", { name: "Remove Highlight" }).click();
  await expect(
    page.getByRole("button", { name: "Undo", exact: true }),
  ).toBeEnabled();
  await expect(page.getByTestId("completed-count")).toHaveText("0");
  await page.getByLabel("Import backup file").setInputFiles(path);
  await expect(page.getByTestId("completed-count")).toHaveText("1");
  await page.reload();
  await expect(page.getByTestId("completed-count")).toHaveText("1");
  await page.getByLabel("Import backup file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("{invalid"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "not valid JSON" }),
  ).toBeVisible();
  await expect(page.getByTestId("completed-count")).toHaveText("1");
});
test("keeps coverage when visiting Belfast and zooming back to East Finchley", async ({
  page,
}) => {
  await page.goto("/");
  await mark(page);
  await page.getByLabel("Search UK locations").fill("Belfast");
  await page.getByRole("option").filter({ hasText: "Belfast" }).click();
  await expect(page.getByLabel("UK leaflet distribution map")).toContainText(
    "Belfast",
  );
  // Wait for the camera flight before selecting the new geographical centre.
  await expect(async () => {
    await menu(page);
    await expect(page.getByRole("dialog")).toContainText("Belfast Test Road");
  }).toPass({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await mark(page, 2);
  await page
    .getByRole("button", { name: "Re-centre on East Finchley" })
    .click();
  await expect(async () => {
    await menu(page);
    await expect(page.getByRole("dialog")).toContainText("Test Road");
    await expect(
      page.getByRole("button", { name: "Remove Highlight" }),
    ).toBeVisible();
  }).toPass({ timeout: 10000 });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await menu(page);
  await expect(
    page.getByRole("button", { name: "Remove Highlight" }),
  ).toBeVisible();
  await expect(page.getByTestId("completed-count")).toHaveText("2");
});
test("independent browser profiles do not synchronise progress", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await mark(page);
  const other = await browser.newContext();
  try {
    await fixtures(other);
    const otherPage = await other.newPage();
    await otherPage.goto("/");
    await expect(otherPage.getByTestId("completed-count")).toHaveText("0");
  } finally {
    await other.close();
  }
});
test("phone tap and native touch hold open the removal menu", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "mobile", "Phone touch interaction");
  await page.goto("/");
  await expect(async () => {
    const { canvas, x, y } = await canvasCentre(page);
    await canvas.tap({ position: { x, y } });
    await expect(page.getByTestId("completed-count")).toHaveText("1", {
      timeout: 500,
    });
  }).toPass({ timeout: 15000, intervals: [250, 500, 1000] });
  await expect(page.getByText("Saved locally", { exact: false })).toBeVisible();
  const { screenX, screenY } = await canvasCentre(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: screenX, y: screenY }],
  });
  await page.waitForTimeout(650);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(
    page.getByRole("button", { name: "Remove Highlight" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove Highlight" }).tap();
  await expect(page.getByTestId("completed-count")).toHaveText("0");
});
test("saved roads survive a complete browser restart using the same profile", async ({}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "One persistent desktop profile check",
  );
  // Chromium's persistent backing store cannot use protected workspace folders on some Windows hosts.
  const profileParent = resolve(tmpdir());
  const profile = await mkdtemp(join(profileParent, "swiftfix-persistence-")),
    options = {
      headless: true,
      viewport: { width: 1280, height: 900 },
      channel: process.env.PLAYWRIGHT_CHANNEL,
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    };
  const now = new Date().toISOString(),
    backup = {
      format: "swiftfix-leaflet-backup",
      version: 1,
      exportedAt: now,
      roads: [
        {
          id: "test:restart:1",
          road: {
            type: "Feature",
            properties: { id: "test:restart:1", name: "Restart test road" },
            geometry: {
              type: "LineString",
              coordinates: [
                [-0.164, 51.587],
                [-0.163, 51.5873],
              ],
            },
          },
          completedAt: now,
          updatedAt: now,
        },
      ],
    };
  let context = await chromium.launchPersistentContext(profile, options);
  try {
    await fixtures(context);
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(String(info.project.use.baseURL));
    await canvasCentre(page); // wait for client hydration before dispatching a file-input change
    await page.getByLabel("Import backup file").setInputFiles({
      name: "restart.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await expect(page.getByTestId("completed-count")).toHaveText("1");
    await expect(
      page.getByRole("status").filter({ hasText: "Imported 1 road sections" }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
  context = await chromium.launchPersistentContext(profile, options);
  try {
    await fixtures(context);
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(String(info.project.use.baseURL));
    await canvasCentre(page);
    await expect(page.getByTestId("completed-count")).toHaveText("1");
    const saved = await page.evaluate(
      async () =>
        await new Promise<unknown>((resolve, reject) => {
          const request = indexedDB.open("swiftfix-leaflet-tracker", 1);
          request.onsuccess = () => {
            const db = request.result,
              read = db
                .transaction("completed")
                .objectStore("completed")
                .get("test:restart:1");
            read.onsuccess = () => {
              resolve(read.result);
              db.close();
            };
            read.onerror = () => reject(read.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    expect(
      (saved as { road: { geometry: { coordinates: number[][] } } }).road
        .geometry.coordinates,
    ).toEqual(backup.roads[0].road.geometry.coordinates);
  } finally {
    await context.close();
    if (
      dirname(resolve(profile)) !== profileParent ||
      !basename(profile).startsWith("swiftfix-persistence-")
    )
      throw new Error("Unsafe profile cleanup path");
    await rm(profile, { recursive: true, force: true, maxRetries: 5 });
  }
});
