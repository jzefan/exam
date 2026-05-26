import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setupSessionExpiryHandling } from "./lib/session-expiry.ts";

async function bootstrap() {
  setupSessionExpiryHandling();
  const { default: App } = await import("./App.tsx");

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();

// Register service worker after page load (build-only; disabled in dev by vite-plugin-pwa).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const isExamPath = /^\/student\/exam\//.test(window.location.pathname);
    if (!isExamPath) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // SW registration failure is non-fatal; app still works.
      });
    }
  });
}
