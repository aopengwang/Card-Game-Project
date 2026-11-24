import { defineConfig } from "@playwright/test";

// Browser tests against the real Python server serving the built client (npm run e2e
// builds first). Uses your installed Chrome, so no browser download is needed.
const PORT = 8766;
const python =
  process.env.SGS_PYTHON ?? (process.platform === "win32" ? ".venv\\Scripts\\python.exe" : ".venv/bin/python");

export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  fullyParallel: true,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: "chrome",
  },
  webServer: {
    command: `"${python}" -m uvicorn net.app:app --port ${PORT}`,
    cwd: "../server",
    url: `http://127.0.0.1:${PORT}/api/content`,
    env: { SGS_BOT_DELAY: "0.1" },
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
