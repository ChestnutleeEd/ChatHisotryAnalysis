#!/bin/zsh

set -eu
umask 077

fail() {
  print -u2 -- "Chat Analysis stop refused: $1"
  exit 1
}

command -v node >/dev/null 2>&1 || fail "Node.js is required"

SCRIPT_PATH="$(node -e '
  const { realpathSync } = require("node:fs");
  process.stdout.write(realpathSync(process.argv[1]));
' "$0")" || fail "cannot resolve the command location"
PROJECT_ROOT="$(dirname -- "$SCRIPT_PATH")"
PROJECT_ROOT="$(CDPATH= cd -- "$PROJECT_ROOT" && pwd -P)"
RUNTIME_HELPER="$PROJECT_ROOT/frontend/scripts/launch-runtime.mjs"

[[ -f "$RUNTIME_HELPER" && ! -L "$RUNTIME_HELPER" ]] ||
  fail "project runtime helper is missing or unsafe"

STATE_PID=""
if STATE_PID="$(node "$RUNTIME_HELPER" pid "$PROJECT_ROOT" 2>/dev/null)"; then
  :
else
  STATE_STATUS="$?"
  if [[ "$STATE_STATUS" == "3" ]]; then
    print -- "Chat Analysis is not running"
    exit 0
  fi
  fail "local runtime state is unsafe or incomplete; no process was signalled"
fi

if ! kill -0 "$STATE_PID" 2>/dev/null; then
  node "$RUNTIME_HELPER" cleanup-stale "$PROJECT_ROOT" >/dev/null ||
    fail "stale state could not be safely cleaned"
  print -- "Removed stale Chat Analysis state; no process was signalled"
  exit 0
fi

VERIFIED_PID="$(node "$RUNTIME_HELPER" verify "$PROJECT_ROOT")" ||
  fail "PID identity verification failed; no process was signalled"
[[ "$VERIFIED_PID" == "$STATE_PID" ]] ||
  fail "PID identity changed; no process was signalled"

# Revalidate the complete identity immediately before TERM.
VERIFIED_PID="$(node "$RUNTIME_HELPER" verify "$PROJECT_ROOT")" ||
  fail "PID identity changed before TERM; no process was signalled"
[[ "$VERIFIED_PID" == "$STATE_PID" ]] ||
  fail "PID identity changed before TERM; no process was signalled"
kill -TERM "$STATE_PID"

for _ in {1..50}; do
  if ! kill -0 "$STATE_PID" 2>/dev/null; then
    node "$RUNTIME_HELPER" cleanup "$PROJECT_ROOT" >/dev/null ||
      fail "preview stopped but runtime cleanup was refused"
    print -- "Chat Analysis stopped"
    exit 0
  fi
  sleep 0.1
done

# Revalidate every factor again before the bounded KILL follow-up.
VERIFIED_PID="$(node "$RUNTIME_HELPER" verify "$PROJECT_ROOT")" ||
  fail "PID identity changed after TERM; refusing KILL"
[[ "$VERIFIED_PID" == "$STATE_PID" ]] ||
  fail "PID identity changed after TERM; refusing KILL"
kill -KILL "$STATE_PID"

for _ in {1..20}; do
  if ! kill -0 "$STATE_PID" 2>/dev/null; then
    node "$RUNTIME_HELPER" cleanup "$PROJECT_ROOT" >/dev/null ||
      fail "preview stopped but runtime cleanup was refused"
    print -- "Chat Analysis stopped after bounded follow-up"
    exit 0
  fi
  sleep 0.1
done

fail "verified PID did not exit; state preserved"
