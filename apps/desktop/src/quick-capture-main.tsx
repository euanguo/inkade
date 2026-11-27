import { createRoot } from "react-dom/client";
import { QuickCaptureMiniApp } from "./QuickCaptureMiniApp.tsx";

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<QuickCaptureMiniApp />);
}
