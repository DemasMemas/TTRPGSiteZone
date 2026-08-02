from app.services.health import BASE_ORGAN_MAXIMUMS, apply_health_maximums, get_health_maximums


def test_base_health_profile_uses_rules_values():
    profile = get_health_maximums({})

    assert profile["current"] == 700
    assert profile["zones"] == {
        "head": 50,
        "chest": 150,
        "abdomen": 120,
        "leftArm": 90,
        "rightArm": 90,
        "leftLeg": 100,
        "rightLeg": 100,
    }


def test_mountain_background_changes_only_declared_maximums():
    data = {"basic": {"background": {"name": "\u0413\u043e\u0440\u0430"}}}

    profile = get_health_maximums(data)

    assert profile["current"] == 840
    assert profile["zones"]["leftArm"] == 125
    assert profile["zones"]["rightArm"] == 125
    assert profile["zones"]["leftLeg"] == 135
    assert profile["zones"]["rightLeg"] == 135
    assert profile["zones"]["head"] == 50
    assert profile["zones"]["chest"] == 150
    assert profile["zones"]["abdomen"] == 120


def test_profile_change_preserves_damage_ratio():
    data = {
        "basic": {"background": {"name": "\u0413\u043e\u0440\u0430"}},
        "health": {
            "current": 350,
            "max": 700,
            "maximumProfile": "base",
            "zones": {
                "leftArm": {"current": 45, "max": 90},
                "leftLeg": {"current": 50, "max": 100},
            },
        },
    }

    health = apply_health_maximums(data)

    assert health["current"] == 420
    assert health["zones"]["leftArm"] == {"current": 62.5, "max": 125}
    assert health["zones"]["leftLeg"] == {"current": 67.5, "max": 135}


def test_missing_health_starts_full():
    health = apply_health_maximums({})

    assert health["current"] == 700
    assert health["temperature"] == 36
    assert health["zones"]["head"] == {"current": 50, "max": 50}
    assert health["zones"]["chest"] == {"current": 150, "max": 150}
    assert health["organs"]["heart"] == {"current": 20, "max": 20}
    assert health["organs"]["brain"] == {"current": 1, "max": 1}
    assert set(health["organs"]) == set(BASE_ORGAN_MAXIMUMS)


def test_invalid_zero_temperature_is_repaired():
    health = apply_health_maximums({"health": {"temperature": 0}})

    assert health["temperature"] == 36


def test_legacy_zone_maximums_are_repaired_even_with_profile_marker():
    data = {
        "health": {
            "current": 700,
            "max": 700,
            "maximumProfile": "base",
            "zones": {"chest": {"current": 50, "max": 100}},
        },
    }

    health = apply_health_maximums(data)

    assert health["zones"]["chest"] == {"current": 75, "max": 150}
