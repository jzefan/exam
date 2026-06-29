import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setupSessionExpiryHandling } from "./lib/session-expiry.ts";
import { registerServiceWorker } from "./lib/sw-update.ts";

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

// Register the service worker and auto-adopt new deploys (build-only; disabled
// in dev by vite-plugin-pwa). See lib/sw-update.ts for the update strategy.
registerServiceWorker();
