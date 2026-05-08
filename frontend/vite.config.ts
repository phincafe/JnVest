import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // Split heavy chart libs so they only load when their tab/panel is opened.
        manualChunks(id) {
          if (id.includes("node_modules/lightweight-charts")) return "vendor-lightweight-charts";
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-")) return "vendor-recharts";
          if (id.includes("node_modules/react-plaid-link") || id.includes("node_modules/plaid-link"))
            return "vendor-plaid";
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler"))
            return "vendor-react";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api/ws": {
        target: "ws://127.0.0.1:8000",
        ws: true,
        changeOrigin: true,
      },
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
