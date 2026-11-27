import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./index.css";
import { getAppBasePath } from "./lib/base-path.ts";
import {
  applyEmbedDatasetAttributes,
  resolveCurrentEmbedConfig,
} from "./lib/embed-config.ts";

const initialEmbedConfig = resolveCurrentEmbedConfig();
applyEmbedDatasetAttributes(initialEmbedConfig);

if (
  import.meta.env.PROD &&
  !initialEmbedConfig.embed &&
  getAppBasePath() === "" &&
  typeof window !== "undefined" &&
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator
) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => undefined);
  });
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
