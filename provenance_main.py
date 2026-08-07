#!/usr/bin/env python3
"""Entry point for the provenance system (US9996595)."""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Neumann Provenance System")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("gui", help="Launch provenance visualization GUI")
    sub.add_parser("demo", help="Run CLI demo provenance graph")

    # Pass-through remaining args to provenance CLI for advanced commands.
    known, rest = parser.parse_known_args(argv)

    if known.command == "gui":
        from provenance_system.gui_provenance import main as gui_main

        gui_main()
        return 0

    if known.command == "demo":
        from provenance_system.cli import main as cli_main

        return cli_main(["demo"])

    return 1


if __name__ == "__main__":
    # Support: python provenance_main.py <cli-command> ...
    if len(sys.argv) > 1 and sys.argv[1] not in {"gui", "demo", "-h", "--help"}:
        from provenance_system.cli import main as cli_main

        sys.exit(cli_main(sys.argv[1:]))
    sys.exit(main())
