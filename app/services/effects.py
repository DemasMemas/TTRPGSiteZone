from __future__ import annotations

from copy import deepcopy
import math
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
    "radiation_treatment": {"label": "Выведение радиации", "group": "medical"},
    "blood_recovery": {"label": "Восстановление кровопотери", "group": "medical"},
    "periodic_adjustment": {"label": "Периодический эффект", "group": "status"},
    "delayed_adjustment": {"label": "Отложенный эффект", "group": "status"},
    "deferred_adjustment": {"label": "Отложенный эффект", "group": "status"},
    "delayed_treatment": {"label": "Ожидание действия препарата", "group": "medical"},
    "next_rest_healing": {"label": "Лечение на следующем отдыхе", "group": "medical"},
    "untreated_wound": {"label": "Необработанная рана", "group": "injury"},
    "tourniquet": {"label": "Наложен жгут", "group": "medical"},
    "blood_loss_freeze": {"label": "Стабилизация кровопотери", "group": "medical"},
    "bleeding_prevention": {"label": "Блок новых кровотечений", "group": "medical"},
    "infection_growth_block": {"label": "Блок нарастания заражения", "group": "medical"},
    "analgesia": {"label": "Обезболивание", "group": "medical"},
    "stimulant_crash": {"label": "Последствие стимулятора", "group": "medical"},
    "radiation_filter": {"label": "Защита от входящей радиации", "group": "medical"},
    "temperature_control": {"label": "Контроль температуры", "group": "medical"},
    "limb_trauma_suppression": {"label": "Подавление травмы конечности", "group": "medical"},
    "pain_block": {"label": "Блок новых уровней боли", "group": "medical"},
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
    **{effect_type: effect_type for effect_type in (
        "radiation_treatment", "blood_recovery", "periodic_adjustment", "delayed_adjustment",
        "deferred_adjustment", "delayed_treatment", "next_rest_healing", "untreated_wound",
        "tourniquet", "blood_loss_freeze", "bleeding_prevention", "infection_growth_block",
        "analgesia", "stimulant_crash", "radiation_filter", "temperature_control",
        "limb_trauma_suppression",
        "pain_block",
    )},
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
    "bleeding_internal_light": {"areas": ["wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding_internal_medium": {"areas": ["wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding_internal_severe": {"areas": ["wound"], "requiresMedicineCheck": True, "treatment": "medical"},
    "bleeding_internal_extreme": {"areas": ["wound"], "requiresMedicineCheck": True, "treatment": "medical"},
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


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(str(value).replace(",", "."))
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
    "bleeding_internal_light": {"severity": 1, "kind": "internal", "stage": "light", "areas": ["wound"]},
    "bleeding_internal_medium": {"severity": 2, "kind": "internal", "stage": "medium", "areas": ["wound"]},
    "bleeding_internal_severe": {"severity": 3, "kind": "internal", "stage": "severe", "areas": ["wound"]},
    "bleeding_internal_extreme": {"severity": 4, "kind": "internal", "stage": "critical", "areas": ["wound"]},
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
        "area": raw.get("area") or raw.get("zone") or raw.get("bodyPart") or raw.get("target"),
    })
    # Consumables attach executable metadata (delayed adjustments, expiry
    # consequences, wound state). Keep it while still normalizing core fields.
    for key, value in raw.items():
        if key not in {"type", "kind", "effectType", "turns", "tickPhase", "zone", "bodyPart", "target"}:
            data.setdefault(key, value)
    if str(data.get("name") or "").strip().lower() in {"", "общий", "generic"} and effect_type != "generic":
        data["name"] = get_effect_meta(effect_type)["label"]
    max_hours = _to_int(data.get("max_hours"), 0)
    if data.get("remaining") is None and max_hours > 0:
        data["remaining"] = max_hours
        data["duration"] = data.get("duration") or max_hours
        data["time_unit"] = "hour"
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
        if not rule or not effect.get("active", True) or effect.get("closed") or effect.get("suppressed"):
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
            "id": effect.get("id"),
            "type": effect["type"],
            "name": effect.get("name") or get_effect_meta(effect["type"])["label"],
            "kind": group,
            "stage": stage,
            "severity": resolved_severity,
            "stacks": stacks,
            "area": effect.get("area"),
            "treated": bool(effect.get("treated", False)),
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


def _distribute_zone_healing(health: Dict[str, Any], amount: float) -> None:
    remaining = max(0, int(_to_float(amount, 0)))
    zones = [zone for zone in (health.get("zones") or {}).values() if isinstance(zone, dict)]
    for zone in zones:
        maximum = max(0, int(round(_to_float(zone.get("max", 0), 0))))
        zone["current"] = min(maximum, max(0, int(round(_to_float(zone.get("current", 0), 0)))))
    while remaining > 0:
        damaged = [
            zone for zone in zones
            if _to_float(zone.get("current", 0), 0) < _to_float(zone.get("max", 0), 0)
        ]
        if not damaged:
            break
        share = remaining // len(damaged)
        if share == 0:
            for zone in damaged[:remaining]:
                zone["current"] += 1
            break
        applied = 0
        for zone in damaged:
            current = int(zone.get("current", 0))
            maximum = int(zone.get("max", 0))
            healed = min(share, maximum - current)
            zone["current"] = current + healed
            applied += healed
        if applied <= 0:
            break
        remaining -= applied


def _heal_health_and_zones(health: Dict[str, Any], amount: float) -> None:
    """Heal the shared pool fully and distribute one healing budget over zones."""
    current = _to_float(health.get("current", 0), 0)
    max_value = health.get("max")
    max_value = None if max_value in (None, "") else _to_float(max_value, None)
    health["current"] = _clamp(current + amount, 0, max_value)
    _distribute_zone_healing(health, amount)


def apply_effect_to_health(health: Dict[str, Any], raw_effect: Any) -> Dict[str, Any]:
    effect = normalize_effect(raw_effect)
    signed_value = _to_float(effect.get("value", 0), 0)
    magnitude = abs(_to_float(effect.get("value", 0), 0))
    effect_type = effect["type"]

    active_effects = normalize_effect_list(health.get("effects") or [])
    if effect_type.startswith("bleeding_") and any(
        item.get("type") == "bleeding_prevention" and item.get("active", True)
        for item in active_effects
    ):
        return health

    if effect_type == "heal":
        _heal_health_and_zones(health, magnitude)
        return health

    if effect_type == "regeneration":
        health.setdefault("effects", [])
        existing = None
        for idx, item in enumerate(health["effects"]):
            current = normalize_effect(item)
            same_id = effect.get("id") and current.get("id") == effect.get("id")
            if same_id or (
                not effect_type.startswith("bleeding_")
                and current["type"] == effect_type
                and (current.get("source") or None) == (effect.get("source") or None)
                and (current.get("area") or None) == (effect.get("area") or None)
            ):
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
        pain_delta = int(signed_value) if float(signed_value).is_integer() else signed_value
        blockers = [item for item in active_effects if item.get("blocks_new_pain") and item.get("active", True)]
        if pain_delta > 0 and blockers:
            meta = health.setdefault("combatMeta", {})
            meta["blockedPain"] = _to_float(meta.get("blockedPain", 0), 0) + pain_delta
            return health
        _adjust_field(health, "painLevel", pain_delta, 0, 10)
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
            same_id = effect.get("id") and current.get("id") == effect.get("id")
            if same_id or (
                not effect_type.startswith("bleeding_")
                and current["type"] == effect_type
                and (current.get("source") or None) == (effect.get("source") or None)
                and (current.get("area") or None) == (effect.get("area") or None)
            ):
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
        if (
            (effect.get("id") and current.get("id") == effect.get("id"))
            or (
                current["type"] == effect_type
                and (current.get("source") or None) == (effect.get("source") or None)
                and (current.get("area") or None) == (effect.get("area") or None)
            )
        ):
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
    if normalized.get("tick") == "manual" or normalized.get("tick") not in (None, phase):
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
        if effect.get("tick") == "manual" or effect.get("tick") not in (None, phase):
            continue
        magnitude = abs(_to_float(effect.get("value", 0), 0))
        if effect["type"] == "regeneration":
            _heal_health_and_zones(health, magnitude)
        elif effect["type"] == "radiation_treatment":
            _adjust_field(health, "radiation", -magnitude, 0, None)
        elif effect["type"] == "blood_recovery":
            order = ["normal", "light", "medium", "severe", "critical"]
            stage = str(health.get("blood") or health.get("bloodStage") or "normal").lower()
            index = order.index(stage) if stage in order else 0
            next_stage = order[max(0, index - max(1, _to_int(effect.get("value", 1), 1)))]
            health["blood"] = next_stage
            health["bloodStage"] = next_stage
        elif effect["type"] == "periodic_adjustment":
            for adjustment in effect.get("adjustments") or []:
                if not isinstance(adjustment, dict):
                    continue
                field = str(adjustment.get("field") or "").strip()
                if field:
                    _adjust_field(health, field, _to_float(adjustment.get("delta", 0), 0), adjustment.get("min", 0), adjustment.get("max"))
    sync_health_derived_statuses(health)
    return health


def apply_expired_effects_to_health(health: Dict[str, Any], effects: Iterable[Any], phase: str = "turn_end") -> Dict[str, Any]:
    activated: List[Dict[str, Any]] = []
    for raw_effect in effects or []:
        effect = normalize_effect(raw_effect)
        if effect.get("tick") == "manual" or effect.get("tick") not in (None, phase):
            continue
        if effect.get("remaining") is None or _to_int(effect.get("remaining"), 0) > 1:
            continue
        for adjustment in effect.get("onExpire") or effect.get("on_expire") or []:
            if not isinstance(adjustment, dict):
                continue
            field = str(adjustment.get("field") or "").strip()
            if field:
                _adjust_field(health, field, _to_float(adjustment.get("delta", 0), 0), adjustment.get("min", 0), adjustment.get("max"))
        if effect.get("type") in {"delayed_adjustment", "delayed_treatment"}:
            for adjustment in effect.get("adjustments") or []:
                if not isinstance(adjustment, dict):
                    continue
                field = str(adjustment.get("field") or "").strip()
                if field:
                    _adjust_field(health, field, _to_float(adjustment.get("delta", 0), 0), adjustment.get("min", 0), adjustment.get("max"))
        for activated_effect in effect.get("activate_effects") or effect.get("activateEffects") or []:
            if isinstance(activated_effect, dict):
                activated.append(activated_effect)
        if effect.get("type") == "pain_block":
            meta = health.setdefault("combatMeta", {})
            blocked = _to_float(meta.pop("blockedPain", 0), 0)
            returned = blocked * _to_float(effect.get("return_fraction", 1), 1)
            _adjust_field(health, "painLevel", returned, 0, 10)
            _adjust_field(health, "exhaustion", _to_float(effect.get("exhaustion_on_expire", 0), 0), 0, 10)
    for activated_effect in activated:
        apply_effect_to_health(health, activated_effect)
    if health.get("max") is not None and health.get("current") is not None:
        health["current"] = min(_to_float(health.get("current"), 0), _to_float(health.get("max"), 0))
    sync_health_derived_statuses(health)
    return health


def tick_effects(effects: Iterable[Any], phase: str = "turn_end") -> List[Dict[str, Any]]:
    updated = []
    for effect in effects or []:
        normalized = tick_effect(effect, phase=phase)
        if normalized.get("remaining") == 0 and not normalized.get("persist_at_zero"):
            continue
        updated.append(normalized)
    return updated


def advance_timed_effects(
    health: Dict[str, Any],
    effects: Iterable[Any],
    elapsed_seconds: float,
    *,
    include_turn_effects: bool = False,
) -> List[Dict[str, Any]]:
    """Advance real-time effects without simulating thousands of combat ticks."""
    unit_seconds = {"second": 1, "minute": 60, "movement": 600, "hour": 3600}
    survivors = []
    activated = []
    elapsed = max(0.0, _to_float(elapsed_seconds, 0))

    for raw_effect in effects or []:
        effect = normalize_effect(raw_effect)
        unit = str(effect.get("time_unit") or "").lower()
        tick = str(effect.get("tick") or "")
        if effect.get("remaining") is None and _to_float(effect.get("max_hours"), 0) > 0:
            effect["remaining"] = _to_float(effect.get("max_hours"), 0)
            effect["time_unit"] = "hour"
            unit = "hour"
        if not unit:
            unit = {
                "time_elapsed": "minute",
                "movement_end": "movement",
                "hour_start": "hour",
            }.get(tick, "")
        if include_turn_effects and not unit and tick == "turn_end":
            unit = "second"
            effect.setdefault("seconds_per_unit", 6)
        if unit not in unit_seconds or effect.get("remaining") is None:
            survivors.append(effect)
            continue

        seconds_per_unit = max(
            0.001,
            _to_float(effect.get("seconds_per_unit"), unit_seconds[unit]),
        )
        remaining_seconds = _to_float(
            effect.get("remaining_seconds"),
            _to_float(effect.get("remaining"), 0) * seconds_per_unit,
        ) - elapsed
        if remaining_seconds > 0:
            effect["remaining_seconds"] = remaining_seconds
            effect["remaining"] = max(1, math.ceil(remaining_seconds / seconds_per_unit))
            survivors.append(effect)
            continue

        for adjustment in effect.get("onExpire") or effect.get("on_expire") or []:
            if isinstance(adjustment, dict) and adjustment.get("field"):
                _adjust_field(
                    health, str(adjustment["field"]),
                    _to_float(adjustment.get("delta", 0), 0),
                    adjustment.get("min", 0), adjustment.get("max"),
                )
        if effect.get("type") in {"delayed_adjustment", "delayed_treatment", "deferred_adjustment"}:
            for adjustment in effect.get("adjustments") or []:
                if isinstance(adjustment, dict) and adjustment.get("field"):
                    _adjust_field(
                        health, str(adjustment["field"]),
                        _to_float(adjustment.get("delta", 0), 0),
                        adjustment.get("min", 0), adjustment.get("max"),
                    )
        activated.extend(
            item for item in (effect.get("activate_effects") or effect.get("activateEffects") or [])
            if isinstance(item, dict)
        )

    combat_meta = health.get("combatMeta")
    if isinstance(combat_meta, dict):
        modifiers = combat_meta.get("consumableModifiers")
        if isinstance(modifiers, list):
            active_modifiers = []
            for raw_modifier in modifiers:
                if not isinstance(raw_modifier, dict):
                    active_modifiers.append(raw_modifier)
                    continue
                modifier = dict(raw_modifier)
                remaining = modifier.get("remaining")
                if remaining is None:
                    active_modifiers.append(modifier)
                    continue
                unit = str(modifier.get("time_unit") or "").lower()
                tick = str(modifier.get("tick") or "turn_end")
                if not unit:
                    unit = {
                        "turn_end": "second",
                        "time_elapsed": "minute",
                        "movement_end": "movement",
                        "hour_start": "hour",
                    }.get(tick, "")
                if unit not in unit_seconds:
                    active_modifiers.append(modifier)
                    continue
                seconds_per_unit = max(
                    0.001,
                    _to_float(
                        modifier.get("seconds_per_unit"),
                        6 if tick == "turn_end" else unit_seconds[unit],
                    ),
                )
                remaining_seconds = _to_float(
                    modifier.get("remaining_seconds"),
                    _to_float(remaining, 0) * seconds_per_unit,
                ) - elapsed
                if remaining_seconds <= 0:
                    continue
                modifier["remaining_seconds"] = remaining_seconds
                modifier["remaining"] = max(1, math.ceil(remaining_seconds / seconds_per_unit))
                active_modifiers.append(modifier)
            combat_meta["consumableModifiers"] = active_modifiers

    health["effects"] = survivors
    for effect in activated:
        apply_effect_to_health(health, effect)
    sync_health_derived_statuses(health)
    return normalize_effect_list(health.get("effects") or [])


def effect_summary(effect: Any) -> str:
    normalized = normalize_effect(effect)
    parts = [normalized.get("name") or get_effect_meta(normalized["type"])["label"]]
    if normalized.get("value"):
        parts.append(f"+{normalized['value']}")
    if normalized.get("remaining") is not None:
        parts.append(f"{normalized['remaining']}t")
    return " ".join(parts)
