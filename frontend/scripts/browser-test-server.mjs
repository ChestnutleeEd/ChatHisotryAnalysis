import { createServer, preview } from "vite";

const [mode, rawPort] = process.argv.slice(2);
const port = Number(rawPort);
if (
  (mode !== "development" && mode !== "production") ||
  !Number.isSafeInteger(port) ||
  port < 1024 ||
  port > 65_535 ||
  port === 4_173
) {
  process.exitCode = 64;
} else {
  const root = new URL("..", import.meta.url).pathname;
  const options = {
    root,
    configFile: `${root}/vite.config.ts`,
    logLevel: "error",
  };
  const server =
    mode === "development"
      ? await createServer({
          ...options,
          server: {
            host: "127.0.0.1",
            port,
            strictPort: true,
          },
        })
      : await preview({
          ...options,
          preview: {
            host: "127.0.0.1",
            port,
            strictPort: true,
          },
        });
  if (mode === "development") {
    await server.listen();
  }
  const close = () => {
    void server.close().finally(() => {
      process.exit(0);
    });
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
