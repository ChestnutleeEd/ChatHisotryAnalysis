import { createRoot } from "react-dom/client";

import { App } from "./presentation/App";
import "./styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("ROOT_ELEMENT_MISSING");
}

createRoot(rootElement).render(<App />);
