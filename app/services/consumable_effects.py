from __future__ import annotations

import re
from typing import Any, Dict, List, Optional


def _normalize(text: Any) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(str(value).replace(",", "."))
    except (TypeError, ValueError):
        return default


def _to_int(value: Any, default: int = 0) -> int:
    try:
        if value is None or value == "":
            return default
        return int(float(str(value).replace(",", ".")))
    except (TypeError, ValueError):
        return default


def _parse_signed(text: str, pattern: str) -> Optional[float]:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return None
    sign = -1 if match.group("sign") == "-" else 1
    raw = match.group("value").replace(",", ".")
    if "/" in raw:
        left, right = raw.split("/", 1)
        try:
            return sign * (float(left) / float(right))
        except (TypeError, ValueError, ZeroDivisionError):
            return None
    try:
        return sign * float(raw)
    except (TypeError, ValueError):
        return None


def _parse_duration(text: str) -> Optional[int]:
    for pattern in [
        r"действует\s+(\d+)\s*(?:ход|хода|ходов)",
        r"работает\s+(\d+)\s*(?:ход|хода|ходов)",
        r"действует\s+(\d+)\s*минут",
        r"действует\s+(\d+)\s*час",
        r"действует\s+(\d+)\s*дн",
        r"срабатывает\s+через\s+(\d+)\s*(?:ход|хода|ходов|минут|час)",
        r"на\s+(\d+)\s*(?:ход|хода|ходов|минут|час|дн)",
    ]:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return _to_int(match.group(1), 0)
    return None


def _effect(effect_type: str, value: Any = 0, *, remaining: Optional[int] = None, tick: str = "manual", **extra: Any) -> Dict[str, Any]:
    payload = {
        "type": effect_type,
        "name": extra.pop("name", effect_type),
        "value": _to_float(value, 0),
        "tick": tick,
        "active": True,
    }
    if remaining is not None:
        payload["remaining"] = max(0, _to_int(remaining, 0))
    payload.update(extra)
    return payload


def parse_consumable_effects(description: str) -> Dict[str, Any]:
    text = _normalize(description)
    lower = text.lower()
    profile: Dict[str, Any] = {
        "direct": {},
        "effects": [],
        "modifiers": [],
        "status_removals": [],
        "status_additions": [],
        "requirements": [],
        "notes": [],
    }

    def add_effect(effect_type: str, value: Any = 0, **extra: Any) -> None:
        profile["effects"].append(_effect(effect_type, value, **extra))

    def add_modifier(stat: str, value: Any, remaining: Optional[int] = None, note: str = "") -> None:
        profile["modifiers"].append({
            "stat": stat,
            "value": _to_float(value, 0),
            "remaining": None if remaining is None else max(0, _to_int(remaining, 0)),
            "note": note,
        })

    def remove_statuses(*items: str) -> None:
        for item in items:
            if item and item not in profile["status_removals"]:
                profile["status_removals"].append(item)

    def add_summary_effect(effect_type: str, value: Any = 0, *, name: Optional[str] = None, remaining: Optional[int] = None, note: str = "") -> None:
        profile["effects"].append(_effect(effect_type, value, name=name or effect_type, remaining=remaining, source="direct", note=note))

    def add_summary_label(label: str, *, value: Any = 0, remaining: Optional[int] = None, note: str = "") -> None:
        add_summary_effect("generic", value, name=label, remaining=remaining, note=note)

    duration = _parse_duration(lower)

    # HP and regeneration
    hp = _parse_signed(lower, r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?)\s*хп(?:\s*в\s*ход)?")
    if hp is not None:
        if "в ход" in lower:
            duration = _parse_duration(lower)
            profile["direct"]["hp_per_turn"] = hp
            add_effect("regeneration", abs(hp), remaining=duration)
        else:
            profile["direct"]["hp"] = hp
            if hp > 0:
                add_effect("heal", abs(hp))
            elif hp < 0:
                add_effect("damage", abs(hp))

    # Numeric modifiers
    mapping = [
        ("radiation", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?(?:/\d+)?)\s*радиац"),
        ("intoxication", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?)\s*опьянен"),
        ("stress", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?(?:/\d+)?)\s*(?:уровн[ьяей]\s*)?стресса"),
        ("exhaustion", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?(?:/\d+)?)\s*(?:уровн[ьяей]\s*)?истощени"),
        ("pain", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?)\s*(?:уровн[ьяей]\s*)?боли"),
        ("action_points", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?)\s*од\b"),
        ("movement_points", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?)\s*(?:к\s*)?(?:перемещени|движени)"),
        ("strength", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?)\s*(?:к\s*)?сил[ые]"),
        ("agility", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?)\s*(?:к\s*)?ловк"),
        ("accuracy", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?)\s*(?:к\s*)?точност"),
        ("weight", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?)\s*(?:к\s*)?вес"),
        ("temperature", r"(?P<sign>[+-])(?P<value>\d+(?:[.,]\d+)?)\s*(?:градус|температур)"),
    ]
    for stat, pattern in mapping:
        value = _parse_signed(lower, pattern)
        if value is None:
            continue
        profile["direct"][f"{stat}_delta"] = value
        if stat in {"strength", "agility", "accuracy", "weight", "temperature"}:
            add_modifier(stat, value)
        elif stat == "action_points":
            add_modifier("action_points", value)
        elif stat == "movement_points":
            add_modifier("movement_points", value)
        else:
            add_effect(stat, value)

    # Durations and delays
    if duration is not None:
        profile["direct"]["duration"] = duration
    if "срабатывает через" in lower:
        profile["direct"]["delay"] = _parse_duration(lower)

    if "ампула" in lower or "капельница" in lower:
        profile["direct"]["medical_difficulty"] = 4
        profile["direct"]["application_form"] = "injectable"

    if "жаропонижающее средство" in lower and "мороз" in lower:
        profile["direct"]["temperature_delta"] = -1
        profile["notes"].append("temperature_drop_1")
    if "ингибитор" in lower:
        remove_statuses(
            "bleeding",
            "bleeding_external_light",
            "bleeding_external_medium",
            "bleeding_external_severe",
            "bleeding_external_extreme",
            "bleeding_internal_light",
            "bleeding_internal_medium",
            "bleeding_internal_severe",
            "bleeding_internal_extreme",
            "pain",
            "exhaustion",
            "stress",
            "intoxication",
            "infection",
            "blindness",
            "deafness",
            "shock",
            "unconsciousness",
            "amputation",
            "organ_loss",
        )
        profile["direct"]["delay"] = 1
        profile["direct"]["sleep_duration"] = 60
        profile["notes"].append("inhibitor_cleanup")
    if "подавитель эмоций" in lower:
        profile["direct"]["stress_advantage"] = True
        profile["direct"]["psy_delta"] = -25
    if "стимулятор котик" in lower:
        profile["direct"]["addiction_block_hours"] = 24
    if "стимулятор воля-н" in lower:
        profile["direct"]["pain_block_turns"] = 3
        profile["direct"]["stress_block_turns"] = 3
    elif "стимулятор воля" in lower:
        profile["direct"]["pain_block_turns"] = 3
        profile["direct"]["stress_block_turns"] = 3
    if "стимулятор гармония" in lower:
        profile["direct"]["stress_delta"] = -3
        profile["direct"]["psy_delta"] = -20
        profile["direct"]["stress_advantage"] = True
    if "стимулятор гора-д" in lower:
        profile["direct"]["strength_delta"] = 2
        profile["direct"]["weight_delta"] = -3
        profile["direct"]["hp"] = -100
    if "стимулятор мозгоправ" in lower:
        profile["direct"]["psy_defense_delta"] = 25
        profile["direct"]["will_delta"] = 3
        profile["direct"]["exhaustion_delta"] = 1
        profile["direct"]["psy_delta"] = -5
    if "стимулятор покой" in lower:
        profile["direct"]["stress_in_combat_delta"] = -3
        profile["direct"]["stress_safe_delta"] = -5
        profile["direct"]["psy_delta"] = -10
    if "стимулятор скала-н" in lower:
        profile["direct"]["organ_toughness_multiplier"] = 2
        profile["direct"]["hp_max_delta"] = 200
        profile["direct"]["hp"] = 200
        profile["direct"]["post_duration_hp_delta"] = -100
    elif "стимулятор скала" in lower:
        profile["direct"]["organ_toughness_multiplier"] = 2
        profile["direct"]["post_duration_hp_delta"] = -100
    if "стимулятор сова-н" in lower:
        profile["direct"]["sleep_block_hours"] = 8
        profile["direct"]["darkness_awareness_bonus"] = 5
    if "стимулятор шумодав" in lower:
        profile["direct"]["deafness"] = True
        profile["direct"]["vision_awareness_bonus"] = 4
        profile["direct"]["duration"] = 3

    if "тяжесть кровотечений" in lower and "1/3 бутылки воды" in lower:
        profile["direct"]["bleeding_modifier_delta"] = -2
        profile["direct"]["requires_water_fraction"] = 1 / 3
        profile["direct"]["exhaustion_if_no_water"] = 1
        profile["notes"].append("hematogen_bleeding_reduction")
    if "выход из болевого шока" in lower and "не тратится" in lower:
        profile["direct"]["will_shock_bonus"] = 2
        profile["direct"]["will_shock_advantage"] = True
        profile["direct"]["not_consumed"] = True
        profile["notes"].append("ammonia_shock_bonus")
    if "восстановить конечность" in lower and "1 здоровье" in lower and "4 раунда" in lower:
        profile["direct"]["fracture_splint"] = True
        profile["direct"]["fracture_restore_health"] = 1
        profile["direct"]["fracture_duration_turns"] = 4
        profile["notes"].append("splint")
    if "губка коллагеновая" in lower:
        profile["direct"]["bleeding_stop_light_cost"] = 1
        profile["direct"]["bleeding_stop_medium_cost"] = 2
        profile["direct"]["bleeding_stop_type"] = "external"
        profile["notes"].append("collagen_sponge")
    if "бинт" in lower and "bleeding_stop_light_cost" not in profile["direct"]:
        profile["direct"]["bleeding_stop_light_cost"] = 1
        profile["direct"]["bleeding_stop_type"] = "external"
        profile["notes"].append("bandage_bleeding_stop")
    if "вода" in lower or "бутылка воды" in lower:
        profile["direct"].setdefault("radiation_delta", -1)
        profile["direct"].setdefault("intoxication_delta", -1)
        profile["direct"].setdefault("exhaustion_delta", -1)
        profile["direct"].setdefault("uses", 3)
        profile["notes"].append("water_basic_cleanup")
    if "физраствор" in lower or "соляной раствор" in lower:
        profile["direct"]["not_consumed"] = True
        profile["notes"].append("saline_not_consumed")
    if lower == "-" or "хлеб" in lower:
        profile["direct"]["nutrition"] = 1
        profile["notes"].append("food")
    if "протеин" in lower:
        profile["direct"]["rest_heal_multiplier"] = 2
        profile["direct"]["requires_water_fraction"] = 1
        profile["notes"].append("protein_rest_bonus")
    if "протеин" in lower and "здоров" in lower:
        profile["direct"]["rest_heal_multiplier"] = 2
        profile["notes"].append("protein_rest_bonus_health")
    if "набор для определения группы крови" in lower or ("групп" in lower and "кров" in lower and "определ" in lower):
        profile["direct"]["blood_type_test"] = True
        profile["notes"].append("blood_type_test")
    if any(fragment in lower for fragment in ("вино", "алког", "спирт")):
        profile["direct"].setdefault("intoxication_delta", 1)
        profile["notes"].append("alcohol_intoxication")
    if "рад. защита противогаза не работает" in lower and "заряд" in lower:
        profile["direct"]["filter_charges"] = 20
        profile["direct"]["requires_gas_mask"] = True
        profile["notes"].append("gas_mask_filter")
    if "кустарный фильтр" in lower and "заряд" in lower:
        profile["direct"]["filter_charges"] = 10
        profile["direct"]["requires_gas_mask"] = True
        profile["notes"].append("gas_mask_filter")

    if "останов" in lower and "заражени" in lower:
        percent_match = re.search(r"(\d+(?:[.,]\d+)?)\s*%\s*прогресса заражения крови", lower)
        if percent_match:
            profile["direct"]["infection_delta"] = -_to_float(percent_match.group(1), 0)
        if "заражение крови на сутки" in lower or "заражение крови на 3 дня" in lower:
            profile["direct"]["infection_block"] = True

    uses_match = re.search(r"(\d+)\s*использован", lower)
    if uses_match:
        profile["direct"]["uses"] = _to_int(uses_match.group(1), 1)

    # Visible summaries for direct-only effects so they are not empty in the UI
    direct = profile["direct"]
    if direct.get("hp") is not None:
        hp_value = _to_float(direct["hp"], 0)
        if hp_value > 0:
            add_summary_label(f"Лечение +{abs(hp_value):g}")
        elif hp_value < 0:
            add_summary_label(f"Урон {abs(hp_value):g}")
    if direct.get("hp_per_turn") is not None:
        hp_turn = _to_float(direct["hp_per_turn"], 0)
        add_summary_label(f"Регенерация {abs(hp_turn):g}/ход", remaining=direct.get("duration"))
    for key, label in [
        ("radiation_delta", "Радиация"),
        ("intoxication_delta", "Опьянение"),
        ("stress_delta", "Стресс"),
        ("stress_in_combat_delta", "Стресс в бою"),
        ("stress_safe_delta", "Стресс вне боя"),
        ("exhaustion_delta", "Истощение"),
        ("pain_delta", "Боль"),
        ("infection_delta", "Заражение"),
        ("psy_delta", "Пси-состояние"),
        ("temperature_delta", "Температура"),
        ("strength_delta", "Сила"),
        ("agility_delta", "Ловкость"),
        ("accuracy_delta", "Точность"),
        ("weight_delta", "Вес"),
        ("will_delta", "Воля"),
        ("psy_defense_delta", "Пси-защита"),
        ("action_points_delta", "ОД"),
        ("movement_points_delta", "ОП"),
        ("med_bonus", "Бонус медикамента"),
    ]:
        if direct.get(key) is not None:
            value = direct[key]
            if isinstance(value, (int, float)):
                add_summary_label(f"{label} {value:g}")
            else:
                add_summary_label(label)
    if direct.get("bleeding_modifier_delta") is not None:
        add_summary_label(f"Тяжесть кровотечений {direct['bleeding_modifier_delta']:g}")
    if direct.get("bleeding_stop_light_cost") is not None or direct.get("bleeding_stop_medium_cost") is not None:
        if direct.get("bleeding_stop_medium_cost") is not None:
            add_summary_label("Останавливает кровотечение до среднего")
        else:
            add_summary_label("Останавливает кровотечение")
    if direct.get("fracture_splint"):
        add_summary_label("Шина")
    if direct.get("blood_type_test"):
        add_summary_label("Определение группы крови")
    if direct.get("rest_heal_multiplier") is not None:
        add_summary_label(f"Отдых x{direct['rest_heal_multiplier']:g}")
    if direct.get("nutrition") is not None:
        add_summary_label(f"Питание +{direct['nutrition']:g}")
    if direct.get("filter_charges") is not None:
        add_summary_label(f"Фильтр {direct['filter_charges']:g}")
    if direct.get("duration") is not None:
        add_summary_label(f"Длительность {direct['duration']:g}")
    if direct.get("delay") is not None:
        add_summary_label(f"Задержка {direct['delay']:g}")
    if direct.get("uses") is not None:
        add_summary_label(f"Использований {direct['uses']:g}")
    if direct.get("not_consumed"):
        add_summary_label("Не расходуется")
    if direct.get("requires_water_fraction") is not None:
        fraction = direct["requires_water_fraction"]
        if isinstance(fraction, (int, float)) and fraction > 0:
            add_summary_label(f"Требует воды {fraction:g}")
    if direct.get("requires_gas_mask"):
        add_summary_label("Требует противогаз")
    if direct.get("medical_difficulty") is not None or direct.get("application_form") is not None:
        add_summary_label("Мед. применение")
    if direct.get("addiction_block_hours") is not None:
        add_summary_label(f"Блок зависимостей {direct['addiction_block_hours']:g} ч")
    if direct.get("pain_block_turns") is not None or direct.get("stress_block_turns") is not None:
        add_summary_label("Блок боли/стресса")
    if direct.get("sleep_block_hours") is not None:
        add_summary_label(f"Блок сна {direct['sleep_block_hours']:g} ч")
    if direct.get("will_shock_bonus") is not None:
        add_summary_label(f"Выход из шока +{direct['will_shock_bonus']:g}")
    if direct.get("will_shock_advantage"):
        add_summary_label("Преимущество на шок")
    if direct.get("fracture_restore_health") is not None or direct.get("fracture_duration_turns") is not None:
        add_summary_label("Шина / перелом")
    if direct.get("infection_block"):
        add_summary_label("Блок заражения")
    if not profile["effects"] and profile["direct"]:
        for key, value in direct.items():
            if value is None:
                continue
            if key in {"uses", "duration", "delay", "not_consumed", "requires_gas_mask", "requires_water_fraction", "infection_block"}:
                continue
            if isinstance(value, bool):
                if value:
                    add_summary_label(key.replace("_", " ").title())
            elif isinstance(value, (int, float)):
                add_summary_label(f"{key.replace('_', ' ')} {value:g}")
            else:
                add_summary_label(f"{key.replace('_', ' ')}")

    # Statuses and special cases
    if "снимает 75% прогресса заражения крови" in lower:
        profile["direct"]["infection_delta"] = -75
    elif "снимает 50% прогресса заражения крови" in lower:
        profile["direct"]["infection_delta"] = -50
    elif "снимает 25% прогресса заражения крови" in lower:
        profile["direct"]["infection_delta"] = -25
    elif "снимает 5% прогресса заражения крови" in lower:
        profile["direct"]["infection_delta"] = -5

    if "уменьшает стадию кровопотери каждый раунд" in lower:
        add_effect("blood_recovery", 1, remaining=duration, tick="turn_end")
    if "останавливает ухудшение стадий кровопотери" in lower:
        add_effect("bleeding_block", 1, remaining=duration, note="freeze_blood_stage")
    if "блокирует появление новых кровотечений" in lower:
        add_effect("bleeding_block", 1, remaining=duration, note="block_new_bleeds")

    if "останавливает слабое кровотечение" in lower:
        remove_statuses("bleeding", "bleeding_external_light")
    if "останавливает среднее кровотечение" in lower:
        remove_statuses("bleeding", "bleeding_external_light", "bleeding_external_medium")
    if "останавливает сильное кровотечение" in lower:
        remove_statuses("bleeding", "bleeding_external_light", "bleeding_external_medium", "bleeding_external_severe")
    if "останавливает все кровотечения" in lower:
        remove_statuses(
            "bleeding",
            "bleeding_external_light",
            "bleeding_external_medium",
            "bleeding_external_severe",
            "bleeding_external_extreme",
            "bleeding_internal_light",
            "bleeding_internal_medium",
            "bleeding_internal_severe",
            "bleeding_internal_extreme",
        )
    if "останавливает слабое внутреннее кровотечение" in lower:
        remove_statuses("bleeding_internal_light")
    if "останавливает среднее внутреннее кровотечение" in lower:
        remove_statuses("bleeding_internal_light", "bleeding_internal_medium")
    if "останавливает сильное внутреннее кровотечение" in lower:
        remove_statuses("bleeding_internal_light", "bleeding_internal_medium", "bleeding_internal_severe")

    if "теряете слух" in lower or "закрывает действие сна" in lower or 'состояние "сна"' in lower:
        profile["status_additions"].append("sleep")
    if "теряете слух" in lower:
        profile["status_additions"].append("deafness")
    if "убирает одышку" in lower:
        profile["notes"].append("breathless_clear")

    multiplier_match = re.search(r"(?:прокачка|бонус|усиление)\s+(сил[ыя]|ловк[а-я]*|точност[ьи]|выносливост[ьи])\s*x\s*(\d+(?:[.,]\d+)?)", lower)
    if multiplier_match:
        stat_name = multiplier_match.group(1)
        multiplier = _to_float(multiplier_match.group(2), 1)
        stat_map = {
            "силы": "strength_multiplier",
            "сила": "strength_multiplier",
            "ловкости": "agility_multiplier",
            "ловкость": "agility_multiplier",
            "точности": "accuracy_multiplier",
            "точность": "accuracy_multiplier",
            "выносливости": "endurance_multiplier",
        }
        profile["modifiers"].append({
            "stat": stat_map.get(stat_name, "generic_multiplier"),
            "value": multiplier,
            "remaining": duration,
            "note": "multiplier",
        })

    if "вдвое больше хп" in lower:
        profile["modifiers"].append({
            "stat": "rest_heal_multiplier",
            "value": 2,
            "remaining": duration,
            "note": "rest_bonus",
        })

    for fragment in [
        "нужна 1/3 бутылки воды",
        "нужна 2/3 бутылки воды",
        "нужны спички",
        "нужна 1 порция любого алкоголя",
        "требуется капельница",
        "не считается едой",
        "считается едой и водой",
        "считается водой",
        "материал для крафта",
        "лимит 1",
        "не предназачен для внутреннего использования",
    ]:
        if fragment in lower:
            profile["requirements"].append(fragment)

    if "бонус медикамента" in lower:
        bonus_match = re.search(r"бонус медикамента\s*\+?(\d+)", lower)
        if bonus_match:
            profile["direct"]["med_bonus"] = _to_int(bonus_match.group(1), 0)

    if "без него рад. защита противогаза не работает" in lower:
        profile["requirements"].append("requires_gas_mask")

    return profile
