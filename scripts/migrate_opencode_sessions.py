#!/usr/bin/env python3
"""Compatibility wrapper for the OpenCode session migrator."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from personal_devkit.migrate_opencode_sessions import main


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
