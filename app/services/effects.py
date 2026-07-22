from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, Iterable, List, Optional

EFFECT_TYPE_META = {
    "generic": {"label": "Общий", "group": "status"},
    "heal": {"label": "Лечение", "group": "medical"},
    "regeneration": {"label": "Регенерация", "group": "medical"},
    "radiation": {"label": "Радиация", "group": "medical"},
    "bleeding": {"label": "Кровотечение", "group": "injury"},
    "bleeding_external_light": {"label": "Кровотечение внешнее лёгкое", "group": "injury"},
    "bleeding_external_medium": {"label": "Кровотечение внешнее среднее", "group": "injury"},
    "bleeding_external_severe": {"label": "Кровотечение внешнее сильное", "group": "injury"},
    "bleeding_external_extreme": {"label": "Кровотечение внешнее экстремальное", "group": "injury"},
    "bleeding_internal_light": {"label": "Кровотечение внутреннее лёгкое", "group": "injury"},
    "bleeding_internal_medium": {"label": "Кровотечение внутреннее среднее", "group": "injury"},
    "bleeding_internal_severe": {"label": "Кровотечение внутреннее сильное", "group": "injury"},
    "bleeding_internal_extreme": {"label": "Кровотечение внутреннее экстремальное", "group": "injury"},
    "pain": {"label": "Боль", "group": "injury"},
    "exhaustion": {"label": "Истощение", "group": "need"},
    "stress": {"label": "Стресс", "group": "mental"},
    "intoxication": {"label": "Опьянение", "group": "need"},
    "infection": {"label": "Заражение", "group": "disease"},
    "fracture": {"label": "Перелом", "group": "injury"},
    "shock": {"label": "Шок", "group": "injury"},
    "unconsciousness": {"label": "Без сознания", "group": "critical"},
    "blindness": {"label": "Слепота", "group": "sense"},
    "deafness": {"label": "Глухота", "group": "sense"},
    "sleep": {"label": "Сон", "group": "critical"},
}

TYPE_ALIASES = {
    "heal": "heal",
    "healing": "heal",
    "лечение": "heal",
    "radiation": "radiation",
    "radiaton": "radiation",
    "radiation_reduction": "radiation",
    "bleed": "bleeding",
    "bleeding": "bleeding",
    "кровотечение": "bleeding",
    "external_bleeding": "bleeding_external_light",
    "internal_bleeding": "bleeding_internal_light",
    "bleeding_external_light": "bleeding_external_light",
    "bleeding_external_medium": "bleeding_external_medium",
    "bleeding_external_severe": "bleeding_external_severe",
    "bleeding_external_extreme": "bleeding_external_extreme",
    "bleeding_internal_light": "bleeding_internal_light",
    "bleeding_internal_medium": "bleeding_internal_medium",
    "bleeding_internal_severe": "bleeding_internal_severe",
    "bleeding_internal_extreme": "bleeding_internal_extreme",
    "pain": "pain",
    "боль": "pain",
    "exhaustion": "exhaustion",
    "истощение": "exhaustion",
    "stress": "stress",
    "стресс": "stress",
    "intoxication": "intoxication",
    "опьянение": "intoxication",
    "infection": "infection",
    "заражение": "infection",
    "fracture": "fracture",
    "перелом": "fracture",
    "shock": "shock",
    "шок": "shock",
    "unconsciousness": "unconsciousness",
    "unconscious": "unconsciousness",
    "без сознания": "unconsciousness",
    "blindness": "blindness",
    "blind": "blindness",
    "слепота": "blindness",
    "deafness": "deafness",
    "deaf": "deafness",
    "глухота": "deafness",
    "sleep": "sleep",
    "сон": "sleep",
    "regeneration": "regeneration",
    "regen": "regeneration",
    "регенерация": "regeneration",
    "amputation": "amputation",
    "ампутация": "amputation",
    "organloss": "organ_loss",
    "organ_loss": "organ_loss",
    "потеряоргана": "organ_loss",
    "потеря_органа": "organ_loss",
}

STATUS_EFFECT_TYPES = {
    "bleeding", "pain", "exhaustion", "stress", "intoxication",
    "infection", "fracture", "shock", "unconsciousness", "blindness", "deafness",
    "sleep",
    "amputation", "organ_loss",
    "bleeding_external_light", "bleeding_external_medium", "bleeding_external_severe", "bleeding_external_extreme",
    "bleeding_internal_light", "bleeding_internal_medium", "bleeding_internal_severe", "bleeding_internal_extreme",
}

EFFECT_IMPACT_RULES = {
    "generic": {"areas": [], "requiresMedicineCheck": False, "treatment": "manual"},
    "heal": {"areas": ["whole_body"], "requiresMedicineCheck": False, "treatment": "oral_or_medical"},
    "regeneration": {"areas": ["whole_body"], "requiresMedicineCheck": False, "treatment": "medical"},
    "radiation": {"areas": ["whole_body"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding": {"areas": ["wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding_external_light": {"areas": ["wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding_external_medium": {"areas": ["wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding_external_severe": {"areas": ["wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding_external_extreme": {"areas": ["wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding_internal_light": {"areas": ["internal", "wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding_internal_medium": {"areas": ["internal", "wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding_internal_severe": {"areas": ["internal", "wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding_internal_extreme": {"areas": ["internal", "wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "pain": {"areas": ["whole_body"], "requiresMedicineCheck": True, "treatment": "medical"},
    "exhaustion": {"areas": ["whole_body"], "requiresMedicineCheck": True, "treatment": "medical"},
    "stress": {"areas": ["whole_body", "mind"], "requiresMedicineCheck": True, "treatment": "medical"},
    "intoxication": {"areas": ["whole_body"], "requiresMedicineCheck": True, "treatment": "medical"},
    "infection": {"areas": ["whole_body"], "requiresMedicineCheck": True, "treatment": "medical"},
    "fracture": {"areas": ["limb"], "requiresMedicineCheck": True, "treatment": "medical"},
    "shock": {"areas": ["whole_body"], "requiresMedicineCheck": True, "treatment": "medical"},
    "unconsciousness": {"areas": ["whole_body"], "requiresMedicineCheck": True, "treatment": "medical"},
    "blindness": {"areas": ["eyes", "vision", "head"], "requiresMedicineCheck": True, "treatment": "medical"},
    "deafness": {"areas": ["ears", "hearing", "head"], "requiresMedicineCheck": True, "treatment": "medical"},
    "sleep": {"areas": ["whole_body", "mind"], "requiresMedicineCheck": False, "treatment": "rest"},
    "amputation": {"areas": ["missing_limb"], "requiresMedicineCheck": True, "treatment": "medical"},
    "organ_loss": {"areas": ["missing_organ"], "requiresMedicineCheck": True, "treatment": "medical"},
}


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def _clamp(value: int, minimum: Optional[int] = 0, maximum: Optional[int] = None) -> int:
    if minimum is not None:
        value = max(minimum, value)
    if maximum is not None:
        value = min(maximum, value)
    return value


def canonical_type(effect_type: Any = None, name: str = "") -> str:
    raw = str(effect_type or name or "").strip().lower()
    if not raw:
        return "generic"
    if raw in TYPE_ALIASES:
        return TYPE_ALIASES[raw]
    compact = raw.replace(" ", "").replace("-", "").replace("_", "")
    if compact in TYPE_ALIASES:
        return TYPE_ALIASES[compact]
    if "внутрен" in raw and "кров" in raw:
        if "экстрем" in raw:
            return "bleeding_internal_extreme"
        if "сильн" in raw:
            return "bleeding_internal_severe"
        if "средн" in raw:
            return "bleeding_internal_medium"
        if "легк" in raw or "лёгк" in raw:
            return "bleeding_internal_light"
        return "bleeding_internal_light"
    if "внешн" in raw and "кров" in raw:
        if "экстрем" in raw:
            return "bleeding_external_extreme"
        if "сильн" in raw:
            return "bleeding_external_severe"
        if "средн" in raw:
            return "bleeding_external_medium"
        if "легк" in raw or "лёгк" in raw:
            return "bleeding_external_light"
        return "bleeding_external_light"
    if "кров" in raw:
        return "bleeding"
    if "радиац" in raw:
        return "radiation"
    if "истощ" in raw:
        return "exhaustion"
    if "стресс" in raw:
        return "stress"
    if "опьян" in raw:
        return "intoxication"
    if "перелом" in raw:
        return "fracture"
    if "боль" in raw:
        return "pain"
    if "шок" in raw:
        return "shock"
    if "слеп" in raw:
        return "blindness"
    if "глух" in raw:
        return "deafness"
    if "заражен" in raw:
        return "infection"
    if "леч" in raw or "heal" in raw:
        return "heal"
    if "реген" in raw:
        return "regeneration"
    if "ампута" in raw:
        return "amputation"
    if "потер" in raw and "орган" in raw:
        return "organ_loss"
    return "generic"


def get_effect_meta(effect_type: str) -> Dict[str, str]:
    return EFFECT_TYPE_META.get(effect_type, EFFECT_TYPE_META["generic"])


BLEEDING_STAGE_ORDER = ["normal", "light", "medium", "severe", "critical"]
BLEEDING_STAGE_PENALTIES = {
    "normal": 0,
    "light": 1,
    "medium": 2,
    "severe": 3,
    "critical": 4,
}

BLEEDING_EFFECT_RULES = {
    "bleeding": {"severity": 1, "kind": "external", "stage": "light", "areas": ["wound"]},
    "bleeding_external_light": {"severity": 1, "kind": "external", "stage": "light", "areas": ["wound"]},
    "bleeding_external_medium": {"severity": 2, "kind": "external", "stage": "medium", "areas": ["wound"]},
    "bleeding_external_severe": {"severity": 3, "kind": "external", "stage": "severe", "areas": ["wound"]},
    "bleeding_external_extreme": {"severity": 4, "kind": "external", "stage": "critical", "areas": ["wound"]},
    "bleeding_internal_light": {"severity": 1, "kind": "internal", "stage": "light", "areas": ["internal", "wound"]},
    "bleeding_internal_medium": {"severity": 2, "kind": "internal", "stage": "medium", "areas": ["internal", "wound"]},
    "bleeding_internal_severe": {"severity": 3, "kind": "internal", "stage": "severe", "areas": ["internal", "wound"]},
    "bleeding_internal_extreme": {"severity": 4, "kind": "internal", "stage": "critical", "areas": ["internal", "wound"]},
}


def get_effect_type_options() -> List[Dict[str, str]]:
    return [
        {"value": key, "label": meta["label"], "group": meta["group"]}
        for key, meta in EFFECT_TYPE_META.items()
    ]


def create_effect_draft(effect_type: str = "generic", overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    overrides = overrides or {}
    normalized_type = canonical_type(effect_type, overrides.get("name", ""))
    meta = get_effect_meta(normalized_type)
    remaining = overrides.get("remaining", overrides.get("duration", None))
    return {
        "id": overrides.get("id") or None,
        "type": normalized_type,
        "name": overrides.get("name") or meta["label"],
        "value": overrides.get("value", 0),
        "duration": overrides.get("duration", None),
        "remaining": remaining,
        "stacks": max(1, _to_int(overrides.get("stacks", 1), 1)),
        "source": overrides.get("source"),
        "area": overrides.get("area") or overrides.get("zone") or overrides.get("bodyPart") or overrides.get("target"),
        "note": overrides.get("note", ""),
        "tick": overrides.get("tick", "manual"),
        "scope": overrides.get("scope", "character"),
        "active": overrides.get("active", True),
    }


def normalize_effect(raw: Any) -> Dict[str, Any]:
    if raw is None:
        return create_effect_draft()
    if isinstance(raw, str):
        return create_effect_draft(canonical_type(raw, raw), {"name": raw})
    if not isinstance(raw, dict):
        return create_effect_draft("generic", {"value": raw})

    effect_type = canonical_type(raw.get("type") or raw.get("kind") or raw.get("effectType"), raw.get("name", ""))
    value = raw.get("value", raw.get("amount", raw.get("power", 0)))
    duration = raw.get("duration", raw.get("turns", raw.get("remaining", None)))
    remaining = raw.get("remaining", duration)

    data = create_effect_draft(effect_type, {
        "id": raw.get("id"),
        "name": raw.get("name") or raw.get("label") or get_effect_meta(effect_type)["label"],
        "value": _to_int(value, 0),
        "duration": None if duration in (None, "") else _to_int(duration, None),
        "remaining": None if remaining in (None, "") else _to_int(remaining, None),
        "stacks": raw.get("stacks", 1),
        "source": raw.get("source") or raw.get("origin"),
        "note": raw.get("note") or raw.get("description", ""),
        "tick": raw.get("tick") or raw.get("tickPhase") or "manual",
        "scope": raw.get("scope", "character"),
        "active": raw.get("active", True),
    })
    return data


def normalize_effect_list(effects: Any) -> List[Dict[str, Any]]:
    if not isinstance(effects, list):
        return []
    return [normalize_effect(effect) for effect in effects]


def _bleeding_rule(effect_type: str) -> Optional[Dict[str, Any]]:
    return BLEEDING_EFFECT_RULES.get(effect_type) if effect_type in BLEEDING_EFFECT_RULES else None


def _bleeding_stage_value(stage: Any) -> int:
    try:
        return BLEEDING_STAGE_ORDER.index(str(stage or "normal").lower())
    except ValueError:
        return 0


def get_bleeding_state(health: Dict[str, Any]) -> Dict[str, Any]:
    effects = normalize_effect_list((health or {}).get("effects") or [])
    combat_meta = (health or {}).get("combatMeta") or {}
    breakdown = {
        "external": {"light": 0, "medium": 0, "severe": 0, "extreme": 0, "total": 0},
        "internal": {"light": 0, "medium": 0, "severe": 0, "extreme": 0, "total": 0},
    }
    effect_details: List[Dict[str, Any]] = []
    total_severity = 0

    for effect in effects:
        rule = _bleeding_rule(effect["type"])
        if not rule:
            continue
        stacks = max(1, _to_int(effect.get("stacks", 1), 1))
        base_severity = max(1, _to_int(effect.get("value", 0), rule.get("severity", 1)))
        resolved_severity = max(rule.get("severity", 1), base_severity) * stacks
        group = rule.get("kind", "external")
        stage = rule.get("stage", "light")
        if group not in breakdown:
            continue
        breakdown[group][stage] = breakdown[group].get(stage, 0) + stacks
        breakdown[group]["total"] += resolved_severity
        total_severity += resolved_severity
        effect_details.append({
            "type": effect["type"],
            "name": effect.get("name") or get_effect_meta(effect["type"])["label"],
            "kind": group,
            "stage": stage,
            "severity": resolved_severity,
            "stacks": stacks,
        })

    blood_stage = str((health or {}).get("blood") or (health or {}).get("bloodStage") or "normal").lower()
    stage_penalty = _bleeding_stage_value(blood_stage)
    if isinstance(combat_meta.get("bleedingModifiers"), list):
        modifier_total = sum(_to_int(item.get("value", item), 0) if isinstance(item, dict) else _to_int(item, 0) for item in combat_meta.get("bleedingModifiers", []))
    else:
        modifier_total = _to_int(combat_meta.get("bleedingModifierTotal", (health or {}).get("bleedingModifierTotal", 0)), 0)
    return {
        "baseDifficulty": 5,
        "totalSeverity": total_severity,
        "bloodStage": blood_stage,
        "stagePenalty": stage_penalty,
        "modifierTotal": modifier_total,
        "difficulty": max(0, 5 + total_severity - stage_penalty + modifier_total),
        "breakdown": breakdown,
        "effects": effect_details,
    }


def sync_health_derived_statuses(health: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(health, dict):
        return health
    bleeding = get_bleeding_state(health)
    health["bleeding"] = bleeding
    health["bleedingSeverity"] = bleeding["totalSeverity"]
    health["bleedingDifficulty"] = bleeding["difficulty"]
    health["bleedingStagePenalty"] = bleeding["stagePenalty"]
    health["bleedingModifierTotal"] = bleeding["modifierTotal"]
    health["bloodStage"] = bleeding["bloodStage"]
    health["bleedingEffects"] = bleeding["effects"]
    return health


def normalize_character_effects(character_data: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(character_data, dict):
        return character_data
    health = character_data.get("health")
    if isinstance(health, dict) and isinstance(health.get("effects"), list):
        health["effects"] = normalize_effect_list(health["effects"])
        sync_health_derived_statuses(health)
    if isinstance(character_data.get("effects"), list):
        character_data["effects"] = normalize_effect_list(character_data["effects"])
    return character_data


def get_effect_impact(effect: Any) -> Dict[str, Any]:
    normalized = normalize_effect(effect)
    rule = EFFECT_IMPACT_RULES.get(normalized["type"], EFFECT_IMPACT_RULES["generic"])
    areas = list(rule.get("areas", []))
    if normalized.get("area") and normalized["area"] not in areas:
        areas.append(normalized["area"])
    bleeding_rule = _bleeding_rule(normalized["type"])
    return {
        "type": normalized["type"],
        "name": normalized.get("name"),
        "areas": areas,
        "requires_medicine_check": bool(rule.get("requiresMedicineCheck", False)),
        "treatment": rule.get("treatment", "manual"),
        "severity": max(1, _to_int(normalized.get("value", 0), bleeding_rule.get("severity", 1))) if bleeding_rule else None,
        "bleeding_kind": bleeding_rule.get("kind") if bleeding_rule else None,
    }


def summarize_effect_impact(effect: Any) -> str:
    impact = get_effect_impact(effect)
    areas = ", ".join(impact["areas"]) if impact["areas"] else "нет"
    treatment = "требует Медицины" if impact["requires_medicine_check"] else "без проверки"
    bleeding_part = f": {impact['bleeding_kind']} {impact['severity']}" if impact.get("bleeding_kind") else ""
    return f"{impact['name']}{bleeding_part}, {areas} ({treatment})"


def _adjust_field(health: Dict[str, Any], field: str, delta: int, minimum: Optional[int] = 0, maximum: Optional[int] = None) -> None:
    current = _to_int(health.get(field, 0), 0)
    health[field] = _clamp(current + delta, minimum, maximum)


def apply_effect_to_health(health: Dict[str, Any], raw_effect: Any) -> Dict[str, Any]:
    effect = normalize_effect(raw_effect)
    signed_value = _to_float(effect.get("value", 0), 0)
    magnitude = abs(_to_float(effect.get("value", 0), 0))
    effect_type = effect["type"]

    if effect_type == "heal":
        current = _to_int(health.get("current", 0), 0)
        max_value = health.get("max")
        max_value = None if max_value in (None, "") else _to_int(max_value, None)
        health["current"] = _clamp(current + magnitude, 0, max_value)
        return health

    if effect_type == "regeneration":
        health.setdefault("effects", [])
        existing = None
        for idx, item in enumerate(health["effects"]):
            current = normalize_effect(item)
            if current["type"] == effect_type and (current.get("source") or None) == (effect.get("source") or None):
                existing = idx
                break
        if existing is None:
            health["effects"].append(effect)
        else:
            current = normalize_effect(health["effects"][existing])
            current.update(effect)
            current["stacks"] = max(_to_int(current.get("stacks", 1), 1), _to_int(effect.get("stacks", 1), 1))
            health["effects"][existing] = current
        sync_health_derived_statuses(health)
        return health

    if effect_type == "radiation":
        _adjust_field(health, "radiation", int(signed_value) if float(signed_value).is_integer() else signed_value, 0, None)
        return health

    if effect_type == "pain":
        _adjust_field(health, "painLevel", int(signed_value) if float(signed_value).is_integer() else signed_value, 0, 10)
        meta = health.setdefault("combatMeta", {})
        meta["painIncreased"] = True
        return health

    if effect_type == "exhaustion":
        _adjust_field(health, "exhaustion", int(signed_value) if float(signed_value).is_integer() else signed_value, 0, 10)
        return health

    if effect_type == "stress":
        _adjust_field(health, "stress", int(signed_value) if float(signed_value).is_integer() else signed_value, 0, 10)
        return health

    if effect_type == "intoxication":
        _adjust_field(health, "intoxication", int(signed_value) if float(signed_value).is_integer() else signed_value, 0, 100)
        return health

    if effect_type == "infection":
        _adjust_field(health, "infection", int(signed_value) if float(signed_value).is_integer() else signed_value, 0, 100)
        sync_health_derived_statuses(health)
        return health

    if effect_type in {
        "bleeding",
        "fracture",
        "shock",
        "unconsciousness",
        "blindness",
        "deafness",
        "bleeding_external_light",
        "bleeding_external_medium",
        "bleeding_external_severe",
        "bleeding_external_extreme",
        "bleeding_internal_light",
        "bleeding_internal_medium",
        "bleeding_internal_severe",
        "bleeding_internal_extreme",
    }:
        health.setdefault("effects", [])
        existing = None
        for idx, item in enumerate(health["effects"]):
            current = normalize_effect(item)
            if current["type"] == effect_type and (current.get("source") or None) == (effect.get("source") or None):
                existing = idx
                break

        if existing is None:
            health["effects"].append(effect)
        else:
            current = normalize_effect(health["effects"][existing])
            current.update(effect)
            current["stacks"] = max(_to_int(current.get("stacks", 1), 1), _to_int(effect.get("stacks", 1), 1))
            health["effects"][existing] = current
        sync_health_derived_statuses(health)
        return health

    health.setdefault("effects", [])
    existing = None
    for idx, item in enumerate(health["effects"]):
        current = normalize_effect(item)
        if current["type"] == effect_type and (current.get("source") or None) == (effect.get("source") or None):
            existing = idx
            break

    if existing is None:
        health["effects"].append(effect)
    else:
        current = normalize_effect(health["effects"][existing])
        current.update(effect)
        current["stacks"] = max(_to_int(current.get("stacks", 1), 1), _to_int(effect.get("stacks", 1), 1))
        health["effects"][existing] = current
    sync_health_derived_statuses(health)
    return health


def tick_effect(effect: Dict[str, Any], phase: str = "turn_end") -> Dict[str, Any]:
    normalized = normalize_effect(effect)
    if not normalized.get("active", True):
        return normalized
    if normalized.get("tick") not in (None, "manual", phase):
        return normalized
    if normalized.get("remaining") is not None:
        normalized["remaining"] = max(0, _to_int(normalized.get("remaining"), 0) - 1)
    return normalized


def apply_periodic_effects_to_health(health: Dict[str, Any], effects: Iterable[Any], phase: str = "turn_end") -> Dict[str, Any]:
    if not isinstance(health, dict):
        return health
    for raw_effect in effects or []:
        effect = normalize_effect(raw_effect)
        if not effect.get("active", True):
            continue
        if effect.get("tick") not in (None, "manual", phase):
            continue
        magnitude = abs(_to_int(effect.get("value", 0), 0))
        if effect["type"] == "regeneration":
            current = _to_int(health.get("current", 0), 0)
            max_value = health.get("max")
            max_value = None if max_value in (None, "") else _to_int(max_value, None)
            health["current"] = _clamp(current + magnitude, 0, max_value)
    sync_health_derived_statuses(health)
    return health


def tick_effects(effects: Iterable[Any], phase: str = "turn_end") -> List[Dict[str, Any]]:
    updated = []
    for effect in effects or []:
        normalized = tick_effect(effect, phase=phase)
        if normalized.get("remaining") == 0 and normalized.get("duration") is not None:
            continue
        updated.append(normalized)
    return updated


def effect_summary(effect: Any) -> str:
    normalized = normalize_effect(effect)
    parts = [normalized.get("name") or get_effect_meta(normalized["type"])["label"]]
    if normalized.get("value"):
        parts.append(f"+{normalized['value']}")
    if normalized.get("remaining") is not None:
        parts.append(f"{normalized['remaining']}t")
    return " ".join(parts)
