from __future__ import annotations

import sys
from pathlib import Path

from app import create_app
from app.services.equipment_importer import upsert_equipment_templates


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
        result = upsert_equipment_templates(workbook_arg)
        print(
            f"Imported equipment from {workbook_arg}: "
            f"parsed={result['parsed']} inserted={result['inserted']} updated={result['updated']}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
