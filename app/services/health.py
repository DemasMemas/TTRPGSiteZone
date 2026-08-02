from typing import Any, Dict


BASE_HEALTH_MAXIMUMS = {
    "current": 700,
    "zones": {
        "head": 50,
        "chest": 150,
        "abdomen": 120,
        "leftArm": 90,
        "rightArm": 90,
        "leftLeg": 100,
        "rightLeg": 100,
    },
}
BASE_ORGAN_MAXIMUMS = {
    "heart": 20,
    "rightLung": 40,
    "leftLung": 40,
    "rightKidney": 25,
    "leftKidney": 25,
    "stomach": 25,
    "liver": 20,
    "rightEye": 15,
    "leftEye": 15,
    "nose": 20,
    "jaw": 20,
    "rightEar": 20,
    "leftEar": 20,
    "brain": 1,
    "spine": 1,
}
NORMAL_BODY_TEMPERATURE = 36.0


def has_mountain_background(character_data: Dict[str, Any]) -> bool:
    background = ((character_data or {}).get("basic") or {}).get("background") or {}
    name = str(background.get("name") or "").strip().lower()
    pluses = str(background.get("pluses") or "").strip().lower()
    return name == "\u0433\u043e\u0440\u0430" or (
        "\u043e\u0431\u0449\u0435\u0435 \u0437\u0434\u043e\u0440\u043e\u0432\u044c\u0435 "
        "\u0443\u0432\u0435\u043b\u0438\u0447\u0435\u043d\u043e \u043d\u0430 20%" in pluses
        and "\u0437\u0434\u043e\u0440\u043e\u0432\u044c\u0435 \u0440\u0443\u043a "
        "\u0438 \u043d\u043e\u0433 \u0443\u0432\u0435\u043b\u0438\u0447\u0435\u043d\u043e "
        "\u043d\u0430 35" in pluses
    )


def get_health_maximums(character_data: Dict[str, Any]) -> Dict[str, Any]:
    mountain = has_mountain_background(character_data)
    zones = dict(BASE_HEALTH_MAXIMUMS["zones"])
    if mountain:
        for key in ("leftArm", "rightArm", "leftLeg", "rightLeg"):
            zones[key] += 35
    return {
        "profile": "mountain" if mountain else "base",
        "current": 840 if mountain else BASE_HEALTH_MAXIMUMS["current"],
        "zones": zones,
    }


def apply_health_maximums(character_data: Dict[str, Any], force: bool = False) -> Dict[str, Any]:
    health = character_data.setdefault("health", {})
    temperature = _number(health.get("temperature"))
    if temperature is None or temperature <= 0:
        health["temperature"] = NORMAL_BODY_TEMPERATURE
    profile = get_health_maximums(character_data)
    profile_changed = health.get("maximumProfile") != profile["profile"]

    old_max = _number(health.get("max"))
    if force or profile_changed or old_max != profile["current"]:
        health["current"] = _scaled_current(health.get("current"), old_max, profile["current"])
        health["max"] = profile["current"]

    zones = health.setdefault("zones", {})
    for key, new_max in profile["zones"].items():
        zone = zones.setdefault(key, {})
        old_zone_max = _number(zone.get("max"))
        if force or profile_changed or old_zone_max != new_max:
            zone["current"] = _scaled_current(zone.get("current"), old_zone_max, new_max)
            zone["max"] = new_max

    organs = health.setdefault("organs", {})
    for key, new_max in BASE_ORGAN_MAXIMUMS.items():
        organ = organs.setdefault(key, {})
        old_organ_max = _number(organ.get("max"))
        if force or old_organ_max is None or old_organ_max <= 0:
            organ["current"] = _scaled_current(
                organ.get("current"), old_organ_max, new_max
            )
            organ["max"] = new_max

    health["maximumProfile"] = profile["profile"]
    return health


def health_zones_to_location(health: Dict[str, Any]) -> Dict[str, Any]:
    zones = (health or {}).get("zones") or {}
    mapping = {
        "head": "head",
        "chest": "chest",
        "abdomen": "abdomen",
        "leftArm": "left_arm",
        "rightArm": "right_arm",
        "leftLeg": "left_leg",
        "rightLeg": "right_leg",
    }
    return {
        location_key: dict(zones.get(character_key) or {})
        for character_key, location_key in mapping.items()
    }


def _number(value: Any):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _scaled_current(current: Any, old_max: Any, new_max: float) -> float:
    current_value = _number(current)
    old_max_value = _number(old_max)
    if current_value is None:
        return new_max
    if old_max_value is None or old_max_value <= 0:
        return min(new_max, max(0, current_value))
    ratio = max(0.0, min(1.0, current_value / old_max_value))
    return new_max * ratio
