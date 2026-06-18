import React from "react";
import { createRoot } from "react-dom/client";
// Polaroid / Soft Sky type system — Agbalumo (wordmark), DM Serif Display
// (headlines, incl. italic), Space Mono (// captions, data), Hanken Grotesk (UI/body).
import "@fontsource/agbalumo";
import "@fontsource/dm-serif-display/400.css";
import "@fontsource/dm-serif-display/400-italic.css";
import "@fontsource/space-mono/400.css";
import "@fontsource/space-mono/700.css";
import "@fontsource-variable/hanken-grotesk";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
