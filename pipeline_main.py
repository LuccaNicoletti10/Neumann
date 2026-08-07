#!/usr/bin/env python3
"""Entry point for the data pipeline system (US10853338)."""

from __future__ import annotations

import sys

from data_pipeline.cli import main


if __name__ == "__main__":
    sys.exit(main())
