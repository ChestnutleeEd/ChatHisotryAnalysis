#!/bin/zsh

set -eu
umask 077

PROJECT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"
START_COMMAND="$PROJECT_ROOT/Start Chat Analysis.command"
STOP_COMMAND="$PROJECT_ROOT/Stop Chat Analysis.command"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
RUNTIME_DIR="$PROJECT_ROOT/.chat-analysis-runtime"
STATE_FILE="$RUNTIME_DIR/preview.state"
PID_FILE="$RUNTIME_DIR/preview.pid"
RUNTIME_HELPER="$FRONTEND_DIR/scripts/launch-runtime.mjs"
VITE_ENTRY="$FRONTEND_DIR/node_modules/vite/bin/vite.js"
HOST="127.0.0.1"
PORT="4173"
URL="http://$HOST:$PORT"
NODE_BIN="$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.execPath))')"
export CHAT_ANALYSIS_SKIP_BROWSER_OPEN=1

fail() {
  print -u2 -- "launch command test failed: $1"
  exit 1
}

sha256() {
  openssl dgst -sha256 "$1" | awk '{print $NF}'
}

wait_for_exit() {
  local target_pid="$1"
  for _ in {1..100}; do
    if ! kill -0 "$target_pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.1
  done
  return 1
}

start_clean() {
  "$START_COMMAND" >&2
  local pid_value
  pid_value="$(<"$PID_FILE")"
  kill -0 "$pid_value"
  [[ "$(node "$RUNTIME_HELPER" verify "$PROJECT_ROOT")" == "$pid_value" ]]
  print -r -- "$pid_value"
}

stop_clean() {
  local target_pid="$1"
  "$STOP_COMMAND"
  [[ ! -e "$STATE_FILE" && ! -L "$STATE_FILE" ]]
  [[ ! -e "$PID_FILE" && ! -L "$PID_FILE" ]]
  wait_for_exit "$target_pid" || fail "verified launcher remained alive"
}

state_value() {
  node - "$STATE_FILE" "$1" <<'NODE'
const fs = require("node:fs");
const [path, key] = process.argv.slice(2);
const entry = fs.readFileSync(path, "utf8")
  .trimEnd()
  .split("\n")
  .find((line) => line.startsWith(`${key}=`));
if (entry === undefined) process.exit(1);
const value = entry.slice(key.length + 1);
if (["pid", "port"].includes(key)) {
  process.stdout.write(value);
} else {
  process.stdout.write(Buffer.from(value, "base64url").toString("utf8"));
}
NODE
}

set_state_value() {
  local key="$1"
  local value="$2"
  local encoding="${3:-encoded}"
  node - "$STATE_FILE" "$key" "$value" "$encoding" <<'NODE'
const fs = require("node:fs");
const [path, key, value, encoding] = process.argv.slice(2);
const lines = fs.readFileSync(path, "utf8").trimEnd().split("\n");
let changes = 0;
const replacement = encoding === "plain"
  ? value
  : Buffer.from(value, "utf8").toString("base64url");
const output = lines.map((line) => {
  if (!line.startsWith(`${key}=`)) return line;
  changes += 1;
  return `${key}=${replacement}`;
});
if (changes !== 1) process.exit(1);
fs.writeFileSync(path, `${output.join("\n")}\n`, { mode: 0o600 });
NODE
}

save_state() {
  local state_copy="$1"
  local pid_copy="$2"
  cp "$STATE_FILE" "$state_copy"
  cp "$PID_FILE" "$pid_copy"
}

restore_state() {
  local state_copy="$1"
  local pid_copy="$2"
  cp "$state_copy" "$STATE_FILE"
  cp "$pid_copy" "$PID_FILE"
  chmod 600 "$STATE_FILE" "$PID_FILE"
}

assert_stop_refused_alive() {
  local target_pid="$1"
  if "$STOP_COMMAND"; then
    fail "unsafe state was not refused"
  fi
  kill -0 "$target_pid" || fail "refused target was signalled"
}

[[ -x "$START_COMMAND" ]]
[[ -x "$STOP_COMMAND" ]]
[[ -f "$RUNTIME_HELPER" && ! -L "$RUNTIME_HELPER" ]]

# No-state, positive identity, duplicate start, state completeness, and TERM.
"$STOP_COMMAND"
POSITIVE_PID="$(start_clean)"
FIRST_NONCE="$(state_value nonce)"
[[ "${#FIRST_NONCE}" == "64" ]]
[[ "$FIRST_NONCE" != *[^a-f0-9]* ]]
[[ "$(state_value node_executable)" == "$NODE_BIN" ]]
[[ "$(state_value launcher)" == "$FRONTEND_DIR/scripts/preview-launcher.mjs" ]]
[[ "$(state_value host)" == "$HOST" ]]
[[ "$(state_value port)" == "$PORT" ]]
[[ "$(state_value strict_port)" == "true" ]]
[[ "$(state_value start_fingerprint)" == \
  "$(/bin/ps -p "$POSITIVE_PID" -o lstart= | sed -e 's/^ *//' -e 's/ *$//')" ]]
IDENTITY_FILE="$(state_value identity)"
LOG_FILE="$(state_value log)"
[[ "$(stat -f '%Lp' "$RUNTIME_DIR")" == "700" ]]
[[ "$(stat -f '%Lp' "$STATE_FILE")" == "600" ]]
[[ "$(stat -f '%Lp' "$PID_FILE")" == "600" ]]
[[ "$(stat -f '%Lp' "$IDENTITY_FILE")" == "600" ]]
[[ "$(stat -f '%Lp' "$LOG_FILE")" == "600" ]]
/usr/sbin/lsof -a -p "$POSITIVE_PID" -Fn | rg -Fxq "n$IDENTITY_FILE"
/usr/sbin/lsof -a -p "$POSITIVE_PID" -Fn | rg -Fxq \
  "n$FRONTEND_DIR/scripts/preview-launcher.mjs"
if rg -Fq "$FIRST_NONCE" "$LOG_FILE"; then
  fail "instance nonce leaked into the preview log"
fi
"$START_COMMAND"
[[ "$(<"$PID_FILE")" == "$POSITIVE_PID" ]]
[[ "$(state_value nonce)" == "$FIRST_NONCE" ]]
stop_clean "$POSITIVE_PID"
"$STOP_COMMAND"

# Structurally valid stale PID is cleaned without a signal.
STALE_PID="$(start_clean)"
kill -TERM "$STALE_PID"
wait_for_exit "$STALE_PID" || fail "stale test launcher did not exit"
"$STOP_COMMAND"
[[ ! -e "$STATE_FILE" && ! -e "$PID_FILE" ]]

# argv spoof: old Vite substrings are present, but ownership evidence is absent.
SPOOF_TARGET_PID="$(start_clean)"
SPOOF_STATE="$(mktemp /tmp/chat-analysis-spoof-state.XXXXXX)"
SPOOF_PID_COPY="$(mktemp /tmp/chat-analysis-spoof-pid.XXXXXX)"
save_state "$SPOOF_STATE" "$SPOOF_PID_COPY"
"$NODE_BIN" -e 'setInterval(() => {}, 1000)' \
  "$VITE_ENTRY" preview --host "$HOST" --port "$PORT" --strictPort \
  "$PROJECT_ROOT" &
UNRELATED_PID="$!"
sleep 0.2
set_state_value pid "$UNRELATED_PID" plain
print -r -- "$UNRELATED_PID" > "$PID_FILE"
set_state_value start_fingerprint \
  "$(/bin/ps -p "$UNRELATED_PID" -o lstart= | xargs)"
assert_stop_refused_alive "$UNRELATED_PID"
kill -0 "$SPOOF_TARGET_PID"
restore_state "$SPOOF_STATE" "$SPOOF_PID_COPY"
kill -TERM "$UNRELATED_PID"
wait "$UNRELATED_PID" 2>/dev/null || true
stop_clean "$SPOOF_TARGET_PID"

# Wrong nonce, process start fingerprint, and actual executable are refused.
for mutation in nonce start_fingerprint node_executable; do
  TARGET_PID="$(start_clean)"
  STATE_COPY="$(mktemp /tmp/chat-analysis-mutation-state.XXXXXX)"
  PID_COPY="$(mktemp /tmp/chat-analysis-mutation-pid.XXXXXX)"
  save_state "$STATE_COPY" "$PID_COPY"
  case "$mutation" in
    nonce)
      set_state_value nonce \
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      ;;
    start_fingerprint)
      set_state_value start_fingerprint "Mon Jan  1 00:00:00 2001"
      ;;
    node_executable)
      set_state_value node_executable "/bin/zsh"
      ;;
  esac
  assert_stop_refused_alive "$TARGET_PID"
  restore_state "$STATE_COPY" "$PID_COPY"
  stop_clean "$TARGET_PID"
done

# A path entry that replaced the held-open identity inode is not ownership proof.
NOT_HELD_PID="$(start_clean)"
NOT_HELD_IDENTITY="$(state_value identity)"
NOT_HELD_LOG="$(state_value log)"
NOT_HELD_NONCE="$(state_value nonce)"
unlink "$NOT_HELD_IDENTITY"
printf '%s\n%s\n' "chat-analysis-preview-v2" "$NOT_HELD_NONCE" \
  > "$NOT_HELD_IDENTITY"
chmod 600 "$NOT_HELD_IDENTITY"
assert_stop_refused_alive "$NOT_HELD_PID"
kill -TERM "$NOT_HELD_PID"
wait_for_exit "$NOT_HELD_PID" || fail "identity-not-held target did not exit"
unlink "$PID_FILE"
unlink "$STATE_FILE"
unlink "$NOT_HELD_IDENTITY"
unlink "$NOT_HELD_LOG"

# TERM succeeds, but a stopped process with changed state is never sent KILL.
KILL_PID="$(start_clean)"
KILL_STATE="$(mktemp /tmp/chat-analysis-kill-state.XXXXXX)"
KILL_PID_COPY="$(mktemp /tmp/chat-analysis-kill-pid.XXXXXX)"
save_state "$KILL_STATE" "$KILL_PID_COPY"
kill -STOP "$KILL_PID"
KILL_OUTPUT="$(mktemp /tmp/chat-analysis-kill-stop.XXXXXX)"
"$STOP_COMMAND" > "$KILL_OUTPUT" 2>&1 &
STOP_TEST_PID="$!"
sleep 1
set_state_value start_fingerprint "Mon Jan  1 00:00:00 2001"
wait "$STOP_TEST_PID" && fail "KILL revalidation unexpectedly passed"
kill -0 "$KILL_PID" || fail "KILL was sent after identity changed"
restore_state "$KILL_STATE" "$KILL_PID_COPY"
kill -CONT "$KILL_PID"
wait_for_exit "$KILL_PID" || fail "continued TERM target did not exit"
"$STOP_COMMAND"

# HTTP and Vite strict-port conflicts preserve their owner and publish no state.
for conflict_kind in http vite; do
  if [[ "$conflict_kind" == "http" ]]; then
    "$NODE_BIN" -e '
      require("node:http")
        .createServer((_request, response) => response.end("occupied"))
        .listen(4173, "127.0.0.1");
    ' &
  else
    (
      cd "$FRONTEND_DIR"
      exec "$NODE_BIN" "$VITE_ENTRY" preview \
        --host "$HOST" --port "$PORT" --strictPort
    ) >/tmp/chat-analysis-conflict-vite.log 2>&1 &
  fi
  CONFLICT_PID="$!"
  for _ in {1..50}; do
    if kill -0 "$CONFLICT_PID" 2>/dev/null &&
      curl --fail --silent --max-time 1 "$URL/" >/dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done
  if "$START_COMMAND"; then
    fail "$conflict_kind port conflict unexpectedly started"
  fi
  kill -0 "$CONFLICT_PID"
  [[ ! -e "$STATE_FILE" && ! -e "$PID_FILE" ]]
  kill -TERM "$CONFLICT_PID"
  wait "$CONFLICT_PID" 2>/dev/null || true
done

# Symlink and unsafe-mode matrix uses only /tmp sentinels.
mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"
if [[ -f "$RUNTIME_DIR/preview.log" && ! -L "$RUNTIME_DIR/preview.log" ]]; then
  [[ "$(stat -f '%u' "$RUNTIME_DIR/preview.log")" == "$(id -u)" ]]
  [[ "$(stat -f '%Lp' "$RUNTIME_DIR/preview.log")" == "600" ]]
  unlink "$RUNTIME_DIR/preview.log"
fi
SENTINEL="$(mktemp /tmp/chat-analysis-sentinel.XXXXXX)"
print -r -- "external sentinel" > "$SENTINEL"
SENTINEL_HASH="$(sha256 "$SENTINEL")"
SENTINEL_DIR="$(mktemp -d /tmp/chat-analysis-sentinel-dir.XXXXXX)"
DIR_SENTINEL="$SENTINEL_DIR/value"
print -r -- "directory sentinel" > "$DIR_SENTINEL"
DIR_SENTINEL_HASH="$(sha256 "$DIR_SENTINEL")"

rmdir "$RUNTIME_DIR"
ln -s "$SENTINEL_DIR" "$RUNTIME_DIR"
"$START_COMMAND" && fail "runtime-directory symlink was accepted"
[[ "$(sha256 "$DIR_SENTINEL")" == "$DIR_SENTINEL_HASH" ]]
unlink "$RUNTIME_DIR"
mkdir "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR"

ln -s "$SENTINEL" "$STATE_FILE"
"$START_COMMAND" && fail "state symlink was accepted"
"$STOP_COMMAND" && fail "state symlink was accepted by Stop"
[[ "$(sha256 "$SENTINEL")" == "$SENTINEL_HASH" ]]
unlink "$STATE_FILE"

ln -s "$SENTINEL" "$PID_FILE"
"$START_COMMAND" && fail "PID symlink was accepted"
"$STOP_COMMAND" && fail "PID symlink was accepted by Stop"
[[ "$(sha256 "$SENTINEL")" == "$SENTINEL_HASH" ]]
unlink "$PID_FILE"

ln -s "$SENTINEL" "$RUNTIME_DIR/preview.log"
LOG_SYMLINK_PID="$(start_clean)"
[[ "$(sha256 "$SENTINEL")" == "$SENTINEL_HASH" ]]
stop_clean "$LOG_SYMLINK_PID"
unlink "$RUNTIME_DIR/preview.log"

ln -s "$SENTINEL" "$RUNTIME_DIR/.publish-collision.tmp"
TEMP_COLLISION_PID="$(start_clean)"
[[ "$(sha256 "$SENTINEL")" == "$SENTINEL_HASH" ]]
stop_clean "$TEMP_COLLISION_PID"
unlink "$RUNTIME_DIR/.publish-collision.tmp"

IDENTITY_SYMLINK_PID="$(start_clean)"
IDENTITY_SYMLINK_PATH="$(state_value identity)"
IDENTITY_SYMLINK_LOG="$(state_value log)"
IDENTITY_SYMLINK_NONCE="$(state_value nonce)"
unlink "$IDENTITY_SYMLINK_PATH"
ln -s "$SENTINEL" "$IDENTITY_SYMLINK_PATH"
assert_stop_refused_alive "$IDENTITY_SYMLINK_PID"
[[ "$(sha256 "$SENTINEL")" == "$SENTINEL_HASH" ]]
unlink "$IDENTITY_SYMLINK_PATH"
printf '%s\n%s\n' "chat-analysis-preview-v2" "$IDENTITY_SYMLINK_NONCE" \
  > "$IDENTITY_SYMLINK_PATH"
chmod 600 "$IDENTITY_SYMLINK_PATH"
kill -TERM "$IDENTITY_SYMLINK_PID"
wait_for_exit "$IDENTITY_SYMLINK_PID" ||
  fail "identity-symlink target did not exit"
unlink "$PID_FILE"
unlink "$STATE_FILE"
unlink "$IDENTITY_SYMLINK_PATH"
unlink "$IDENTITY_SYMLINK_LOG"

chmod 755 "$RUNTIME_DIR"
"$START_COMMAND" && fail "unsafe runtime mode was accepted"
chmod 700 "$RUNTIME_DIR"
[[ "$(sha256 "$SENTINEL")" == "$SENTINEL_HASH" ]]

# A path with spaces self-resolves to the canonical project and remains safe.
SPACE_LINK="$(mktemp -u '/tmp/Chat Analysis Project.XXXXXX')"
ln -s "$PROJECT_ROOT" "$SPACE_LINK"
SPACE_PID="$(CHAT_ANALYSIS_SKIP_BROWSER_OPEN=1 \
  "$SPACE_LINK/Start Chat Analysis.command" >/dev/null &&
  <"$PID_FILE")"
"$SPACE_LINK/Stop Chat Analysis.command"
wait_for_exit "$SPACE_PID" || fail "space-path launcher remained alive"
unlink "$SPACE_LINK"

# First-use copy: no node_modules/dist/runtime, automatic npm ci, one open,
# Worker/WASM probe, normal Stop, and unchanged user npm configuration.
FIRST_USE_ROOT="$(mktemp -d '/tmp/Chat Analysis First Use.XXXXXX')"
mkdir "$FIRST_USE_ROOT/frontend"
rsync -a \
  --exclude node_modules \
  --exclude dist \
  --exclude coverage \
  --exclude playwright-report \
  --exclude test-results \
  "$FRONTEND_DIR/" "$FIRST_USE_ROOT/frontend/"
cp "$START_COMMAND" "$FIRST_USE_ROOT/Start Chat Analysis.command"
cp "$STOP_COMMAND" "$FIRST_USE_ROOT/Stop Chat Analysis.command"
chmod +x "$FIRST_USE_ROOT/Start Chat Analysis.command" \
  "$FIRST_USE_ROOT/Stop Chat Analysis.command"
mkdir "$FIRST_USE_ROOT/test-bin"
OPEN_LOG="$FIRST_USE_ROOT/browser-open.log"
print -r -- '#!/bin/zsh
print -r -- "$1" >> "$CHAT_ANALYSIS_OPEN_LOG"' \
  > "$FIRST_USE_ROOT/test-bin/open"
chmod +x "$FIRST_USE_ROOT/test-bin/open"
NPM_USER_CONFIG_BEFORE="$(
  npm config list --location=user --json 2>/dev/null |
    openssl dgst -sha256 | awk '{print $NF}'
)"
unset CHAT_ANALYSIS_SKIP_BROWSER_OPEN
export CHAT_ANALYSIS_OPEN_LOG="$OPEN_LOG"
PATH="$FIRST_USE_ROOT/test-bin:$PATH" \
  npm_config_userconfig=/dev/null \
  npm_config_registry=https://registry.npmjs.org/ \
  npm_config_cache=/tmp/chat-analysis-first-use-npm-cache \
  "$FIRST_USE_ROOT/Start Chat Analysis.command"
[[ -f "$FIRST_USE_ROOT/frontend/node_modules/vite/bin/vite.js" ]]
[[ -f "$FIRST_USE_ROOT/frontend/dist/index.html" ]]
[[ "$(wc -l < "$OPEN_LOG" | xargs)" == "1" ]]
[[ "$(<"$OPEN_LOG")" == "$URL" ]]
FIRST_USE_PID="$(<"$FIRST_USE_ROOT/.chat-analysis-runtime/preview.pid")"
kill -0 "$FIRST_USE_PID"
(
  cd "$FRONTEND_DIR"
  node --input-type=module - "$URL" <<'NODE'
import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(process.argv[2]);
await page.waitForFunction(() =>
  document.querySelector("[data-testid=worker-status]")?.textContent === "ready",
);
if ((await page.getByTestId("worker-status").textContent()) !== "ready") {
  process.exit(1);
}
if ((await page.getByTestId("token-count").textContent()) !== "合成探针 token：3") {
  process.exit(1);
}
const notice = await page.evaluate(() =>
  fetch("/THIRD_PARTY_NOTICES.txt").then((response) => response.text()),
);
if (!notice.includes("jieba-wasm 2.4.0")) process.exit(1);
await browser.close();
NODE
)
"$FIRST_USE_ROOT/Stop Chat Analysis.command"
wait_for_exit "$FIRST_USE_PID" || fail "first-use launcher remained alive"
[[ ! -e "$FIRST_USE_ROOT/.chat-analysis-runtime/preview.state" ]]
[[ ! -e "$FIRST_USE_ROOT/.chat-analysis-runtime/preview.pid" ]]
NPM_USER_CONFIG_AFTER="$(
  npm config list --location=user --json 2>/dev/null |
    openssl dgst -sha256 | awk '{print $NF}'
)"
[[ "$NPM_USER_CONFIG_BEFORE" == "$NPM_USER_CONFIG_AFTER" ]]
export CHAT_ANALYSIS_SKIP_BROWSER_OPEN=1

# Controlled npm-ci failure: no browser, preview, or valid runtime publication.
INSTALL_FAIL_ROOT="$(mktemp -d '/tmp/Chat Analysis Install Fail.XXXXXX')"
mkdir "$INSTALL_FAIL_ROOT/frontend"
rsync -a \
  --exclude node_modules \
  --exclude dist \
  --exclude coverage \
  --exclude playwright-report \
  --exclude test-results \
  "$FRONTEND_DIR/" "$INSTALL_FAIL_ROOT/frontend/"
cp "$START_COMMAND" "$INSTALL_FAIL_ROOT/Start Chat Analysis.command"
cp "$STOP_COMMAND" "$INSTALL_FAIL_ROOT/Stop Chat Analysis.command"
chmod +x "$INSTALL_FAIL_ROOT/Start Chat Analysis.command" \
  "$INSTALL_FAIL_ROOT/Stop Chat Analysis.command"
mkdir "$INSTALL_FAIL_ROOT/test-bin"
FAIL_OPEN_LOG="$INSTALL_FAIL_ROOT/browser-open.log"
print -r -- '#!/bin/zsh
print -r -- "$1" >> "$CHAT_ANALYSIS_OPEN_LOG"' \
  > "$INSTALL_FAIL_ROOT/test-bin/open"
print -r -- '#!/bin/zsh
if [[ "${1:-}" == "--version" ]]; then
  print -- "11.16.0"
  exit 0
fi
exit 42' > "$INSTALL_FAIL_ROOT/test-bin/npm"
chmod +x "$INSTALL_FAIL_ROOT/test-bin/open" "$INSTALL_FAIL_ROOT/test-bin/npm"
export CHAT_ANALYSIS_OPEN_LOG="$FAIL_OPEN_LOG"
if PATH="$INSTALL_FAIL_ROOT/test-bin:$PATH" \
  "$INSTALL_FAIL_ROOT/Start Chat Analysis.command"; then
  fail "controlled dependency installation failure unexpectedly succeeded"
fi
[[ ! -e "$FAIL_OPEN_LOG" ]]
[[ ! -e "$INSTALL_FAIL_ROOT/.chat-analysis-runtime/preview.state" ]]
[[ ! -e "$INSTALL_FAIL_ROOT/.chat-analysis-runtime/preview.pid" ]]
if curl --fail --silent --max-time 1 "$URL/" >/dev/null 2>&1; then
  fail "preview remained after controlled dependency installation failure"
fi

# Static patterns and ignore coverage.
if rg -n \
  '/Users/|0\\.0\\.0\\.0|killall|pkill|lsof.*[|].*kill|\beval\b|\bsource[[:space:]].*state|npm install|npx .*@latest|channel: .chrome.' \
  "$START_COMMAND" "$STOP_COMMAND" "$FRONTEND_DIR/scripts" \
  "$FRONTEND_DIR/playwright.shared.ts"; then
  fail "forbidden or hard-coded launch pattern found"
fi

git -C "$PROJECT_ROOT" check-ignore -q ".chat-analysis-runtime/preview.pid"
git -C "$PROJECT_ROOT" check-ignore -q ".chat-analysis-runtime/preview.state"
git -C "$PROJECT_ROOT" check-ignore -q \
  ".chat-analysis-runtime/preview-example.identity"
git -C "$PROJECT_ROOT" check-ignore -q \
  ".chat-analysis-runtime/preview-example.log"
git -C "$PROJECT_ROOT" check-ignore -q "frontend/node_modules/"
git -C "$PROJECT_ROOT" check-ignore -q "frontend/dist/"
git -C "$PROJECT_ROOT" check-ignore -q "frontend/coverage/"
git -C "$PROJECT_ROOT" check-ignore -q "frontend/playwright-report/"
git -C "$PROJECT_ROOT" check-ignore -q "frontend/test-results/"
git -C "$PROJECT_ROOT" check-ignore -q "temporary-package.tgz"

print -- "launch command tests passed"
