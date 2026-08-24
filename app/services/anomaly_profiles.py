"""Rule profiles for sublocation anomalies from the world rulebook."""


ANOMALY_PROFILES = {
    # Gravity
    "batut": {"name": "Батут", "category": "gravity", "rank": 1, "dc": 12, "fall_height": 9},
    "otboynik": {"name": "Отбойник", "category": "gravity", "rank": 1, "dc": 14, "damage": 200},
    "kacheli": {"name": "Качели", "category": "gravity", "rank": 2, "dc": 14, "fall_height": 12},
    "zybuchka": {"name": "Зыбучка", "category": "gravity", "rank": 2, "dc": 15, "damage": 50, "radiation": 10, "cannot_help": True},
    "vozduhovorot": {"name": "Воздуховорот", "category": "gravity", "rank": 3, "dc": 11, "damage": 350},
    "glukhar": {"name": "Глухарь", "category": "gravity", "rank": 3, "dc": 12, "damage": 10, "zone": "head", "pain": 2, "escalating_damage": 5},
    "britva": {"name": "Бритва", "category": "gravity", "rank": 4, "dc": 13, "damage": 400, "bleeding": {"stage": "extreme", "kind": "external"}, "ejects": True},
    "viselitsa": {"name": "Виселица", "category": "gravity", "rank": 4, "dc": 14, "damage": 10, "zone": "head", "pain": 2, "escalating_damage": 5},

    # Electric
    "vspishka": {"name": "Вспышка", "category": "electric", "rank": 1, "dc": 13, "damage": 200},
    "pautina": {"name": "Паутина", "category": "electric", "rank": 1, "dc": 11, "damage": 250, "unit_damage": 25, "max_hits": 10, "damage_note": "25 за нить, до 10 нитей"},
    "tesla": {"name": "Тесла", "category": "electric", "rank": 2, "dc": 13, "damage": 300, "unit_damage": 75, "max_hits": 4, "damage_note": "75 за шар, до 4 шаров"},
    "katushka": {"name": "Катушка", "category": "electric", "rank": 2, "dc": 12, "damage": 25, "pain": 1, "doubling_damage": True, "third_round_damage": 200},
    "kapkan": {"name": "Капкан", "category": "electric", "rank": 3, "dc": 11, "damage": 200, "secondary_dc": 14, "secondary_damage": 300},
    "paralizator": {"name": "Парализатор", "category": "electric", "rank": 3, "dc": 13, "damage": 100, "exit_damage": 250},
    "akkumulyator": {"name": "Аккумулятор", "category": "electric", "rank": 4, "dc": 14, "damage": 250, "save_skill": "agility", "grounding_only": True},
    "ionny_tuman": {"name": "Ионный туман", "category": "electric", "rank": 4, "dc": 15, "damage": 100, "movement_damage": {"walk": 200, "run": 300, "sprint": 400}},

    # Thermal
    "banya": {"name": "Баня", "category": "thermal", "rank": 1, "dc": 12, "damage": 200},
    "parilka": {"name": "Парилка", "category": "thermal", "rank": 1, "dc": 10, "damage": 300},
    "mochalka": {"name": "Мочалка", "category": "thermal", "rank": 2, "dc": 14, "damage": 200, "armor_damage_multiplier": 2},
    "kipyatilnik": {"name": "Кипятильник", "category": "thermal", "rank": 2, "dc": 16, "damage": 100, "escalating_damage": 100, "temperature": 2},
    "morozilnik": {"name": "Морозильник", "category": "thermal", "rank": 3, "dc": 16, "damage": 150, "escalating_damage": 150, "temperature": -2},
    "uley": {"name": "Улей", "category": "thermal", "rank": 3, "dc": 13, "damage": 150, "escalating_damage": 200, "armor_damage_multiplier": 2},
    "metelitsa": {"name": "Метелица", "category": "thermal", "rank": 4, "dc": 18, "damage": 150, "escalating_damage": 150, "temperature": -3},
    "gril": {"name": "Гриль", "category": "thermal", "rank": 4, "dc": 15, "damage": 350},

    # Radiation
    "zarosli": {"name": "Заросли", "category": "radiation", "rank": 1, "dc": 12, "radiation": 10},
    "svetlyachki": {"name": "Светлячки", "category": "radiation", "rank": 1, "dc": 14, "radiation": 6},
    "mor": {"name": "Мор", "category": "radiation", "rank": 2, "dc": 13, "radiation": 15},
    "zapovednik": {"name": "Заповедник", "category": "radiation", "rank": 2, "dc": 15, "radiation": 10, "pain": 2},
    "mertvy_koster": {"name": "Мертвый костер", "category": "radiation", "rank": 3, "dc": 12, "radiation": 25},
    "solyariy": {"name": "Солярий", "category": "radiation", "rank": 3, "dc": 14, "radiation": 15, "exhaustion": 1},
    "radioaktivny_roy": {"name": "Радиоактивный рой", "category": "radiation", "rank": 4, "dc": 18, "radiation": 10},
    "bagrovaya_luna": {"name": "Багровая луна", "category": "radiation", "rank": 4, "dc": 16, "radiation": 20, "pain": 2},

    # Chemical
    "varevo": {"name": "Варево", "category": "chemical", "rank": 1, "dc": 12, "damage": 200},
    "soda": {"name": "Сода", "category": "chemical", "rank": 1, "dc": 10, "damage": 250, "armor_damage_multiplier": 2},
    "ezhinoe_oblako": {"name": "Ежиное облако", "category": "chemical", "rank": 2, "dc": 14, "damage": 250},
    "rzhavchina": {"name": "Ржавчина", "category": "chemical", "rank": 2, "dc": 14, "damage": 100, "armor_damage_multiplier": 4, "weapon_damage_multiplier": 4},
    "mogilshchik": {"name": "Могильщик", "category": "chemical", "rank": 3, "dc": 13, "pain": 2, "exhaustion": 1},
    "chuma": {"name": "Чума", "category": "chemical", "rank": 3, "dc": 14, "damage": 200, "exhaustion": 1, "bleeding": {"stage": "severe", "kind": "internal"}},
    "myshelovka": {"name": "Мышеловка", "category": "chemical", "rank": 4, "dc": 11, "damage": 350},
    "gniloy_razlom": {"name": "Гнилой разлом", "category": "chemical", "rank": 4, "dc": 16, "damage": 300},

    # Psionic
    "ekho": {"name": "Эхо", "category": "psi", "rank": 1, "dc": 12, "psi": 10, "psi_noisy": 15},
    "mirazh": {"name": "Мираж", "category": "psi", "rank": 1, "dc": 16, "psi": 5},
    "starshina": {"name": "Старшина", "category": "psi", "rank": 2, "dc": 14, "psi": 15, "psi_noisy": 5, "harmful_action_on_failure": True},
    "tuman_poteryannykh": {"name": "Туман потерянных", "category": "psi", "rank": 2, "dc": 15, "psi": 5, "will_penalty": 4},
    "tma": {"name": "Тьма", "category": "psi", "rank": 3, "dc": 15, "psi": 10, "blindness": 100},
    "piyavka": {"name": "Пиявка", "category": "psi", "rank": 3, "dc": 16, "psi": 15},
    "kolodets": {"name": "Колодец", "category": "psi", "rank": 4, "dc": 18, "psi": 15},
    "mozgotrobilka": {"name": "Мозгодробилка", "category": "psi", "rank": 4, "dc": 16, "psi": 25, "psi_eyes_closed": 20},
}


ANOMALY_CATEGORY_VISUALS = {
    "gravity": "void",
    "electric": "electric",
    "thermal": "fire",
    "radiation": "radiation",
    "chemical": "acid",
    "psi": "psi",
}

# Keep display names ASCII-safe in source. The workbook was once imported through
# a legacy Windows console, so overriding them here prevents mojibake in API data.
ANOMALY_NAMES = {
    "batut": "\u0411\u0430\u0442\u0443\u0442", "otboynik": "\u041e\u0442\u0431\u043e\u0439\u043d\u0438\u043a",
    "kacheli": "\u041a\u0430\u0447\u0435\u043b\u0438", "zybuchka": "\u0417\u044b\u0431\u0443\u0447\u043a\u0430",
    "vozduhovorot": "\u0412\u043e\u0437\u0434\u0443\u0445\u043e\u0432\u043e\u0440\u043e\u0442", "glukhar": "\u0413\u043b\u0443\u0445\u0430\u0440\u044c",
    "britva": "\u0411\u0440\u0438\u0442\u0432\u0430", "viselitsa": "\u0412\u0438\u0441\u0435\u043b\u0438\u0446\u0430",
    "vspishka": "\u0412\u0441\u043f\u044b\u0448\u043a\u0430", "pautina": "\u041f\u0430\u0443\u0442\u0438\u043d\u0430",
    "tesla": "\u0422\u0435\u0441\u043b\u0430", "katushka": "\u041a\u0430\u0442\u0443\u0448\u043a\u0430",
    "kapkan": "\u041a\u0430\u043f\u043a\u0430\u043d", "paralizator": "\u041f\u0430\u0440\u0430\u043b\u0438\u0437\u0430\u0442\u043e\u0440",
    "akkumulyator": "\u0410\u043a\u043a\u0443\u043c\u0443\u043b\u044f\u0442\u043e\u0440", "ionny_tuman": "\u0418\u043e\u043d\u043d\u044b\u0439 \u0442\u0443\u043c\u0430\u043d",
    "banya": "\u0411\u0430\u043d\u044f", "parilka": "\u041f\u0430\u0440\u0438\u043b\u043a\u0430",
    "mochalka": "\u041c\u043e\u0447\u0430\u043b\u043a\u0430", "kipyatilnik": "\u041a\u0438\u043f\u044f\u0442\u0438\u043b\u044c\u043d\u0438\u043a",
    "morozilnik": "\u041c\u043e\u0440\u043e\u0437\u0438\u043b\u044c\u043d\u0438\u043a", "uley": "\u0423\u043b\u0435\u0439",
    "metelitsa": "\u041c\u0435\u0442\u0435\u043b\u0438\u0446\u0430", "gril": "\u0413\u0440\u0438\u043b\u044c",
    "zarosli": "\u0417\u0430\u0440\u043e\u0441\u043b\u0438", "svetlyachki": "\u0421\u0432\u0435\u0442\u043b\u044f\u0447\u043a\u0438",
    "mor": "\u041c\u043e\u0440", "zapovednik": "\u0417\u0430\u043f\u043e\u0432\u0435\u0434\u043d\u0438\u043a",
    "mertvy_koster": "\u041c\u0435\u0440\u0442\u0432\u044b\u0439 \u043a\u043e\u0441\u0442\u0435\u0440", "solyariy": "\u0421\u043e\u043b\u044f\u0440\u0438\u0439",
    "radioaktivny_roy": "\u0420\u0430\u0434\u0438\u043e\u0430\u043a\u0442\u0438\u0432\u043d\u044b\u0439 \u0440\u043e\u0439", "bagrovaya_luna": "\u0411\u0430\u0433\u0440\u043e\u0432\u0430\u044f \u043b\u0443\u043d\u0430",
    "varevo": "\u0412\u0430\u0440\u0435\u0432\u043e", "soda": "\u0421\u043e\u0434\u0430",
    "ezhinoe_oblako": "\u0415\u0436\u0438\u043d\u043e\u0435 \u043e\u0431\u043b\u0430\u043a\u043e", "rzhavchina": "\u0420\u0436\u0430\u0432\u0447\u0438\u043d\u0430",
    "mogilshchik": "\u041c\u043e\u0433\u0438\u043b\u044c\u0449\u0438\u043a", "chuma": "\u0427\u0443\u043c\u0430",
    "myshelovka": "\u041c\u044b\u0448\u0435\u043b\u043e\u0432\u043a\u0430", "gniloy_razlom": "\u0413\u043d\u0438\u043b\u043e\u0439 \u0440\u0430\u0437\u043b\u043e\u043c",
    "ekho": "\u042d\u0445\u043e", "mirazh": "\u041c\u0438\u0440\u0430\u0436",
    "starshina": "\u0421\u0442\u0430\u0440\u0448\u0438\u043d\u0430", "tuman_poteryannykh": "\u0422\u0443\u043c\u0430\u043d \u043f\u043e\u0442\u0435\u0440\u044f\u043d\u043d\u044b\u0445",
    "tma": "\u0422\u044c\u043c\u0430", "piyavka": "\u041f\u0438\u044f\u0432\u043a\u0430",
    "kolodets": "\u041a\u043e\u043b\u043e\u0434\u0435\u0446", "mozgotrobilka": "\u041c\u043e\u0437\u0433\u043e\u0434\u0440\u043e\u0431\u0438\u043b\u043a\u0430",
}
for _key, _name in ANOMALY_NAMES.items():
    ANOMALY_PROFILES[_key]["name"] = _name


def anomaly_profile(key):
    return ANOMALY_PROFILES.get(str(key or "").strip().lower())


def anomaly_catalog():
    return [
        {"key": key, **profile, "visual": ANOMALY_CATEGORY_VISUALS[profile["category"]]}
        for key, profile in ANOMALY_PROFILES.items()
    ]
