import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../public/dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:4100",
      "/auth": "http://localhost:4100",
      "/health": "http://localhost:4100",
      "/stream": "http://localhost:4100",
      "/libraries": "http://localhost:4100",
      "/series": "http://localhost:4100",
      "/media": "http://localhost:4100",
      "/search": "http://localhost:4100",
      "/users": "http://localhost:4100",
      "/sessions": "http://localhost:4100",
      "/play": "http://localhost:4100",
      "/preparation": "http://localhost:4100",
      "/predictions": "http://localhost:4100",
      "/home-nodes": "http://localhost:4100",
      "/download": "http://localhost:4100",
      "/library": "http://localhost:4100",
      "/devices": "http://localhost:4100",
    },
  },
});
