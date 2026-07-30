#!/bin/zsh

set -eu
umask 077

fail() {
  print -u2 -- "Chat Analysis start failed: $1"
  exit 1
}

decode_value() {
  node -e '
    const value = Buffer.from(process.argv[1], "base64url").toString("utf8");
    if (Buffer.from(value, "utf8").toString("base64url") !== process.argv[1]) {
      process.exit(1);
    }
    process.stdout.write(value);
  ' "$1"
}

command -v node >/dev/null 2>&1 || fail "Node.js is required"
command -v npm >/dev/null 2>&1 || fail "npm is required"
command -v curl >/dev/null 2>&1 || fail "curl is required"

SCRIPT_PATH="$(node -e '
  const { realpathSync } = require("node:fs");
  process.stdout.write(realpathSync(process.argv[1]));
' "$0")" || fail "cannot resolve the command location"
PROJECT_ROOT="$(dirname -- "$SCRIPT_PATH")"
PROJECT_ROOT="$(CDPATH= cd -- "$PROJECT_ROOT" && pwd -P)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
PACKAGE_JSON="$FRONTEND_DIR/package.json"
PACKAGE_LOCK="$FRONTEND_DIR/package-lock.json"
VITE_ENTRY="$FRONTEND_DIR/node_modules/vite/bin/vite.js"
LAUNCHER="$FRONTEND_DIR/scripts/preview-launcher.mjs"
RUNTIME_HELPER="$FRONTEND_DIR/scripts/launch-runtime.mjs"
CONFIG="$FRONTEND_DIR/vite.config.ts"
HOST="127.0.0.1"
PORT="4173"
URL="http://$HOST:$PORT"

[[ -f "$PACKAGE_JSON" && ! -L "$PACKAGE_JSON" ]] ||
  fail "frontend/package.json is missing or unsafe"
[[ -f "$PACKAGE_LOCK" && ! -L "$PACKAGE_LOCK" ]] ||
  fail "frontend/package-lock.json is missing or unsafe"
[[ -f "$LAUNCHER" && ! -L "$LAUNCHER" ]] ||
  fail "project preview launcher is missing or unsafe"
[[ -f "$RUNTIME_HELPER" && ! -L "$RUNTIME_HELPER" ]] ||
  fail "project runtime helper is missing or unsafe"
[[ -f "$CONFIG" && ! -L "$CONFIG" ]] ||
  fail "Vite configuration is missing or unsafe"

node -e '
  const [major, minor] = process.versions.node.split(".").map(Number);
  const supported =
    (major === 20 && minor >= 19) ||
    (major === 22 && minor >= 13) ||
    major >= 24;
  process.exit(supported ? 0 : 1);
' || fail "unsupported Node.js version; see frontend/package.json"

NPM_VERSION="$(npm --version)"
NPM_MAJOR="${NPM_VERSION%%.*}"
case "$NPM_MAJOR" in
  10|11) ;;
  *) fail "unsupported npm version; see frontend/package.json" ;;
esac

STATE_PID=""
if STATE_PID="$(node "$RUNTIME_HELPER" pid "$PROJECT_ROOT" 2>/dev/null)"; then
  if kill -0 "$STATE_PID" 2>/dev/null &&
    VERIFIED_PID="$(node "$RUNTIME_HELPER" verify "$PROJECT_ROOT" 2>/dev/null)" &&
    [[ "$VERIFIED_PID" == "$STATE_PID" ]]; then
    print -- "Chat Analysis is already running at $URL"
    if [[ "${CHAT_ANALYSIS_SKIP_BROWSER_OPEN:-0}" != "1" ]]; then
      open "$URL"
    fi
    exit 0
  fi
  fail "stale or mismatched local state; run Stop Chat Analysis.command"
else
  STATE_STATUS="$?"
  if [[ "$STATE_STATUS" != "3" ]]; then
    fail "local runtime state is unsafe or incomplete"
  fi
fi

dependencies_complete() {
  [[ -f "$VITE_ENTRY" && ! -L "$VITE_ENTRY" ]] || return 1
  (
    cd "$FRONTEND_DIR"
    node -e '
      const { lstatSync } = require("node:fs");
      const required = [
        "node_modules/vite/package.json",
        "node_modules/react/package.json",
        "node_modules/react-dom/package.json",
        "node_modules/jieba-wasm/package.json",
        "node_modules/echarts/package.json",
        "node_modules/echarts-wordcloud/package.json",
        "node_modules/typescript/package.json",
        "node_modules/@vitejs/plugin-react/package.json",
      ];
      for (const path of required) {
        try {
          const stats = lstatSync(path);
          if (!stats.isFile() || stats.isSymbolicLink()) process.exit(1);
        } catch {
          process.exit(1);
        }
      }
    '
  )
}

if ! dependencies_complete; then
  print -- "Installing project-local dependencies from package-lock.json..."
  (
    cd "$FRONTEND_DIR"
    npm ci --no-audit --no-fund
  ) || fail "project-local dependency installation failed"
  dependencies_complete ||
    fail "project-local dependency installation is incomplete"
fi

(
  cd "$FRONTEND_DIR"
  npm run build
) || fail "production build failed"

PREPARED_VALUES="$(node "$RUNTIME_HELPER" prepare "$PROJECT_ROOT")" ||
  fail "cannot create secure local runtime files"
PREPARED_LINES=("${(@f)PREPARED_VALUES}")
[[ "${#PREPARED_LINES[@]}" == "3" ]] ||
  fail "runtime identity preparation returned invalid data"
NONCE="$(decode_value "$PREPARED_LINES[1]")" ||
  fail "runtime nonce decoding failed"
IDENTITY_FILE="$(decode_value "$PREPARED_LINES[2]")" ||
  fail "runtime identity path decoding failed"
LOG_FILE="$(decode_value "$PREPARED_LINES[3]")" ||
  fail "runtime log path decoding failed"

NODE_BIN="$(node -e '
  const { realpathSync } = require("node:fs");
  process.stdout.write(realpathSync(process.execPath));
')"

cleanup_unpublished() {
  node "$RUNTIME_HELPER" cleanup-unpublished "$PROJECT_ROOT" \
    "$NONCE" "$IDENTITY_FILE" "$LOG_FILE" >/dev/null 2>&1 || true
}

(
  cd "$FRONTEND_DIR"
  exec nohup "$NODE_BIN" "$LAUNCHER" \
    --nonce "$NONCE" \
    --identity "$IDENTITY_FILE" \
    --root "$FRONTEND_DIR" \
    --config "$CONFIG" \
    --host "$HOST" \
    --port "$PORT" \
    --strict-port
) >>"$LOG_FILE" 2>&1 &
SERVICE_PID="$!"

terminate_unpublished() {
  if kill -0 "$SERVICE_PID" 2>/dev/null; then
    kill -TERM "$SERVICE_PID" 2>/dev/null || true
    for _ in {1..30}; do
      if ! kill -0 "$SERVICE_PID" 2>/dev/null; then
        break
      fi
      sleep 0.1
    done
  fi
  cleanup_unpublished
}

READY="0"
for _ in {1..150}; do
  if ! kill -0 "$SERVICE_PID" 2>/dev/null; then
    wait "$SERVICE_PID" 2>/dev/null || true
    cleanup_unpublished
    fail "preview exited before readiness; the port may be in use"
  fi
  if curl --fail --silent --max-time 1 "$URL/" 2>/dev/null |
    grep -Fq "<title>本地聊天分析 · 基础设施探针</title>"; then
    READY="1"
    break
  fi
  sleep 0.1
done

if [[ "$READY" != "1" ]]; then
  terminate_unpublished
  fail "preview did not become ready"
fi

if ! node "$RUNTIME_HELPER" publish "$PROJECT_ROOT" \
  "$SERVICE_PID" "$NONCE" "$IDENTITY_FILE" "$LOG_FILE" \
  "$NODE_BIN" "$LAUNCHER" "$CONFIG"; then
  terminate_unpublished
  fail "preview identity verification or state publication failed"
fi

print -- "Chat Analysis is ready at $URL"
if [[ "${CHAT_ANALYSIS_SKIP_BROWSER_OPEN:-0}" != "1" ]]; then
  open "$URL"
fi
