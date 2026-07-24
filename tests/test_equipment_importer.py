from app.services.equipment_importer import (
    _parse_burst_profile,
    _parse_ranged_weapons,
)


def test_dash_disables_all_automatic_fire_modes():
    profile = _parse_burst_profile("-")

    assert profile["single_shot_options"] == [1]
    assert profile["supports_burst"] is False
    assert profile["supports_suppression"] is False
    assert profile["supports_area_fire"] is False


def test_duplex_is_a_single_fire_option_not_a_burst():
    profile = _parse_burst_profile("Дуплет(Одиночный - 2 выстрела)")

    assert profile["single_shot_options"] == [1, 2]
    assert profile["duplex_size"] == 2
    assert profile["burst_size"] is None
    assert profile["supports_burst"] is False


def test_combined_duplex_and_burst_retains_both_modes():
    profile = _parse_burst_profile("Дуплет(Одиночный - 2 выстрела), Очередь 4")

    assert profile["single_shot_options"] == [1, 2]
    assert profile["burst_size"] == 4
    assert profile["supports_burst"] is True
    assert profile["supports_suppression"] is True
    assert profile["supports_area_fire"] is True


def test_machine_gun_uses_variable_burst_length():
    profile = _parse_burst_profile("Пулеметная. Без штрафа")

    assert profile["machine_gun_burst"] is True
    assert profile["burst_size"] is None
    assert profile["supports_burst"] is True


def test_ranged_weapon_keeps_fractional_and_textual_characteristics():
    rows = [
        {"B": "Пистолеты"},
        {
            "B": "Тестовый пистолет",
            "C": "2(1 в одном)",
            "D": "1",
            "E": "2",
            "F": "9 * 18",
            "G": "8",
            "H": "75",
            "I": "Дуплет(Одиночный - 2 выстрела)",
            "J": "50",
            "K": "100",
            "L": "5",
            "M": "0.5",
            "N": "6",
            "O": "1 500",
            "P": "2",
            "Q": "1",
        },
    ]

    weapon = _parse_ranged_weapons(rows)[0]

    assert weapon["price"] == 1500
    assert weapon["weight"] == 0.5
    assert weapon["attributes"]["magazine_size"] == 2
    assert weapon["attributes"]["magazine_size_raw"] == "2(1 в одном)"
    assert weapon["attributes"]["fire_modes"]["single_shot_options"] == [1, 2]
