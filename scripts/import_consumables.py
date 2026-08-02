from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app import create_app
from app.services.consumable_importer import upsert_consumable_templates


def _find_default_workbook() -> Path | None:
    downloads = Path.home() / "Downloads"
    if not downloads.exists():
        return None
    candidates = sorted(
        [path for path in downloads.glob("*.xlsx") if "Снаряжение" in path.name],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def main() -> int:
    workbook_arg = Path(sys.argv[1]).expanduser() if len(sys.argv) > 1 else _find_default_workbook()
    if workbook_arg is None or not workbook_arg.exists():
        print("Workbook path is missing. Pass an .xlsx file path as the first argument.")
        return 1

    app = create_app()
    with app.app_context():
        result = upsert_consumable_templates(workbook_arg)
        print(
            f"Imported consumables from {workbook_arg}: "
            f"parsed={result['parsed']} inserted={result['inserted']} updated={result['updated']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

