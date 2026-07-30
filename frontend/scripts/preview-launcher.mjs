#!/usr/bin/env node

import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

const STATE_FORMAT = "chat-analysis-preview-v2";
const EXPECTED_KEYS = [
  "--nonce",
  "--identity",
  "--root",
  "--config",
  "--host",
  "--port",
  "--strict-port",
];

function refuse() {
  process.stderr.write("PREVIEW_LAUNCH_REFUSED\n");
  process.exit(1);
}

function parseArguments(values) {
  if (values.length !== 13) {
    refuse();
  }
  const result = {};
  let cursor = 0;
  for (const key of EXPECTED_KEYS) {
    if (values[cursor] !== key) {
      refuse();
    }
    if (key === "--strict-port") {
      cursor += 1;
      result.strictPort = true;
      continue;
    }
    const value = values[cursor + 1];
    if (!value || /[\0\r\n]/u.test(value)) {
      refuse();
    }
    result[key.slice(2)] = value;
    cursor += 2;
  }
  if (
    !/^[a-f0-9]{64}$/u.test(result.nonce) ||
    result.host !== "127.0.0.1" ||
    result.port !== "4173"
  ) {
    refuse();
  }
  return result;
}

function requireOwnerOnlyRegular(descriptor) {
  const stats = fstatSync(descriptor);
  if (
    !stats.isFile() ||
    stats.uid !== process.getuid() ||
    (stats.mode & 0o777) !== 0o600
  ) {
    refuse();
  }
}

const options = parseArguments(process.argv.slice(2));
let identityDescriptor;
let launcherDescriptor;
let server;
let shuttingDown = false;

try {
  const launcherPath = realpathSync(fileURLToPath(import.meta.url));
  const root = realpathSync(options.root);
  const config = realpathSync(options.config);
  const identity = realpathSync(options.identity);
  if (
    launcherPath !== fileURLToPath(import.meta.url) ||
    config !== `${root}/vite.config.ts` ||
    identity !== options.identity
  ) {
    refuse();
  }
  identityDescriptor = openSync(
    identity,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  launcherDescriptor = openSync(
    launcherPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  requireOwnerOnlyRegular(identityDescriptor);
  if (
    readFileSync(identityDescriptor, "utf8") !==
    `${STATE_FORMAT}\n${options.nonce}\n`
  ) {
    refuse();
  }
  server = await preview({
    root,
    configFile: config,
    preview: {
      host: options.host,
      port: Number(options.port),
      strictPort: true,
    },
  });
} catch {
  process.stderr.write("PREVIEW_START_FAILED\n");
  process.exit(1);
}

async function shutdown() {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  try {
    await server.close();
    closeSync(identityDescriptor);
    closeSync(launcherDescriptor);
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
