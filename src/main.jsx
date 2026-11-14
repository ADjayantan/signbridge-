import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import AppUpdateNotice from "./components/AppUpdateNotice.jsx";
import { wakeConversationServer } from "./lib/conversationServer.js";
import { applyThemeChoice } from "./lib/theme.js";
import "./styles.css";
import "./styles/design.css";
// The print design system loads last so its tokens and components win over the older layers.
import "./styles/halftone.css";

// Before the first paint, so a saved Paper / Ink choice never flashes the other theme.
applyThemeChoice();
// When the site and the room server are hosted apart, wake the (possibly sleeping) server early.
wakeConversationServer();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppUpdateNotice />
    <App />
  </StrictMode>,
);
