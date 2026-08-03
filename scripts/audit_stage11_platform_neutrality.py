"""Audit shared contracts and analytics for macOS-only coupling.

The native package adapter is allowed to mention macOS. Shared schema,
canonical-event, Worker, and analytics modules are not.
"""

from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
SHARED_FILES = (
    ROOT / "frontend" / "src" / "canonical-v2" / "schema.ts",
    ROOT / "frontend" / "src" / "desktop" / "ipc-contract.ts",
    ROOT / "frontend" / "src" / "normalized" / "schema.ts",
    ROOT / "frontend" / "src" / "worker-analysis",
    ROOT / "src" / "chat_history_analysis" / "canonical_event_v2.py",
    ROOT / "src" / "chat_history_analysis" / "message_normalization.py",
)
FORBIDDEN_TOKENS = (
    "AppKit",
    "WKWebView",
    "Contents/Resources",
    "killpg",
    "SIGINT",
    "SIGTERM",
    "SIGKILL",
    "/Applications",
    ".dmg",
)


def _files(root: Path):
    if root.is_file():
        yield root
        return
    yield from sorted(path for path in root.rglob("*") if path.is_file())


def audit() -> list[str]:
    failures: list[str] = []
    for root in SHARED_FILES:
        for path in _files(root):
            text = path.read_text(encoding="utf-8")
            for token in FORBIDDEN_TOKENS:
                if token in text:
                    failures.append(f"{path.relative_to(ROOT)}:{token}")
    return failures


def main() -> int:
    failures = audit()
    if failures:
        print("PLATFORM_NEUTRALITY_FAILED", file=sys.stderr)
        for failure in failures:
            print(failure, file=sys.stderr)
        return 2
    print("platform-neutrality=passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
