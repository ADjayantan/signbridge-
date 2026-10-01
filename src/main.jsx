import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./styles.css";

// Installable app: the service worker caches the app (and, after first use, the hand-tracking
// model) so SignBridge opens instantly and sign recognition works offline.
registerSW({ immediate: true });

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
