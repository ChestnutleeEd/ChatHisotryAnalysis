"""Readiness-only local CLI using the production composition root."""

from __future__ import annotations

import argparse
import json
import sys
from typing import Callable, Sequence

from .application import run_startup_check
from .errors import STARTUP_PHASE, StartupError, StartupReasonCode


class _ContentFreeArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        """Reject invalid readiness invocations without echoing user input."""

        self.print_usage(sys.stderr)
        raise SystemExit(2)


def _parser() -> argparse.ArgumentParser:
    parser = _ContentFreeArgumentParser(prog="chat-history-analysis")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser(
        "startup-check",
        help="verify the approved local preprocessing runtime",
    )
    return parser


def _run_for_test(
    argv: Sequence[str] | None,
    application_runner: Callable[[], None],
) -> int:
    """Private dependency-injection seam; production main never accepts it."""

    arguments = _parser().parse_args(argv)
    if arguments.command != "startup-check":
        return 2

    try:
        application_runner()
    except StartupError as error:
        print(json.dumps(error.public_payload(), sort_keys=True), file=sys.stderr)
        return 2
    except Exception:
        error = StartupError(StartupReasonCode.IJSON_PARSER_INITIALIZATION_FAILED)
        print(json.dumps(error.public_payload(), sort_keys=True), file=sys.stderr)
        return 2

    print(json.dumps({"phase": STARTUP_PHASE, "status": "ready"}, sort_keys=True))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Run the non-injectable production readiness command."""

    return _run_for_test(argv, run_startup_check)
