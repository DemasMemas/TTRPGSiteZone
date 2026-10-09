from importlib import import_module

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import JSON, Column, Integer, MetaData, String, Table, create_engine, select

from app.services.addictions import resolve_addiction_profile


def test_legacy_addictions_are_frozen_without_overwriting_custom_profiles():
    migration = import_module('migrations.versions.e4f5a6b7c8d9_freeze_consumable_addictions')
    engine = create_engine('sqlite://')
    metadata = MetaData()
    templates = Table(
        'item_templates', metadata,
        Column('id', Integer, primary_key=True),
        Column('name', String),
        Column('category', String),
        Column('price', Integer),
        Column('attributes', JSON),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(templates.insert(), [
            {'id': 1, 'name': 'Водка', 'category': 'consumable', 'price': 500,
             'attributes': {'consumable': {'direct': {}}}},
            {'id': 2, 'name': 'Бинт', 'category': 'consumable', 'price': 50,
             'attributes': {'consumable': {'direct': {}}}},
            {'id': 3, 'name': 'Мой препарат', 'category': 'consumable', 'price': 100,
             'attributes': {'catalog_name': 'Водка', 'consumable': {'direct': {}, 'addiction': None}}},
            {'id': 4, 'name': 'Без профиля', 'category': 'consumable', 'price': 100,
             'attributes': {}},
        ])
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            migration.upgrade()
        rows = {row.id: row for row in connection.execute(select(templates)).all()}
        vodka = rows[1].attributes['consumable']
        assert rows[1].attributes['catalog_name'] == 'Водка'
        assert vodka['addiction']['key'] == 'alcohol'
        assert rows[2].attributes['consumable']['addiction'] is None
        assert rows[3].attributes['consumable']['addiction'] is None
        assert rows[4].attributes == {}
        connection.execute(templates.update().where(templates.c.id == 1).values(name='Новое имя'))
        renamed = connection.execute(select(templates).where(templates.c.id == 1)).one()
        assert resolve_addiction_profile(
            renamed.attributes['consumable'], renamed.attributes['catalog_name'], renamed.price,
        )['key'] == 'alcohol'
    engine.dispose()
