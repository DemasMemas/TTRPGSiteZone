def empty_dict():
    return {}


def empty_list():
    return []


def default_weather_settings():
    return {
        'sun': {'enabled': True, 'intensity': 0.7},
        'fog': {'enabled': False, 'intensity': 0.5},
        'rain': {'enabled': False, 'intensity': 0.5},
        'emission': {'enabled': False, 'intensity': 0.5},
    }


def default_hp_zones():
    return {
        'head': {'current': 50, 'max': 50},
        'chest': {'current': 150, 'max': 150},
        'abdomen': {'current': 120, 'max': 120},
        'left_arm': {'current': 90, 'max': 90},
        'right_arm': {'current': 90, 'max': 90},
        'left_leg': {'current': 100, 'max': 100},
        'right_leg': {'current': 100, 'max': 100},
    }


def default_combat_resources():
    return {
        'action_points': 5,
        'free_actions': 1,
        'movement_points': 6,
    }
