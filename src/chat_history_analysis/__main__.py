"""Run the old-runtime-safe local readiness bootstrap."""

from .bootstrap_cli import main


if __name__ == "__main__":
    raise SystemExit(main())
