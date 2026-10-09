from copy import deepcopy
import json
from pathlib import Path

import pytest

from app.extensions import db
from app.models.templates import ItemTemplate
from app.services.consumable_importer import parse_consumable_templates_v2
from app.services.custom_consumable_profile import validate_custom_consumable


def test_every_available_catalog_profile_can_be_cloned_into_advanced_editor(client):
    workbook = Path.home() / "Downloads" / "Снаряжение (1).xlsx"
    if not workbook.exists():
        pytest.skip("Local equipment workbook is not available")
    templates = parse_consumable_templates_v2(workbook)
    for data in templates:
        db.session.add(ItemTemplate(**data))
    db.session.flush()
    for data in templates:
        profile = json.loads(json.dumps(deepcopy(data["attributes"]["consumable"])))
        profile["editor_version"] = 2
        profile["effects"] = [
            effect for effect in profile["effects"]
            if effect.get("source") != "direct"
        ]
        validate_custom_consumable("consumable", {
            "uses": data["attributes"].get("uses") or 1,
            "consumable": profile,
        })
