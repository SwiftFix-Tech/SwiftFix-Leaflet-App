import { test, expect } from "@playwright/test";
test("private entry point is accessible on desktop and phone", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("UK LEAFLET TRACKER", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(
    /Welcome back|Connect your workspace/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByLabel("UK leaflet distribution map")).toHaveCount(0);
});
