from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import JSON, Column, Integer, MetaData, String, Table, create_engine, select

from app.services.consumable_importer import _canonical_consumable_name
from app.services.consumable_importer import upsert_consumable_templates
from app.extensions import db
from app.models.templates import ItemTemplate


def test_old_mul_name_is_canonicalized_during_import():
    assert _canonical_consumable_name("Стимулятор Мул") == "Стимулятор Бык"
    assert _canonical_consumable_name("Стимулятор Варвар") == "Стимулятор Варвар"


def test_rename_migration_updates_templates_and_stored_items():
    migration = import_module("migrations.versions.e2f3a4b5c6d7_rename_mul_stimulant")
    engine = create_engine("sqlite://")
    metadata = MetaData()
    templates = Table(
        "item_templates", metadata,
        Column("id", Integer, primary_key=True),
        Column("name", String),
    )
    characters = Table(
        "lobby_characters", metadata,
        Column("id", Integer, primary_key=True),
        Column("data", JSON),
    )
    metadata.create_all(engine)

    with engine.begin() as connection:
        connection.execute(templates.insert().values(id=1, name="Стимулятор Мул"))
        connection.execute(characters.insert().values(
            id=1,
            data={"inventory": {"backpack": [{"name": "Стимулятор Мул"}]}},
        ))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert connection.execute(select(templates.c.name)).scalar_one() == "Стимулятор Бык"
            stored = connection.execute(select(characters.c.data)).scalar_one()
            assert stored["inventory"]["backpack"][0]["name"] == "Стимулятор Бык"

            migration.downgrade()
            assert connection.execute(select(templates.c.name)).scalar_one() == "Стимулятор Мул"

    engine.dispose()


def test_catalog_reimport_preserves_renamed_official_template(client, monkeypatch):
    profile = {"direct": {"stress_delta": -2}, "effects": [], "modifiers": []}
    item = ItemTemplate(
        name="Моё название", category="consumable", subcategory="Стимуляторы",
        description="-2 стресса", price=100,
        attributes={"section": "Стимуляторы", "source_order": 0,
                    "raw_description": "-2 стресса", "consumable": profile},
    )
    db.session.add(item)
    db.session.commit()
    data = {
        "name": "Официальное название", "category": "consumable", "subcategory": "Стимуляторы",
        "item_class": None, "description": "-2 стресса", "price": 100,
        "weight": 0.0, "volume": 0.0, "compatible_ids": [],
        "attributes": {"section": "Стимуляторы", "source_order": 0,
                       "raw_description": "-2 стресса", "catalog_name": "Официальное название",
                       "consumable": profile},
    }
    monkeypatch.setattr(
        "app.services.consumable_importer.parse_consumable_templates_v2", lambda path: [data],
    )
    first = upsert_consumable_templates("unused.xlsx")
    second = upsert_consumable_templates("unused.xlsx")
    assert first["inserted"] == second["inserted"] == 0
    assert db.session.get(ItemTemplate, item.id).name == "Моё название"
    assert db.session.get(ItemTemplate, item.id).attributes["catalog_name"] == "Официальное название"
