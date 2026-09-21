import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/test/e2e",
  testMatch: "chaoxing.spec.ts",
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4108",
    trace: "off", // Login flows must never record credentials.
    launchOptions: process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "pnpm exec vite --host 127.0.0.1 --port 4108 --strictPort",
    url: "http://127.0.0.1:4108",
    reuseExistingServer: !process.env.CI,
  },
});
