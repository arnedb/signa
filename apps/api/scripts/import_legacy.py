"""Import the old vgt app's lexicon.db and videos.

Usage: uv run python scripts/import_legacy.py lexicon.db videos/ [--dry-run] [--report report.md]
(the same as ``vgt import-legacy``)
"""

import sys

from vgt.cli import main

if __name__ == "__main__":
    main(["import-legacy", *sys.argv[1:]])
