from app.services.equipment_importer import _equipment_alias


def test_compact_submachine_gun_alias_matches_spaced_weapon_name():
    assert _equipment_alias("ППСП5") == _equipment_alias("ПП СП5")
    assert _equipment_alias("ППСП10") == _equipment_alias("ПП СП10")
