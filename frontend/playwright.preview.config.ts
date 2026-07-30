import { createBrowserConfig } from "./playwright.shared";

export default createBrowserConfig(
  "http://127.0.0.1:4173",
  "npm run preview",
);
