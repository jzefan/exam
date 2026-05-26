import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        globIgnores: ["**/api/**"],
        maximumFileSizeToCacheInBytes: 3_000_000,
      },
      devOptions: { enabled: false },
      manifest: {
        name: "智评线考试",
        short_name: "智评线",
        start_url: "/",
        display: "standalone",
        scope: "/",
        theme_color: "#6366f1",
        background_color: "#ffffff",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
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
        ws: true,
      },
    },
  },
});
