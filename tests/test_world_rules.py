from app.services.world_rules import (
    anomaly_field_catalog,
    artifact_catalog,
    guaranteed_artifact_class,
    mutant_catalog,
    mutant_character_data,
    mutant_profile,
    random_artifact,
    roll_artifact_class,
)


def test_world_rule_catalogs_match_workbook_counts():
    assert len(anomaly_field_catalog()) == 24
    assert len(artifact_catalog()) == 95
    assert len(mutant_catalog()) == 16
    assert anomaly_field_catalog()[0]['name'] == 'Батутный комплекс'
    assert mutant_catalog()[0]['name'] == 'Слепыш'


def test_artifact_class_depends_on_field_rank_and_roll():
    assert guaranteed_artifact_class(1) == 'trash'
    assert guaranteed_artifact_class(4) == '3'
    assert roll_artifact_class(1, random_value=0.74) == 'trash'
    assert roll_artifact_class(1, random_value=0.75) == '1'
    assert roll_artifact_class(4, random_value=0.74) == '3'
    assert roll_artifact_class(4, random_value=0.75) == 'x'


def test_random_artifact_prefers_matching_anomaly_type():
    artifact = random_artifact('trash', 'Гравитационное', chooser=lambda values: values[0])
    assert artifact is not None
    assert artifact['artifact_class'] == 'trash'
    assert artifact['anomaly_type'].casefold().startswith('гравит')


def test_mutant_character_uses_rulebook_health_skills_and_attacks():
    profile = mutant_profile('Собака')
    data = mutant_character_data(profile)

    assert data['health']['max'] == 200
    assert data['health']['zones']['leftArm']['max'] == 25
    assert data['health']['zones']['chest']['max'] == 50
    assert data['skills']['physical']['agility']['base'] == 14
    assert data['mutant']['physical_protection'] == 10
    assert data['weapons'][0]['attributes']['damage'] == 80
    assert data['weapons'][0]['attributes']['armor_piercing'] == 10
    assert data['weapons'][0]['attributes']['action_points'] == 2
    assert data['weapons'][0]['attributes']['skip_strength_scaling'] is True


def test_mature_mutant_variant_changes_protection_zones_and_attacks():
    dog = mutant_profile('Собака')
    base = mutant_character_data(dog)
    mature = mutant_character_data(dog, 'Матерый пёс')

    assert mature['mutant']['physical_protection'] == base['mutant']['physical_protection'] + 10
    assert mature['health']['zones']['head']['max'] == base['health']['zones']['head']['max'] + 15
    assert mature['weapons'][0]['attributes']['damage'] == base['weapons'][0]['attributes']['damage'] + 10
    assert mature['weapons'][0]['attributes']['armor_piercing'] == base['weapons'][0]['attributes']['armor_piercing'] + 10
