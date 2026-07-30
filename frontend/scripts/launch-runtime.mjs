#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";

const STATE_FORMAT = "chat-analysis-preview-v2";
const RUNTIME_NAME = ".chat-analysis-runtime";
const STATE_NAME = "preview.state";
const PID_NAME = "preview.pid";
const HOST = "127.0.0.1";
const PORT = 4173;
const REQUIRED_STATE_KEYS = [
  "format",
  "pid",
  "nonce",
  "project_root",
  "frontend_root",
  "node_executable",
  "launcher",
  "launcher_device",
  "launcher_inode",
  "config",
  "identity",
  "identity_device",
  "identity_inode",
  "log",
  "host",
  "port",
  "strict_port",
  "start_fingerprint",
  "argv",
];
const STRING_STATE_KEYS = new Set(
  REQUIRED_STATE_KEYS.filter((key) => key !== "pid" && key !== "port"),
);

class RuntimeError extends Error {
  constructor(code, exitCode = 1) {
    super(code);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function fail(code, exitCode = 1) {
  throw new RuntimeError(code, exitCode);
}

function assertSafeText(value, code) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    /[\0\r\n]/u.test(value)
  ) {
    fail(code);
  }
  return value;
}

function canonicalExistingPath(value, code) {
  const safe = assertSafeText(value, code);
  try {
    return realpathSync(safe);
  } catch {
    fail(code);
  }
}

function isContained(parent, child) {
  const rel = relative(parent, child);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`));
}

function modeOf(stats) {
  return stats.mode & 0o777;
}

function requireOwnedDirectory(path, expectedMode = 0o700) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    fail("RUNTIME_DIRECTORY_UNAVAILABLE");
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isDirectory() ||
    stats.uid !== process.getuid() ||
    modeOf(stats) !== expectedMode
  ) {
    fail("RUNTIME_DIRECTORY_UNSAFE");
  }
}

function requireOwnedRegular(path, expectedMode = 0o600) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    fail("RUNTIME_FILE_UNAVAILABLE");
  }
  if (
    stats.isSymbolicLink() ||
    !stats.isFile() ||
    stats.uid !== process.getuid() ||
    modeOf(stats) !== expectedMode
  ) {
    fail("RUNTIME_FILE_UNSAFE");
  }
  return stats;
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return undefined;
    }
    fail("RUNTIME_PATH_UNREADABLE");
  }
}

function runtimeContext(projectArgument, create) {
  const projectRoot = canonicalExistingPath(projectArgument, "PROJECT_ROOT_INVALID");
  if (resolve(projectArgument) !== projectRoot) {
    fail("PROJECT_ROOT_NOT_CANONICAL");
  }
  const runtimePath = join(projectRoot, RUNTIME_NAME);
  if (!isContained(projectRoot, runtimePath) || dirname(runtimePath) !== projectRoot) {
    fail("RUNTIME_CONTAINMENT_FAILED");
  }
  const existing = lstatIfPresent(runtimePath);
  if (existing === undefined) {
    if (!create) {
      return {
        projectRoot,
        runtimePath,
        statePath: join(runtimePath, STATE_NAME),
        pidPath: join(runtimePath, PID_NAME),
        exists: false,
      };
    }
    try {
      mkdirSync(runtimePath, { mode: 0o700 });
    } catch {
      fail("RUNTIME_DIRECTORY_CREATE_FAILED");
    }
  }
  requireOwnedDirectory(runtimePath);
  const canonicalRuntime = canonicalExistingPath(
    runtimePath,
    "RUNTIME_DIRECTORY_UNAVAILABLE",
  );
  if (
    canonicalRuntime !== runtimePath ||
    !isContained(projectRoot, canonicalRuntime)
  ) {
    fail("RUNTIME_CONTAINMENT_FAILED");
  }
  return {
    projectRoot,
    runtimePath: canonicalRuntime,
    statePath: join(canonicalRuntime, STATE_NAME),
    pidPath: join(canonicalRuntime, PID_NAME),
    exists: true,
  };
}

function encode(value) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value, code) {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    fail(code);
  }
  let decoded;
  try {
    decoded = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    fail(code);
  }
  if (encode(decoded) !== value) {
    fail(code);
  }
  return assertSafeText(decoded, code);
}

function strictPositiveInteger(value, code) {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    fail(code);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    fail(code);
  }
  return parsed;
}

function parseState(context) {
  if (!context.exists) {
    fail("STATE_ABSENT", 3);
  }
  const stateStats = lstatIfPresent(context.statePath);
  const pidStats = lstatIfPresent(context.pidPath);
  if (stateStats === undefined && pidStats === undefined) {
    fail("STATE_ABSENT", 3);
  }
  if (stateStats === undefined || pidStats === undefined) {
    fail("STATE_INCOMPLETE");
  }
  requireOwnedRegular(context.statePath);
  requireOwnedRegular(context.pidPath);

  let raw;
  let pidRaw;
  try {
    raw = readFileSync(context.statePath, "utf8");
    pidRaw = readFileSync(context.pidPath, "utf8");
  } catch {
    fail("STATE_READ_FAILED");
  }
  if (!raw.endsWith("\n") || !pidRaw.endsWith("\n")) {
    fail("STATE_FORMAT_INVALID");
  }
  const entries = new Map();
  for (const line of raw.slice(0, -1).split("\n")) {
    const separator = line.indexOf("=");
    if (separator < 1) {
      fail("STATE_FORMAT_INVALID");
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!REQUIRED_STATE_KEYS.includes(key) || entries.has(key)) {
      fail("STATE_FIELDS_INVALID");
    }
    entries.set(key, value);
  }
  if (
    entries.size !== REQUIRED_STATE_KEYS.length ||
    REQUIRED_STATE_KEYS.some((key) => !entries.has(key))
  ) {
    fail("STATE_FIELDS_INVALID");
  }
  const state = {};
  for (const key of REQUIRED_STATE_KEYS) {
    const rawValue = entries.get(key);
    state[key] = STRING_STATE_KEYS.has(key)
      ? decode(rawValue, "STATE_VALUE_INVALID")
      : strictPositiveInteger(rawValue, "STATE_VALUE_INVALID");
  }
  const pidFileValue = strictPositiveInteger(
    pidRaw.slice(0, -1),
    "PID_FILE_INVALID",
  );
  if (state.pid !== pidFileValue) {
    fail("STATE_PID_MISMATCH");
  }
  validateStatePaths(context, state);
  return state;
}

function validateStatePaths(context, state) {
  if (
    state.format !== STATE_FORMAT ||
    state.project_root !== context.projectRoot ||
    state.frontend_root !== join(context.projectRoot, "frontend") ||
    state.host !== HOST ||
    state.port !== PORT ||
    state.strict_port !== "true" ||
    !/^[a-f0-9]{64}$/u.test(state.nonce)
  ) {
    fail("STATE_IDENTITY_INVALID");
  }
  const expectedLauncher = join(
    state.frontend_root,
    "scripts",
    "preview-launcher.mjs",
  );
  const expectedConfig = join(state.frontend_root, "vite.config.ts");
  if (
    state.node_executable !==
      canonicalExistingPath(state.node_executable, "STATE_NODE_INVALID") ||
    state.launcher !==
      canonicalExistingPath(expectedLauncher, "STATE_LAUNCHER_INVALID") ||
    state.config !== canonicalExistingPath(expectedConfig, "STATE_CONFIG_INVALID")
  ) {
    fail("STATE_IDENTITY_INVALID");
  }
  let identityStats;
  for (const [kind, path] of [
    ["identity", state.identity],
    ["log", state.log],
  ]) {
    if (
      dirname(path) !== context.runtimePath ||
      !isContained(context.runtimePath, path) ||
      !path.endsWith(`-${state.nonce}.${kind === "identity" ? "identity" : "log"}`)
    ) {
      fail("STATE_RUNTIME_PATH_INVALID");
    }
    const stats = requireOwnedRegular(path);
    if (kind === "identity") {
      identityStats = stats;
    }
  }
  const launcherStats = statSync(state.launcher);
  if (
    state.identity_device !== String(identityStats.dev) ||
    state.identity_inode !== String(identityStats.ino) ||
    state.launcher_device !== String(launcherStats.dev) ||
    state.launcher_inode !== String(launcherStats.ino)
  ) {
    fail("STATE_FILE_FINGERPRINT_INVALID");
  }
  let parsedArgv;
  try {
    parsedArgv = JSON.parse(state.argv);
  } catch {
    fail("STATE_ARGV_INVALID");
  }
  const expectedArgv = launcherArguments(state);
  if (
    !Array.isArray(parsedArgv) ||
    parsedArgv.length !== expectedArgv.length ||
    parsedArgv.some((value, index) => value !== expectedArgv[index])
  ) {
    fail("STATE_ARGV_INVALID");
  }
}

function launcherArguments(state) {
  return [
    state.launcher,
    "--nonce",
    state.nonce,
    "--identity",
    state.identity,
    "--root",
    state.frontend_root,
    "--config",
    state.config,
    "--host",
    state.host,
    "--port",
    String(state.port),
    "--strict-port",
  ];
}

function run(command, args, code, encoding = "utf8") {
  const result = spawnSync(command, args, {
    encoding,
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(code);
  }
  return result.stdout;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

function processFingerprint(pid) {
  return assertSafeText(
    run("/bin/ps", ["-p", String(pid), "-o", "lstart="], "PROCESS_FINGERPRINT_UNAVAILABLE").trim(),
    "PROCESS_FINGERPRINT_UNAVAILABLE",
  );
}

function processCommand(pid) {
  return assertSafeText(
    run("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], "PROCESS_COMMAND_UNAVAILABLE").trim(),
    "PROCESS_COMMAND_UNAVAILABLE",
  );
}

function lsofNames(pid, descriptor) {
  const args = ["-a", "-p", String(pid)];
  if (descriptor !== undefined) {
    args.push("-d", descriptor);
  }
  args.push("-Fn");
  const output = run("/usr/sbin/lsof", args, "PROCESS_FILES_UNAVAILABLE");
  return new Set(
    output
      .split("\n")
      .filter((line) => line.startsWith("n"))
      .map((line) => line.slice(1)),
  );
}

function lsofRecords(pid) {
  const output = run(
    "/usr/sbin/lsof",
    ["-a", "-p", String(pid), "-F", "fDin"],
    "PROCESS_FILES_UNAVAILABLE",
  );
  const records = [];
  let current;
  for (const line of output.split("\n")) {
    if (line.startsWith("f")) {
      if (current !== undefined) records.push(current);
      current = {};
    } else if (current !== undefined && line.startsWith("D")) {
      try {
        current.device = BigInt(line.slice(1)).toString();
      } catch {
        fail("PROCESS_FILES_UNAVAILABLE");
      }
    } else if (current !== undefined && line.startsWith("i")) {
      current.inode = line.slice(1);
    } else if (current !== undefined && line.startsWith("n")) {
      current.name = line.slice(1);
    }
  }
  if (current !== undefined) records.push(current);
  return records;
}

function verifyProcess(state) {
  if (!processExists(state.pid)) {
    fail("PROCESS_ABSENT", 4);
  }
  if (processFingerprint(state.pid) !== state.start_fingerprint) {
    fail("PROCESS_START_MISMATCH");
  }
  const executableNames = lsofNames(state.pid, "txt");
  if (!executableNames.has(state.node_executable)) {
    fail("PROCESS_EXECUTABLE_MISMATCH");
  }
  const expectedCommand = [state.node_executable, ...launcherArguments(state)].join(
    " ",
  );
  if (processCommand(state.pid) !== expectedCommand) {
    fail("PROCESS_ARGV_MISMATCH");
  }
  const openRecords = lsofRecords(state.pid);
  const holds = (path, device, inode) =>
    openRecords.some(
      (record) =>
        record.name === path &&
        record.device === device &&
        record.inode === inode,
    );
  if (
    !holds(state.identity, state.identity_device, state.identity_inode) ||
    !holds(state.launcher, state.launcher_device, state.launcher_inode)
  ) {
    fail("PROCESS_HELD_IDENTITY_MISMATCH");
  }
  const expectedIdentity = `${STATE_FORMAT}\n${state.nonce}\n`;
  if (readFileSync(state.identity, "utf8") !== expectedIdentity) {
    fail("PROCESS_IDENTITY_CONTENT_MISMATCH");
  }
  return state;
}

function secureCreate(path, content) {
  let descriptor;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, content, { encoding: "utf8" });
    fsyncSync(descriptor);
  } catch {
    fail("RUNTIME_FILE_CREATE_FAILED");
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
  requireOwnedRegular(path);
}

function removeOwnedRegular(path) {
  const stats = lstatIfPresent(path);
  if (stats === undefined) {
    return;
  }
  requireOwnedRegular(path);
  try {
    unlinkSync(path);
  } catch {
    fail("RUNTIME_FILE_REMOVE_FAILED");
  }
}

function prepare(projectArgument) {
  const context = runtimeContext(projectArgument, true);
  if (
    lstatIfPresent(context.statePath) !== undefined ||
    lstatIfPresent(context.pidPath) !== undefined
  ) {
    fail("STATE_ALREADY_EXISTS");
  }
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const nonce = randomBytes(32).toString("hex");
    const identity = join(context.runtimePath, `preview-${nonce}.identity`);
    const log = join(context.runtimePath, `preview-${nonce}.log`);
    if (lstatIfPresent(identity) !== undefined || lstatIfPresent(log) !== undefined) {
      continue;
    }
    secureCreate(identity, `${STATE_FORMAT}\n${nonce}\n`);
    try {
      secureCreate(log, "");
    } catch (error) {
      removeOwnedRegular(identity);
      throw error;
    }
    process.stdout.write(
      `${encode(nonce)}\n${encode(identity)}\n${encode(log)}\n`,
    );
    return;
  }
  fail("INSTANCE_IDENTITY_CREATE_FAILED");
}

function stateFromPublishArgs(context, args) {
  if (args.length !== 7) {
    fail("PUBLISH_ARGUMENTS_INVALID");
  }
  const [pidText, nonce, identity, log, nodeExecutable, launcher, config] = args;
  const pid = strictPositiveInteger(pidText, "PUBLISH_PID_INVALID");
  const frontendRoot = join(context.projectRoot, "frontend");
  const state = {
    format: STATE_FORMAT,
    pid,
    nonce: assertSafeText(nonce, "PUBLISH_NONCE_INVALID"),
    project_root: context.projectRoot,
    frontend_root: frontendRoot,
    node_executable: canonicalExistingPath(
      nodeExecutable,
      "PUBLISH_NODE_INVALID",
    ),
    launcher: canonicalExistingPath(launcher, "PUBLISH_LAUNCHER_INVALID"),
    launcher_device: "",
    launcher_inode: "",
    config: canonicalExistingPath(config, "PUBLISH_CONFIG_INVALID"),
    identity: assertSafeText(identity, "PUBLISH_IDENTITY_INVALID"),
    identity_device: "",
    identity_inode: "",
    log: assertSafeText(log, "PUBLISH_LOG_INVALID"),
    host: HOST,
    port: PORT,
    strict_port: "true",
    start_fingerprint: processFingerprint(pid),
    argv: "",
  };
  const identityStats = statSync(state.identity);
  const launcherStats = statSync(state.launcher);
  state.identity_device = String(identityStats.dev);
  state.identity_inode = String(identityStats.ino);
  state.launcher_device = String(launcherStats.dev);
  state.launcher_inode = String(launcherStats.ino);
  state.argv = JSON.stringify(launcherArguments(state));
  validateStatePaths(context, state);
  verifyProcess(state);
  return state;
}

function serializeState(state) {
  return `${REQUIRED_STATE_KEYS.map((key) => {
    const value = state[key];
    return `${key}=${STRING_STATE_KEYS.has(key) ? encode(value) : value}`;
  }).join("\n")}\n`;
}

function atomicPublish(path, content, runtimePath) {
  let temporary;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const token = randomBytes(16).toString("hex");
    const candidate = join(runtimePath, `.publish-${token}.tmp`);
    if (lstatIfPresent(candidate) !== undefined) {
      continue;
    }
    secureCreate(candidate, content);
    temporary = candidate;
    break;
  }
  if (temporary === undefined) {
    fail("STATE_TEMP_CREATE_FAILED");
  }
  try {
    renameSync(temporary, path);
  } catch {
    removeOwnedRegular(temporary);
    fail("STATE_PUBLISH_FAILED");
  }
  requireOwnedRegular(path);
}

function publish(projectArgument, args) {
  const context = runtimeContext(projectArgument, false);
  if (!context.exists) {
    fail("RUNTIME_DIRECTORY_UNAVAILABLE");
  }
  if (
    lstatIfPresent(context.statePath) !== undefined ||
    lstatIfPresent(context.pidPath) !== undefined
  ) {
    fail("STATE_ALREADY_EXISTS");
  }
  const state = stateFromPublishArgs(context, args);
  atomicPublish(
    context.statePath,
    serializeState(state),
    context.runtimePath,
  );
  try {
    atomicPublish(context.pidPath, `${state.pid}\n`, context.runtimePath);
  } catch (error) {
    removeOwnedRegular(context.statePath);
    throw error;
  }
}

function readVerified(projectArgument) {
  const context = runtimeContext(projectArgument, false);
  const state = parseState(context);
  verifyProcess(state);
  process.stdout.write(`${state.pid}\n`);
}

function readPid(projectArgument) {
  const context = runtimeContext(projectArgument, false);
  const state = parseState(context);
  process.stdout.write(`${state.pid}\n`);
}

function cleanupState(projectArgument, requireAbsent) {
  const context = runtimeContext(projectArgument, false);
  const state = parseState(context);
  if (requireAbsent && processExists(state.pid)) {
    fail("PROCESS_STILL_PRESENT");
  }
  removeOwnedRegular(context.pidPath);
  removeOwnedRegular(context.statePath);
  removeOwnedRegular(state.identity);
  removeOwnedRegular(state.log);
}

function cleanupUnpublished(projectArgument, args) {
  if (args.length !== 3) {
    fail("CLEANUP_ARGUMENTS_INVALID");
  }
  const [nonce, identity, log] = args;
  const context = runtimeContext(projectArgument, false);
  if (!context.exists || !/^[a-f0-9]{64}$/u.test(nonce)) {
    fail("CLEANUP_IDENTITY_INVALID");
  }
  for (const [path, suffix] of [
    [identity, "identity"],
    [log, "log"],
  ]) {
    if (
      dirname(path) !== context.runtimePath ||
      path !== join(context.runtimePath, `preview-${nonce}.${suffix}`)
    ) {
      fail("CLEANUP_PATH_INVALID");
    }
  }
  removeOwnedRegular(identity);
  removeOwnedRegular(log);
}

function main() {
  const [command, projectArgument, ...args] = process.argv.slice(2);
  if (!command || !projectArgument) {
    fail("COMMAND_ARGUMENTS_INVALID");
  }
  switch (command) {
    case "prepare":
      if (args.length !== 0) fail("COMMAND_ARGUMENTS_INVALID");
      prepare(projectArgument);
      break;
    case "publish":
      publish(projectArgument, args);
      break;
    case "verify":
      if (args.length !== 0) fail("COMMAND_ARGUMENTS_INVALID");
      readVerified(projectArgument);
      break;
    case "pid":
      if (args.length !== 0) fail("COMMAND_ARGUMENTS_INVALID");
      readPid(projectArgument);
      break;
    case "cleanup":
      if (args.length !== 0) fail("COMMAND_ARGUMENTS_INVALID");
      cleanupState(projectArgument, false);
      break;
    case "cleanup-stale":
      if (args.length !== 0) fail("COMMAND_ARGUMENTS_INVALID");
      cleanupState(projectArgument, true);
      break;
    case "cleanup-unpublished":
      cleanupUnpublished(projectArgument, args);
      break;
    default:
      fail("COMMAND_UNKNOWN");
  }
}

try {
  main();
} catch (error) {
  if (error instanceof RuntimeError) {
    process.stderr.write(`${error.code}\n`);
    process.exit(error.exitCode);
  }
  process.stderr.write("RUNTIME_HELPER_FAILURE\n");
  process.exit(1);
}
