import path from "node:path";
import react from "@vitejs/plugin-react";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite";

function getVendorChunkName(id: string): string | undefined {
  if (!id.includes("node_modules")) {
    return undefined;
  }

  const normalized = id.split("node_modules/").pop();
  if (!normalized) {
    return "vendor-misc";
  }

  const parts = normalized.split("/");
  const packageName = parts[0]?.startsWith("@") ? `${parts[0]}-${parts[1] ?? "pkg"}` : parts[0];
  return `vendor-${packageName.replace(/[^a-zA-Z0-9-_]/g, "-")}`;
}

export default defineConfig({
  plugins: [UnoCSS(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          return getVendorChunkName(id);
        },
      },
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4000,
    proxy: {
      "/api": {
        target: process.env.API_URL || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
