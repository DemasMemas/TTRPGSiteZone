from unittest.mock import patch

from app.utils.dice import roll_dice


def test_roll_dice_accepts_implicit_single_die_and_spaces():
    with patch("app.utils.dice.random.randint", return_value=7) as randint:
        total, description = roll_dice(" d20 + 3 ")

    assert total == 10
    assert "1d20+3" in description
    randint.assert_called_once_with(1, 20)


def test_roll_dice_sums_all_rolls_and_negative_modifier():
    with patch("app.utils.dice.random.randint", side_effect=[4, 5]):
        total, description = roll_dice("2d6-2")

    assert total == 7
    assert "4+5-2" in description


def test_roll_dice_rejects_invalid_expression():
    total, message = roll_dice("fireball")

    assert total is None
    assert message


def test_roll_dice_rejects_non_positive_dice_count():
    total, message = roll_dice("0d6")

    assert total is None
    assert message
