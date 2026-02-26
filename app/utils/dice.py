# app/utils/dice.py
import random
import re


def roll_dice(expression):
    """
    Парсит выражение вида 2d6+3, 1d20, d8 и т.д.
    Возвращает кортеж (результат, описание_броска)
    """
    expression = expression.replace(' ', '').lower()
    # Регулярное выражение для разбора: число d число (опционально +- число)
    match = re.match(r'^(\d*)d(\d+)([+-]\d+)?$', expression)
    if not match:
        return None, "Неверный формат. Используйте /roll 2d6+3"

    num_dice = int(match.group(1)) if match.group(1) else 1
    dice_type = int(match.group(2))
    modifier = int(match.group(3)) if match.group(3) else 0

    if num_dice <= 0 or dice_type <= 0:
        return None, "Количество и тип кубиков должны быть положительными"

    rolls = [random.randint(1, dice_type) for _ in range(num_dice)]
    total = sum(rolls) + modifier
    rolls_str = '+'.join(map(str, rolls))
    if modifier:
        rolls_str = f"{rolls_str}{modifier:+d}"

    return total, f"Бросок {num_dice}d{dice_type}{modifier:+d}: {rolls_str} = **{total}**"