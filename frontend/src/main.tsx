import { createRoot } from "react-dom/client";

import { App } from "./presentation/App";
import { DesktopImportPanel } from "./presentation/DesktopImportPanel";
import { BetaWordCloudBrowserHarness } from "./presentation/beta/BetaWordCloudBrowserHarness";
import { isTauriRuntime } from "./desktop/runtime";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("ROOT_ELEMENT_MISSING");
}

const browserFixture = new URLSearchParams(window.location.search).get("fixture");
createRoot(rootElement).render(
  browserFixture === "beta-word-cloud"
    ? <BetaWordCloudBrowserHarness />
    : isTauriRuntime()
      ? <DesktopImportPanel />
      : <App />,
);
