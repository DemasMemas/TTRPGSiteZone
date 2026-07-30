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
        r"(?:на\s+)?(\d+)\s*(?:перемещени[еяй]|передвижени[еяй])",
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
    if duration is not None and "перемещен" in lower:
        profile["direct"]["duration_phase"] = "movement_end"

    water_fraction_match = re.search(
        r"(\d+)\s*/\s*(\d+)[^.]{0,48}\u0431\u0443\u0442\u044b\u043b\u043a[^\s]*\s+"
        r"\u0432\u043e\u0434\u044b",
        lower,
    )
    if water_fraction_match:
        numerator = _to_float(water_fraction_match.group(1), 0)
        denominator = _to_float(water_fraction_match.group(2), 0)
        if numerator > 0 and denominator > 0:
            profile["direct"]["requires_water_fraction"] = numerator / denominator
            sentence_start = max(0, lower.rfind(".", 0, water_fraction_match.start()) + 1)
            sentence_end = lower.find(".", water_fraction_match.end())
            sentence = lower[sentence_start:sentence_end if sentence_end >= 0 else len(lower)]
            if "\u0430\u043b\u043a\u043e\u0433\u043e\u043b" in sentence:
                profile["direct"]["water_or_alcohol"] = True

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
            add_modifier(stat, value, remaining=duration)
        elif stat == "action_points":
            add_modifier("action_points", value, remaining=duration)
        elif stat == "movement_points":
            add_modifier("movement_points", value, remaining=duration)
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

    if 'состояние "сна"' in lower:
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

    _apply_canonical_consumable_rules(profile, lower)
    return profile


def _apply_canonical_consumable_rules(profile: Dict[str, Any], lower: str) -> None:
    """Apply rules whose wording is too contextual for the generic parser."""
    direct = profile["direct"]
    if "перемещен" in lower:
        direct["duration_phase"] = "movement_end"

    def effect(effect_type: str, value: Any = 0, **extra: Any) -> Dict[str, Any]:
        payload = _effect(effect_type, value, **extra)
        profile["effects"].append(payload)
        return payload

    def remove_effect_types(*types: str) -> None:
        blocked = set(types)
        profile["effects"] = [item for item in profile["effects"] if item.get("type") not in blocked]

    regeneration_match = re.search(r"\+(\d+(?:[.,]\d+)?)\s*здоровья\s+в\s+ход", lower)
    if regeneration_match:
        regeneration = _to_float(regeneration_match.group(1), 0)
        duration_match = re.search(r"действует\s+(\d+)\s*ход", lower)
        regeneration_duration = _to_int(duration_match.group(1), 1) if duration_match else direct.get("duration")
        direct["hp_per_turn"] = regeneration
        effect("regeneration", regeneration, name=f"Регенерация {regeneration:g}/ход",
               remaining=regeneration_duration, tick="turn_end")

    # Food, drinks and delayed everyday effects.
    if any(name in lower for name in ("хлеб", "колбаса", "консервы", "сушеная рыба", "сухой паек")):
        direct["nutrition"] = max(1, _to_float(direct.get("nutrition", 1), 1))
        direct["satisfy_food"] = True
    if lower.startswith("вода.") or " вода." in lower:
        direct["satisfy_water"] = True
    if "сухой паек" in lower:
        direct["satisfy_water"] = True
    if "консервы" in lower:
        direct.update({"exhaustion_delta": -1, "nutrition": 1, "uses": 2})
    if "сушеная рыба" in lower:
        direct.pop("intoxication_delta", None)
        direct.update({"stress_delta": -1, "exhaustion_delta": -0.5, "nutrition": 1, "uses": 3,
                       "requires_water_fraction": 1 / 3, "water_or_alcohol": True})
        remove_effect_types("intoxication")
    if lower.startswith("сахар.") or " сахар." in lower:
        direct.update({"stress_delta": -1, "exhaustion_delta": -3, "uses": 3, "requires_water_fraction": 2 / 3})
    if "кофе" in lower:
        direct.update({"action_points_delta": 2, "exhaustion_delta": -2, "uses": 3,
                       "requires_water_fraction": 1 / 3})
    if lower.startswith("энергетик."):
        direct.update({"action_points_delta": 5, "exhaustion_delta": -1, "duration": 3,
                       "weight_delta": -2, "use_limit": 1, "limit_scope": "turn",
                       "exclusive_group": "combat_stimulant", "clear_breathless": True})
    if lower.startswith("адреналин."):
        direct.update({"action_points_delta": 3, "action_points_duration": 3, "duration": 3,
                       "hp": -50, "exhaustion_delta": -1, "use_limit": 1,
                       "exclusive_group": "combat_stimulant", "clear_breathless": True})
        direct.pop("weight_delta", None)
    if lower.startswith("эпинефрин."):
        direct.update({"action_points_delta": 5, "action_points_duration": 3, "duration": 3,
                       "hp": 50, "exhaustion_delta": -2, "use_limit": 1,
                       "exclusive_group": "combat_stimulant", "clear_breathless": True})
        direct.pop("weight_delta", None)
    alcohol_rules = {
        "водка": (-1, 15, -0.25, -1, -1, 0.5, 6),
        "самогон": (-2.5, 25, -0.5, -1, -2, 1, 8),
        "вино": (-5, 10, 0, -1, -1, 0, 10),
        "банка пива": (-1, 20, -0.5, -1, 0, 0, 1),
    }
    for name, (radiation, intoxication, exhaustion, stress, pain, next_day_exhaustion, uses) in alcohol_rules.items():
        if name not in lower:
            continue
        direct.update({"radiation_delta": radiation, "intoxication_delta": intoxication,
                       "exhaustion_delta": exhaustion, "stress_delta": stress, "pain_delta": pain,
                       "uses": uses, "is_alcohol": True})
        if next_day_exhaustion:
            effect("deferred_adjustment", next_day_exhaustion, name="Истощение на следующие сутки",
                   remaining=1, tick="day_start", trigger="next_day",
                   adjustments=[{"field": "exhaustion", "delta": next_day_exhaustion, "min": 0, "max": 10}])
        break
    tobacco_stress = 1 if "самокрутка" in lower else 2
    if any(name in lower for name in ("самокрутка", "сигареты ", "сигары")):
        effect("delayed_adjustment", tobacco_stress, name="Снижение стресса через 5 минут",
               remaining=5, tick="time_elapsed", time_unit="minute", remaining_seconds=300,
               adjustments=[{"field": "stress", "delta": -tobacco_stress, "min": 0, "max": 10}])
        direct["requires_fire"] = True
        if "сигареты " in lower:
            direct["uses"] = 20
        elif "сигары" in lower:
            direct["uses"] = 5
    if "протеин" in lower:
        direct.update({"rest_heal_multiplier": 2, "requires_water_fraction": 1 / 3})
        effect("next_rest_healing", 2, name="Удвоенное лечение на следующем отдыхе", tick="rest", trigger="next_rest")

    # Targeted bleeding and wound treatment.
    applications = []
    def bleeding(max_stage: str, *, internal: bool = False, ap: int = 1, treated: bool = False, all_bleeds: bool = False) -> None:
        applications.append({"kind": "bleeding", "max_stage": max_stage, "internal": internal,
                             "action_points": ap, "treated": treated, "all": all_bleeds,
                             "allow_weakening": True})

    if "бинт" in lower:
        direct["uses"] = 1
        bleeding("light", treated="стерильный" in lower)
        applications.append({"kind": "bleeding", "max_stage": "medium", "internal": False,
                             "action_points": 1, "treated": "стерильный" in lower,
                             "item_uses": 2, "medicine_bonus": 2, "allow_weakening": True})
    if "антисептический тампон" in lower:
        bleeding("light", treated=True)
    if "пластырь с гемостатиком" in lower:
        bleeding("medium", ap=2)
        bleeding("severe", ap=4)
    if 'пластырь "стазис"' in lower:
        bleeding("medium", ap=1)
        bleeding("severe", ap=2)
    if "губка коллагеновая" in lower:
        bleeding("light", ap=1)
        bleeding("medium", ap=2)
    if any(name in lower for name in ("жгут", "турникет")) and "шина шарнирова" not in lower:
        stage = "extreme" if "альфа" in lower else "severe" if "турникет" in lower else "medium"
        bleeding(stage)
        direct.update({"tourniquet": True, "limb_only": True})
    if "оксицел" in lower:
        bleeding("light")
    if "тромбин-л" in lower:
        bleeding("light", internal=True)
    elif "тромбин" in lower:
        bleeding("severe")
        bleeding("medium", internal=True)
    if "глобулин" in lower or "контрикал" in lower:
        bleeding("severe", internal=True)
    if "соляного раствора" in lower:
        direct.update({"wound_treatment": True, "pain_delta": 1, "uses": 10, "action_points_cost": 1})
        direct.pop("not_consumed", None)
    if lower.startswith("спирт.") or " спирт." in lower:
        direct.update({"wound_treatment": True, "pain_delta": 3, "uses": 10,
                       "action_points_cost": 1, "external_use_only": True})
        direct.pop("intoxication_delta", None)
        remove_effect_types("intoxication")
    if applications:
        direct["applications"] = applications
        direct["requires_injury"] = True
        profile["status_removals"] = [
            status for status in profile["status_removals"]
            if not str(status).startswith("bleeding")
        ]
        profile["status_removals"] = [
            status for status in profile["status_removals"]
            if not str(status).startswith("bleeding")
        ]

    if 'кровоостанавливающее "желе"' in lower:
        remove_effect_types("bleeding_block")
        effect("blood_loss_freeze", 1, name="Стабилизация кровопотери", remaining=5, tick="turn_end")
    if 'кровоостанавливающее "хлопок"' in lower:
        remove_effect_types("bleeding_block")
        direct["stop_all_bleeding"] = True
        direct["exhaustion_delta"] = 1
        effect("bleeding_prevention", 1, name="Блок новых кровотечений", remaining=10, tick="turn_end")

    # Infection and transfusion.
    if 'стимулятор "полукровка"' in lower:
        direct.update({"infection_delta": -50, "infection_block_days": 3})
        effect("infection_growth_block", 1, name="Блок нарастания заражения", remaining=3,
               tick="day_start", time_unit="day")
    if "пенициллин" in lower:
        direct.update({"infection_delta": -5, "infection_block_chance": 20, "temperature_delta": 1})
    if "сангвинил" in lower:
        direct.update({"infection_delta": -5, "infection_block_chance": 50, "temperature_delta": 1})
    if "настойка мяты" in lower:
        direct.update({"infection_delta": -25, "exhaustion_delta": 1})
    is_saline_packet = lower.startswith("пакет физраствора.")
    is_blood_packet = lower.startswith("пакет крови.")
    is_fullblood = lower.startswith('стимулятор "полнокровка".')
    if is_saline_packet or is_blood_packet or is_fullblood:
        duration = 4 if is_blood_packet else 5 if is_fullblood else 2
        remove_effect_types("blood_recovery")
        effect("blood_recovery", 1, name="Восстановление стадии кровопотери", remaining=duration, tick="turn_end")
        if is_saline_packet or is_blood_packet:
            direct.update({"requires_infusion_tool": True, "blood_compatibility_required": is_blood_packet})
            direct.pop("not_consumed", None)
        if is_fullblood:
            direct["exhaustion_delta"] = 1
    if "набор для забора крови" in lower:
        direct.pop("requires_infusion_tool", None)
        direct.pop("blood_compatibility_required", None)
        remove_effect_types("blood_recovery")
        direct.update({"blood_collection": True, "target_required": True, "blood_stage_delta": 2,
                       "exhaustion_delta": 2})
    if "бутылек нашатыря" in lower:
        direct.update({"target_required": True, "requires_shock": True, "not_consumed": True})
    if "бутылек нашатыря" in lower:
        direct.update({"target_required": True, "requires_shock": True, "not_consumed": True})

    # Painkillers and delayed drugs.
    painkillers = {
        "анальгин": (2, 1, 8, 0.5, 0, 0),
        "аспирин": (2, 3, 2, -1, 0, 0),
        "ибупрофен": (1, 1, 10, -0.5, -10, -1),
        "настойка боярышника": (2, 1, 3, 0, 0, 0),
    }
    for name, (delay, pain, duration, temperature, infection, stress) in painkillers.items():
        if name not in lower:
            continue
        effect("delayed_treatment", pain, name=f"{name.capitalize()}: ожидание действия", remaining=delay,
               tick="turn_end", adjustments=[
                   {"field": "painLevel", "delta": -pain, "min": 0, "max": 10},
                   {"field": "temperature", "delta": temperature, "min": 0},
                   {"field": "infection", "delta": infection, "min": 0, "max": 100},
                   {"field": "stress", "delta": stress, "min": 0, "max": 10},
               ], activate_effects=[{"type": "analgesia", "name": f"Обезболивание {pain}", "value": pain,
                                     "remaining": duration, "tick": "turn_end"}])
        direct.pop("pain_delta", None)
        break
    if "морфин" in lower:
        direct.update({"exhaustion_delta": -1})
        effect("delayed_treatment", 3, name="Морфин: ожидание действия", remaining=1, tick="turn_end",
               adjustments=[{"field": "painLevel", "delta": -3, "min": 0, "max": 10},
                            {"field": "stress", "delta": -2, "min": 0, "max": 10}],
               activate_effects=[{"type": "analgesia", "name": "Морфин: блок боли", "value": 3,
                                  "remaining": 3, "tick": "turn_end", "blocks_new_pain": True}])
        effect("deferred_adjustment", 2, name="Морфин: истощение через час", remaining=1, tick="hour_start", trigger="one_hour",
               adjustments=[{"field": "exhaustion", "delta": 2, "min": 0, "max": 10}])

    # Combat stimulants and special preparations.
    if "научный стимулятор волкодав" in lower:
        profile["status_additions"] = [status for status in profile["status_additions"] if status != "sleep"]
        direct.update({"strength_delta": 5, "accuracy_delta": 5, "duration": 15})
        effect("stimulant_crash", 0, name="Волкодав", remaining=15, tick="turn_end",
               on_expire=[{"field": "current", "delta": -50, "min": 0}],
               activate_effects=[{"type": "sleep", "name": "Сон после Волкодава", "remaining": 1,
                                  "tick": "hour_start", "time_unit": "hour"}])
    if "стимулятор варвар" in lower:
        direct["pain_delta"] = -3
        effect("limb_trauma_suppression", 1, name="Подавление перелома и выбитой конечности",
               remaining=10, tick="time_elapsed", time_unit="minute", remaining_seconds=600)
    if "стимулятор викинг" in lower:
        direct["pain_delta"] = -5
        effect("limb_trauma_suppression", 1, name="Защита и подавление травм конечности",
               remaining=10, tick="time_elapsed", time_unit="minute", remaining_seconds=600,
               minimum_limb_health=1)
    if "научный стимпак" in lower:
        direct["radiation_delta"] = -5
    if "военный стимпак" in lower:
        direct["bleeding_modifier_delta"] = -2
    if "стимулятор шумодав" in lower:
        direct["duration"] = 3
        effect("deafness", 100, name="Глухота", remaining=3, tick="movement_end")
        profile["modifiers"].append({"stat": "vision_awareness", "value": 4, "remaining": 3,
                                     "tick": "movement_end", "note": "Шумодав"})
    if lower.startswith("стимулятор воля-н."):
        direct.update({"pain_block_turns": 5, "stress_block_turns": 5,
                       "blocked_pain_return_fraction": 0.5, "exhaustion_on_expire": 0})
    elif lower.startswith("стимулятор воля."):
        direct.update({"pain_block_turns": 3, "stress_block_turns": 3,
                       "blocked_pain_return_fraction": 1, "exhaustion_on_expire": 1})
    if "стимулятор сова-н" in lower or "стимулятор сова" in lower:
        profile["status_additions"] = [status for status in profile["status_additions"] if status != "sleep"]
        direct["satisfy_sleep"] = True
        direct["sleep_block_hours"] = 8 if "сова-н" in lower else 4
        if "сова-н" not in lower:
            direct.pop("exhaustion_delta", None)
            remove_effect_types("exhaustion")
            effect("deferred_adjustment", 2, name="Истощение на следующие сутки", tick="day_start",
                   remaining=1, trigger="next_day", adjustments=[{"field": "exhaustion", "delta": 2, "min": 0, "max": 10}])
    if any(name in lower for name in ("антирад-а", "антирад-б", "антирад-г", "йод-плюс")):
        dose = -5 if "антирад-б" in lower else -3 if "антирад-г" in lower else -2.5
        duration = 4 if "антирад-а" in lower or "антирад-б" in lower else 10
        direct.pop("radiation_delta", None)
        direct["exhaustion_delta"] = 1
        remove_effect_types("radiation")
        effect("radiation_treatment", dose, name=f"Выведение радиации {abs(dose):g}/ход",
               remaining=duration, tick="turn_end")
    radiation_shields = {
        'препарат "радист"-л': (100, 50),
        'препарат "радист"': (100, 100),
        'противорадиационное "брезент"-пб': (50, 100),
    }
    for name, (percent, capacity) in radiation_shields.items():
        if name in lower:
            direct.update({"radiation_filter_percent": percent, "radiation_filter_capacity": capacity,
                           "exhaustion_delta": 1})
            effect("radiation_filter", percent, name=f"Выведение входящей радиации {percent}%",
                   tick="movement_end", capacity=capacity, remaining_capacity=capacity, max_hours=24)
            break
    if "жаропонижающее средство" in lower and "мороз" in lower:
        direct["temperature_delta"] = -1
        effect("temperature_control", -1, name="Жаропонижающее", remaining=4, tick="turn_end")

    # Fractures, surgery and named limb restoratives require an explicit target.
    if "шина шарнирова" in lower:
        direct.update({"fracture_splint": True, "fracture_restore_health": 1,
                       "fracture_duration_minutes": 10, "requires_injury": True})
    if any(name in lower for name in ("шина.", '"химера"', '"вторая жизнь"', "хирургический набор",
                                      'кустарный набор "айболит"', "набор полного восстановления конечности")):
        direct["requires_injury"] = True
        direct["target_body_part"] = True
    surgery_match = re.search(r"восстанавливает (?:часть тела|утерянный орган или искореженную конечность).*?она имеет\s+(\d+)\s+здоров", lower)
    if surgery_match:
        direct["restore_limb_health"] = _to_int(surgery_match.group(1), 1)
        action_match = re.search(r"время использования\s*-\s*(\d+)\s*од", lower)
        direct["action_points_cost"] = _to_int(action_match.group(1), 1) if action_match else 1
        direct["restore_missing_part"] = True
    if '"химера"' in lower:
        direct.update({"cure_fracture": True, "close_area_bleeding": True, "delay": 1,
                       "invalid_limb_damage": -200, "head_lethal": True})
    if '"вторая жизнь"' in lower:
        direct.update({"cure_fracture": True, "restore_limb_health": 50, "close_area_bleeding": True,
                       "pain_delta": 5, "delay": 1})

    visible_fields = {
        "radiation_delta": "Радиация", "intoxication_delta": "Опьянение",
        "exhaustion_delta": "Истощение", "stress_delta": "Стресс", "pain_delta": "Боль",
        "action_points_delta": "ОД", "weight_delta": "Штраф к весу",
        "infection_delta": "Заражение", "temperature_delta": "Температура",
        "strength_delta": "Сила", "accuracy_delta": "Точность", "will_delta": "Воля",
        "psy_delta": "Пси-состояние", "rest_heal_multiplier": "Лечение на отдыхе x",
        "nutrition": "Закрывает потребность в еде", "bleeding_modifier_delta": "Тяжесть кровотечений",
        "hp": "Здоровье", "hp_per_turn": "Здоровье за ход", "restore_limb_health": "Здоровье части тела",
        "action_points_cost": "Стоимость ОД", "fracture_splint": "Лечение перелома",
        "cure_fracture": "Излечивает перелом", "close_area_bleeding": "Закрывает кровотечения в части тела",
        "blood_collection": "Создаёт пакет крови", "stop_all_bleeding": "Останавливает все кровотечения",
        "satisfy_sleep": "Закрывает потребность во сне", "radiation_filter_percent": "Защита от входящей радиации %",
    }
    existing_names = {str(item.get("name") or "") for item in profile["effects"]}
    for key, label in visible_fields.items():
        if key not in direct:
            continue
        value = direct[key]
        name = label if isinstance(value, bool) else f"{label} {value:g}" if isinstance(value, (int, float)) else label
        if name not in existing_names:
            profile["effects"].append(_effect("generic", value if isinstance(value, (int, float)) else 0,
                                              name=name, source="direct", tick="manual"))
            existing_names.add(name)
    if direct.get("applications") and "Выбор конкретной травмы" not in existing_names:
        profile["effects"].append(_effect("generic", 0, name="Выбор конкретной травмы", source="direct", tick="manual"))
    elif direct.get("requires_injury") and "Требует выбрать травму" not in existing_names:
        profile["effects"].append(_effect("generic", 0, name="Требует выбрать травму", source="direct", tick="manual"))
