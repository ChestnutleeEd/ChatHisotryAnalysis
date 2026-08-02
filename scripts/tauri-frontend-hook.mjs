import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const command = process.argv[2];
if (command !== "dev" && command !== "build" && command !== "--check") {
  process.stderr.write("TAURI_FRONTEND_HOOK_INVALID_COMMAND\n");
  process.exit(2);
}

function findRepositoryRoot(start) {
  let directory = path.resolve(start);
  while (true) {
    const packagePath = path.join(directory, "frontend", "package.json");
    const scriptPath = path.join(directory, "scripts", "tauri-frontend-hook.mjs");
    if (fs.existsSync(packagePath) && fs.existsSync(scriptPath)) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

const repositoryRoot = findRepositoryRoot(process.cwd());
if (repositoryRoot === undefined) {
  process.stderr.write("TAURI_FRONTEND_ROOT_NOT_FOUND\n");
  process.exit(3);
}

if (command === "--check") {
  process.exit(0);
}

const frontendDirectory = path.join(repositoryRoot, "frontend");
const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmExecutable, ["run", command], {
  cwd: frontendDirectory,
  env: process.env,
  stdio: "inherit",
});

child.on("error", () => process.exit(4));
child.on("exit", (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
