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
