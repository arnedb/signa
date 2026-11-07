import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8765);

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "off", locale: "nl-BE" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  // A fresh database with demo data, served by FastAPI together with the built web app.
  webServer: {
    command: `bash e2e/serve.sh ${port}`,
    url: `http://127.0.0.1:${port}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
