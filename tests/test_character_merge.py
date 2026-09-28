import pytest
from app.services.character_merge import merge_sheet_data
from app.services.exceptions import ConflictError


@pytest.mark.parametrize('base,edited,current,expected', [
    ({'a': 1, 'b': 2}, {'a': 3, 'b': 2}, {'a': 1, 'b': 4}, {'a': 3, 'b': 4}),
    ({'a': 1}, {}, {'a': 1, 'b': 2}, {'b': 2}),
    ({}, {'health': {'pain': 1}}, {'health': {'hp': 90}}, {'health': {'pain': 1, 'hp': 90}}),
    ({'items': [1]}, {'items': []}, {'items': [1]}, {'items': []}),
    ({'a': None}, {'a': 2}, {'a': 2}, {'a': 2}),
])
def test_merge_preserves_independent_changes(base, edited, current, expected):
    assert merge_sheet_data(base, edited, current) == expected


@pytest.mark.parametrize('base,edited,current', [
    ({'a': 1}, {}, {'a': 2}),
    ({'a': 1}, {'a': 2}, {}),
    ({'items': [1, 2]}, {'items': [1]}, {'items': [2]}),
    ({'a': 1}, {'a': {'b': 1}}, {'a': 2}),
])
def test_merge_rejects_overlapping_changes(base, edited, current):
    with pytest.raises(ConflictError):
        merge_sheet_data(base, edited, current)


@pytest.mark.parametrize('module,table', [
    ('a8b9c0d1e2f3_add_character_revision', 'lobby_characters'),
    ('b9c0d1e2f3a4_add_object_revision', 'location_objects'),
])
def test_revision_migration_preserves_existing_rows(module, table):
    from importlib import import_module
    from sqlalchemy import create_engine, text
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    migration = import_module(f'migrations.versions.{module}')
    engine = create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text(f'CREATE TABLE {table} (id INTEGER PRIMARY KEY, name VARCHAR(100))'))
        connection.execute(text(f"INSERT INTO {table} (id, name) VALUES (1, 'Existing')"))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert connection.execute(text(f'SELECT name, revision FROM {table}')).one() == ('Existing', 1)
            migration.downgrade()
            assert connection.execute(text(f'SELECT name FROM {table}')).scalar_one() == 'Existing'
    engine.dispose()
