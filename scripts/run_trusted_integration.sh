#!/bin/sh
set -eu

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
scratch=$(mktemp -d "${TMPDIR:-/tmp}/chat-history-analysis-integration.XXXXXX")
image="$scratch/environment.dmg"
mount="$scratch/mount"
attached=0

cleanup() {
    if [ "$attached" -eq 1 ]; then
        hdiutil detach "$mount" >/dev/null
        attached=0
    fi
    if [ -f "$image" ]; then
        rm "$image"
    fi
    if [ -d "$mount" ]; then
        rmdir "$mount"
    fi
    rmdir "$scratch"
}
trap cleanup EXIT HUP INT TERM

hdiutil create \
    -quiet \
    -size 768m \
    -fs APFS \
    -volname CHAStage1A \
    "$image"
mkdir "$mount"
hdiutil attach -quiet -nobrowse -mountpoint "$mount" "$image"
attached=1
mkdir "$mount/workspace"

cd "$repository"
CHA_RUN_TRUSTED_INTEGRATION=1 \
CHA_TRUSTED_INTEGRATION_ROOT="$mount/workspace" \
TMPDIR="$mount" \
PYTHONDONTWRITEBYTECODE=1 \
PYTHONPATH=src \
python3.12 -m unittest discover -s tests -v
