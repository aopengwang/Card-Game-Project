import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `npm run dev` serves the client on :5173 and forwards API/websocket traffic to the
// Python server on :8000. `npm run build` writes dist/, which the Python server serves.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"], // e2e/ belongs to Playwright
  },
});
