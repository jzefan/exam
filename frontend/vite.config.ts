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

// Absolute asset origin (CDN) means every /assets/ URL is cross-origin: the
// service worker cannot precache it, and the runtime cache deliberately skips
// cross-origin requests. Keep precaching to the same-origin shell only.
const assetBase = process.env.VITE_ASSET_BASE || "/";
const assetsAreExternal = /^https?:\/\//.test(assetBase);

export default defineConfig({
  // Asset origin. Defaults to the app origin so `vite dev`, `vite preview` and
  // the Playwright suite keep working; production builds pass
  // VITE_ASSET_BASE=https://static.llmpingce.com/ so hashed chunks are fetched
  // from the CDN instead of the 3Mbps edge box.
  base: assetBase,
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
        // App shell only. Including js/woff2/svg here made every release a
        // ~6MB eager precache download per client (2MB gzipped) racing the
        // student's login on a 3Mbps edge link. Build chunks, fonts and icon
        // sprites are runtime-cached by src/sw.ts once a page actually uses
        // them, which also keeps offline working for pages already visited.
        globPatterns: assetsAreExternal
          ? ["**/*.{html,webmanifest}"]
          : ["**/*.{html,css,webmanifest}"],
        globIgnores: ["**/api/**"],
        maximumFileSizeToCacheInBytes: 3_000_000,
      },
      devOptions: { enabled: false },
      manifest: {
        id: "/",
        name: "智评线考试",
        short_name: "智评线",
        lang: "zh-CN",
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
  optimizeDeps: {
    // 这些依赖只在页面交互时动态 import（试卷/题目导入等）。不预打包会在运行时
    // 触发二次依赖优化：旧 hash 的 chunk 被清理后，动态 import 会报
    // "Failed to fetch dynamically imported module"。
    include: ["jszip", "mammoth", "pdfjs-dist", "xlsx"],
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
