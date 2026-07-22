from __future__ import annotations

import difflib
import re
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.extensions import db
from app.models.templates import ItemTemplate


NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _as_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(str(value).replace(",", ".")))
    except (TypeError, ValueError):
        return default


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        text = str(value).replace(",", ".")
        if text in {"---", "-", "Нет"}:
            return default
        return float(text)
    except (TypeError, ValueError):
        return default


def _parse_penetration(value: Any, default: float = 0.0) -> float:
    text = _normalize_text(value)
    if not text or text in {"---", "-", "Нет"}:
        return default
    text = text.replace("%", "").replace(",", ".")
    try:
        return float(text)
    except (TypeError, ValueError):
        return default


def _ammo_variant_label_from_text(text: str) -> Optional[str]:
    lowered = _normalize_text(text).lower()
    if not lowered or lowered in {"нет", "---", "-"}:
        return None

    if "убп" in lowered:
        return "ubp"
    if "rip" in lowered:
        return "rip"
    if "бронеб" in lowered or re.search(r"\bбп\b", lowered):
        return "bp"
    if "экспанс" in lowered or re.search(r"\bэп\b", lowered):
        return "ep"
    if "разрыв" in lowered or "взрыв" in lowered:
        return "explosive"
    if "зажиг" in lowered:
        return "incendiary"
    if "светошум" in lowered:
        return "flashbang"
    if "дым" in lowered:
        return "smoke"
    if "газ" in lowered:
        return "gas"
    return None


def _ammo_variants_from_text(text: Any) -> List[str]:
    normalized = _normalize_text(text)
    if not normalized:
        return []

    lowered = normalized.lower()
    if lowered in {"нет", "---", "-"}:
        return []
    if lowered == "есть":
        return []

    variants: List[str] = []
    for part in re.split(r"[,/;\n]+", normalized):
        variant = _ammo_variant_label_from_text(part)
        if variant and variant not in variants:
            variants.append(variant)
    return variants


def _detect_ammo_variants(row: Dict[str, str]) -> List[str]:
    variants: List[str] = []
    for key in ("P", "S"):
        text = _normalize_text(row.get(key))
        if not text:
            continue
        lowered = text.lower()
        if lowered == "есть":
            if key == "P":
                candidates = ["bp", "ep", "ubp", "rip"]
            else:
                candidates = ["incendiary", "explosive"]
        else:
            candidates = _ammo_variants_from_text(text)
        for variant in candidates:
            if variant not in variants:
                variants.append(variant)
    return variants


def _looks_like_grenade_ammo(row: Dict[str, str]) -> bool:
    searchable = " ".join(_normalize_text(row.get(key)) for key in ("A", "K", "L", "V", "P", "S"))
    lowered = searchable.lower()
    grenade_markers = (
        "гранат",
        "вог",
        "ргд",
        "ф-1",
        "ф1",
        "рго",
        "ргн",
        "ог-",
        "m67",
        "m26",
    )
    return any(marker in lowered for marker in grenade_markers)


def _normalize_equipment_name(value: Any) -> str:
    text = _normalize_text(value).lower()
    text = text.replace("*", "x")
    text = text.replace("х", "x")
    text = text.replace("ё", "е")
    return re.sub(r"\s+", " ", text)


def _parse_shared_strings(archive: zipfile.ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    values: List[str] = []
    for si in root.findall("m:si", NS):
        parts: List[str] = []
        for text_node in si.iterfind(".//m:t", NS):
            parts.append(text_node.text or "")
        values.append("".join(parts))
    return values


def _read_sheet_rows(workbook_path: Path, sheet_name: str) -> List[Dict[str, str]]:
    with zipfile.ZipFile(workbook_path) as archive:
        shared_strings = _parse_shared_strings(archive)
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
        rel_targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}

        target = None
        for sheet in workbook.findall(".//m:sheet", NS):
            if sheet.attrib.get("name") == sheet_name:
                rel_id = sheet.attrib["{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"]
                target = "xl/" + rel_targets[rel_id]
                break
        if not target:
            raise ValueError(f"Sheet '{sheet_name}' was not found in workbook")

        root = ET.fromstring(archive.read(target))
        rows: List[Dict[str, str]] = []
        for row in root.findall(".//m:sheetData/m:row", NS):
            parsed: Dict[str, str] = {}
            for cell in row.findall("m:c", NS):
                ref = cell.attrib.get("r", "")
                column = "".join(ch for ch in ref if ch.isalpha())
                value = ""
                raw_v = cell.find("m:v", NS)
                inline = cell.find("m:is", NS)
                if raw_v is not None and raw_v.text is not None:
                    value = raw_v.text
                    if cell.attrib.get("t") == "s" and value.isdigit():
                        value = shared_strings[int(value)]
                elif inline is not None:
                    parts: List[str] = []
                    for text_node in inline.iterfind(".//m:t", NS):
                        parts.append(text_node.text or "")
                    value = "".join(parts)
                parsed[column] = value
            rows.append(parsed)
        return rows


def _parse_od(text: str) -> Optional[int]:
    match = re.search(r"(\d+)", text or "")
    if not match:
        return None
    return int(match.group(1))


def _parse_name_list(text: str) -> List[str]:
    normalized = _normalize_text(text)
    if not normalized:
        return []
    parts = re.split(r"[,/\n]+", normalized)
    return [part.strip() for part in parts if part.strip()]


def _canonical_caliber(text: str) -> str:
    normalized = _normalize_text(text)
    normalized = normalized.replace("х", "x").replace("*", "x")
    normalized = normalized.replace(" ,", ",").replace("..", ".")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized


def _ammo_damage_from_row(row: Dict[str, str]) -> Optional[float]:
    damage_raw = _normalize_text(row.get("O"))
    if damage_raw in {"", "---", "Нет", "Смотрите другую таблицу"}:
        return None
    return _as_float(damage_raw, 0.0)


def parse_equipment_templates(workbook_path: Path) -> List[Dict[str, Any]]:
    rows = _read_sheet_rows(workbook_path, "Магазины и Патроны")
    templates: List[Dict[str, Any]] = []
    for row in rows:
        name_a = _normalize_text(row.get("A"))
        has_numeric_capacity = bool(re.fullmatch(r"-?\d+(?:[.,]\d+)?", _normalize_text(row.get("B"))))
        if not name_a:
            continue

        # Magazines and loaders are stored on the left side of the sheet.
        if (
            has_numeric_capacity
            and (
                name_a.startswith("Магазин")
                or name_a.startswith("Барабанный Магазин")
                or name_a.startswith("Клипса")
                or name_a.startswith("Пулеметный короб")
            )
        ):
            caliber = _canonical_caliber(row.get("G"))
            compatible_names = _parse_name_list(row.get("H"))
            reload_time = _parse_od(row.get("C"))
            compatible_weapon_names = compatible_names
            is_loader = any(fragment in name_a.lower() for fragment in ("клипса", "короб"))
            templates.append(
                {
                    "name": _canonical_caliber(name_a),
                    "category": "magazine",
                    "subcategory": caliber or None,
                    "item_class": row.get("F") or None,
                    "description": row.get("H") or "",
                    "price": _as_int(row.get("D"), 0),
                    "weight": 0.0,
                    "volume": _as_float(row.get("E"), 0.0),
                    "attributes": {
                        "caliber": caliber,
                        "capacity": _as_int(row.get("B"), 0),
                        "reload_time_od": reload_time,
                        "ergonomics": _as_int(row.get("F"), 0),
                        "compatible_weapon_names": compatible_weapon_names,
                        "compatible_weapons": [],
                        "isLoader": is_loader,
                        "raw_row": row,
                    },
                    "compatible_ids": [],
                }
            )

        # Ammo items are listed on the right side of the same sheet.
        name_l = _normalize_text(row.get("L"))
        has_numeric_price = bool(re.fullmatch(r"-?\d+(?:[.,]\d+)?", _normalize_text(row.get("M"))))
        if not name_l or not has_numeric_price:
            continue
        if _looks_like_grenade_ammo(row):
            continue

        damage = _ammo_damage_from_row(row)
        caliber = _canonical_caliber(name_l)
        ammo_group = _normalize_text(row.get("K"))
        effective_range = _as_int(row.get("U"), 0)
        penetration = _parse_penetration(row.get("Q"), 0.0)
        boundary = _as_float(row.get("R"), 0.0)
        purchase_category = _normalize_text(row.get("N"))
        ammo_variants = _detect_ammo_variants(row)
        price = _as_int(row.get("M"), 0)

        attributes = {
            "caliber": caliber,
            "ammo_group": ammo_group,
            "purchase_category": purchase_category,
            "penetration_boundary": boundary,
            "activation_time": _normalize_text(row.get("T")),
            "effective_range": effective_range,
            "notes": _normalize_text(row.get("V")),
            "ammo_variants": ammo_variants,
            "ammo_variant": ammo_variants[0] if len(ammo_variants) == 1 else None,
            "raw_row": row,
        }

        templates.append(
            {
                "name": _canonical_caliber(name_l),
                "category": "ammo",
                "subcategory": caliber or ammo_group or None,
                "item_class": purchase_category or None,
                "description": _normalize_text(row.get("V")),
                "price": price,
                "weight": 0.25 if caliber else 0.0,
                "volume": 0.04 if caliber and "12x70" in caliber else 0.02,
                "attributes": {
                    **attributes,
                    "damage": damage,
                    "penetration": penetration,
                    "range": effective_range,
                },
                "compatible_ids": [],
            }
        )

    return templates


def upsert_equipment_templates(workbook_path: str | Path, session=None) -> Dict[str, int]:
    path = Path(workbook_path).expanduser().resolve()
    templates = parse_equipment_templates(path)
    session = session or db.session

    header_names = {_normalize_equipment_name(name) for name in {"Магазины", "Магазин Калибр"}}
    removed_headers = 0
    for item in ItemTemplate.query.filter_by(category="magazine").all():
        if _normalize_equipment_name(item.name) in header_names:
            session.delete(item)
            removed_headers += 1

    weapon_map: Dict[str, int] = {}
    for weapon in ItemTemplate.query.filter_by(category="weapon").all():
        weapon_map[_normalize_equipment_name(weapon.name)] = weapon.id

    removed_grenades = 0
    for item in ItemTemplate.query.filter_by(category="ammo").all():
        if _looks_like_grenade_ammo({"A": item.name, "K": item.subcategory or "", "L": item.name, "V": item.description or "", "P": "", "S": ""}):
            session.delete(item)
            removed_grenades += 1

    existing_by_category: Dict[str, List[ItemTemplate]] = {}
    for item in ItemTemplate.query.filter(ItemTemplate.category.in_(["ammo", "magazine"])).all():
        existing_by_category.setdefault(item.category, []).append(item)

    inserted = 0
    updated = 0
    used_ids: set[int] = set()
    for data in templates:
        category = data["category"]
        normalized_name = _normalize_equipment_name(data["name"])
        candidates = existing_by_category.get(category, [])
        item = None
        best_score = 0.0
        for candidate in candidates:
            if candidate.id in used_ids:
                continue
            candidate_name = _normalize_equipment_name(candidate.name)
            if candidate_name == normalized_name:
                item = candidate
                break
            score = difflib.SequenceMatcher(None, candidate_name, normalized_name, autojunk=False).ratio()
            if score > best_score:
                best_score = score
                item = candidate
        if item is not None and _normalize_equipment_name(item.name) != normalized_name and best_score < 0.72:
            item = None

        if category == "magazine":
            compatible_ids: List[int] = []
            for weapon_name in data["attributes"].get("compatible_weapon_names", []):
                weapon_id = weapon_map.get(_normalize_equipment_name(weapon_name))
                if weapon_id and weapon_id not in compatible_ids:
                    compatible_ids.append(weapon_id)
            data["attributes"]["compatible_weapons"] = compatible_ids
            data["compatible_ids"] = compatible_ids

        if item is None:
            session.add(ItemTemplate(**data))
            inserted += 1
            continue

        used_ids.add(item.id)
        changed = False
        for field in ["name", "subcategory", "item_class", "description", "price", "weight", "volume"]:
            value = data[field]
            if getattr(item, field) != value:
                setattr(item, field, value)
                changed = True
        if item.attributes != data["attributes"]:
            item.attributes = data["attributes"]
            changed = True
        if item.compatible_ids != data["compatible_ids"]:
            item.compatible_ids = data["compatible_ids"]
            changed = True
        if changed:
            updated += 1

    session.commit()
    return {
        "parsed": len(templates),
        "inserted": inserted,
        "updated": updated + removed_headers + removed_grenades,
    }
