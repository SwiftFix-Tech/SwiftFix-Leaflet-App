import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL,
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command:
          "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1",
        env: {
          NEXT_PUBLIC_MAPTILER_KEY: "test-maptiler-key",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        url: "http://127.0.0.1:3000",
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
