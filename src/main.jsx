import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import AppUpdateNotice from "./components/AppUpdateNotice.jsx";
import "./styles.css";
import "./styles/design.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AppUpdateNotice />
    <App />
  </StrictMode>,
);
