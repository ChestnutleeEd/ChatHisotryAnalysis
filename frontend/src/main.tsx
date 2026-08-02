import { createRoot } from "react-dom/client";

import { App } from "./presentation/App";
import { DesktopImportPanel } from "./presentation/DesktopImportPanel";
import { isTauriRuntime } from "./desktop/runtime";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("ROOT_ELEMENT_MISSING");
}

createRoot(rootElement).render(isTauriRuntime() ? <DesktopImportPanel /> : <App />);
