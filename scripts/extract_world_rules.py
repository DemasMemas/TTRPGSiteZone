"""Build the checked-in world rule catalog from the design workbook."""

from __future__ import annotations

import json
import re
import sys
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from xml.etree import ElementTree as ET


MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
OFFICE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"m": MAIN}


def _clean(value):
    return " ".join(str(value or "").replace("\r", " ").replace("\n", " ").split())


class Workbook:
    def __init__(self, path):
        self.archive = zipfile.ZipFile(path)
        self.shared = []
        if "xl/sharedStrings.xml" in self.archive.namelist():
            root = ET.fromstring(self.archive.read("xl/sharedStrings.xml"))
            self.shared = [
                "".join(node.text or "" for node in item.iter(f"{{{MAIN}}}t"))
                for item in root.findall(f"{{{MAIN}}}si")
            ]
        relationships = ET.fromstring(
            self.archive.read("xl/_rels/workbook.xml.rels")
        )
        self.targets = {
            item.attrib["Id"]: item.attrib["Target"]
            for item in relationships.findall(f"{{{PACKAGE_REL}}}Relationship")
        }
        self.workbook = ET.fromstring(self.archive.read("xl/workbook.xml"))

    def rows(self, sheet_name):
        sheet = next(
            item for item in self.workbook.find("m:sheets", NS)
            if item.attrib["name"] == sheet_name
        )
        target = self.targets[sheet.attrib[f"{{{OFFICE_REL}}}id"]].lstrip("/")
        if not target.startswith("xl/"):
            target = f"xl/{target}"
        root = ET.fromstring(self.archive.read(target))
        output = []
        for row in root.findall(".//m:sheetData/m:row", NS):
            values = {}
            for cell in row.findall("m:c", NS):
                column = re.match(r"[A-Z]+", cell.attrib.get("r", "")).group(0)
                raw = cell.find("m:v", NS)
                inline = cell.find("m:is", NS)
                cell_type = cell.attrib.get("t")
                value = ""
                if cell_type == "s" and raw is not None:
                    value = self.shared[int(raw.text)]
                elif cell_type == "inlineStr" and inline is not None:
                    value = "".join(
                        node.text or "" for node in inline.iter(f"{{{MAIN}}}t")
                    )
                elif raw is not None:
                    value = raw.text or ""
                value = _clean(value)
                if value:
                    values[column] = value
            if values:
                output.append((int(row.attrib["r"]), values))
        return output


def _number(value, default=0):
    try:
        numeric = float(str(value).replace(",", "."))
        return int(numeric) if numeric.is_integer() else numeric
    except (TypeError, ValueError):
        return default


def _field_rank(value):
    numeric = _number(value)
    if numeric <= 4:
        return [int(numeric), int(numeric)]
    date = datetime(1899, 12, 30) + timedelta(days=numeric)
    return [date.day, date.month]


def extract_anomalies(rows):
    output = []
    for index, (row_number, values) in enumerate(rows):
        if "Ранг аномалии" not in values.get("B", ""):
            continue
        details = []
        for _, following in rows[index + 1:]:
            if "Ранг аномалии" in following.get("B", ""):
                break
            if following.get("A"):
                details.append(following["A"])
        mechanic = next(
            (item for item in details if "СЛ Спасения" in item), ""
        )
        output.append({
            "name": values["A"],
            "rank": _number(values["B"].rsplit("-", 1)[-1].strip()),
            "habitat": values.get("C", ""),
            "mechanic": mechanic,
            "description": " ".join(item for item in details if item != mechanic),
            "source_order": len(output),
        })
    return output


def extract_artifacts(rows):
    class_map = {
        'Артефакты "Мусорного класса"': "trash",
        "Артефакты 1 класса": "1",
        "Артефакты 2 класса": "2",
        "Артефакты 3 класса": "3",
        "Артефакты Х класса": "x",
    }
    artifact_class = None
    output = []
    for row_number, values in rows:
        title = values.get("A", "")
        if title in class_map:
            artifact_class = class_map[title]
            continue
        if artifact_class is None or not all(
            column in values for column in ("A", "B", "C", "D", "E", "F")
        ):
            continue
        output.append({
            "name": title,
            "artifact_class": artifact_class,
            "anomaly_type": values["B"].replace("Гравитационнные", "Гравитационные"),
            "positive_effect": values["C"],
            "negative_effect": values["D"],
            "special_property": values["E"],
            "price": _number(values["F"]),
            "appearance": values.get("G", ""),
            "weight": 2,
            "source_order": len(output),
        })
    return output


def extract_fields(rows):
    output = []
    for row_number, values in rows:
        if row_number < 4 or row_number > 27 or not values.get("A"):
            continue
        rank_min, rank_max = _field_rank(values.get("C"))
        output.append({
            "name": values["A"],
            "field_type": values.get("B", ""),
            "rank_min": rank_min,
            "rank_max": rank_max,
            "hazard": values.get("D", ""),
            "description": values.get("E", ""),
            "source_order": len(output),
        })
    return output


def extract_mutants(rows):
    starts = [index for index, (_, values) in enumerate(rows) if values.get("B") == "Конечности"]
    output = []
    for position, start in enumerate(starts):
        end = starts[position + 1] if position + 1 < len(starts) else len(rows)
        block = rows[start:end]
        _, header = block[0]
        mutant = {
            "name": header["A"],
            "zones": {},
            "skills": {},
            "attacks": [],
            "traits": [],
            "variants": [],
            "source_order": len(output),
        }
        section = None
        current_variant = None
        for row_number, values in block[1:]:
            first = values.get("A", "")
            if first.startswith("Хп -"):
                mutant["health"] = _number(first.split("-", 1)[1])
                mutant["zones"] = {
                    "limbs": values.get("B"), "chest": values.get("C"),
                    "abdomen": values.get("D"), "head": values.get("E"),
                }
                continue
            if first.startswith("Защиты."):
                numbers = re.findall(r"(-?\d+)%", first)
                mutant["physical_protection"] = _number(numbers[0]) if numbers else 0
                mutant["anomaly_protection"] = _number(numbers[1]) if len(numbers) > 1 else 0
                mutant["movement"] = _number(values.get("G"))
                continue
            for skill, column in (
                ("agility", "G"), ("melee", "I"), ("tactics", "K"),
                ("strength", "G"), ("will", "I"), ("range", "K"),
                ("stealth", "G"), ("attention", "I"), ("shooting", "K"),
            ):
                labels = {"G": values.get("F"), "I": values.get("H"), "K": values.get("J")}
                expected = {
                    "agility": "Ловкость", "melee": "Ближний бой", "tactics": "Тактика",
                    "strength": "Сила", "will": "Воля", "range": "Дальность атаки",
                    "stealth": "Скрытность", "attention": "Внимательность", "shooting": "Стрельба",
                }
                if labels[column] == expected[skill]:
                    mutant["skills"][skill] = _number(values.get(column), values.get(column))
            if first in {"Атаки", "Атаки попадают автоматически на любой дистанции при прямой видимости"}:
                section = "attacks"
                mutant["automatic_attacks"] = first.startswith("Атаки попадают")
                continue
            if first == "Особенности":
                section = "traits"
                continue
            if first.startswith("Вариация - "):
                current_variant = {"name": first.split(".", 1)[0].replace("Вариация - ", ""), "traits": []}
                mutant["variants"].append(current_variant)
                section = "variant"
                continue
            if section == "attacks" and values.get("B") and first != "---":
                mutant["attacks"].append({
                    "name": first, "effect": values["B"], "attack_type": values.get("E", ""),
                })
            elif section == "traits" and first:
                mutant["traits"].append(first)
            elif section == "variant" and first and current_variant:
                current_variant["traits"].append(first)
        output.append(mutant)
    return output


def main():
    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    workbook = Workbook(source)
    payload = {
        "source": source.name,
        "anomalies": extract_anomalies(workbook.rows("Аномалии")),
        "artifacts": extract_artifacts(workbook.rows("Артефакты")),
        "anomaly_fields": extract_fields(workbook.rows("Аномальные поля")),
        "mutants": extract_mutants(workbook.rows("Бестиарий")),
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8",
    )
    print({key: len(value) for key, value in payload.items() if isinstance(value, list)})


if __name__ == "__main__":
    main()
