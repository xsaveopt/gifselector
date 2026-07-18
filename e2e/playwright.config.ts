import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.E2E_PORT ?? "3200";
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node serve.mjs",
    url: `${baseURL}/gifselector/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
