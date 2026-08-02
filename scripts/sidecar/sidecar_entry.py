"""Production PyInstaller entrypoint for the supervised preprocessing sidecar."""

from __future__ import annotations

import sys
from typing import Sequence


def main(argv: Sequence[str] | None = None) -> int:
    supplied = tuple(sys.argv[1:] if argv is None else argv)
    if supplied == ("sidecar",):
        from chat_history_analysis.cli import main as cli_main

        return cli_main(supplied)

    # Build probes are synthetic-only and never accept a user-supplied path.
    from frozen_probe import main as probe_main

    return probe_main(supplied)


if __name__ == "__main__":
    raise SystemExit(main())
