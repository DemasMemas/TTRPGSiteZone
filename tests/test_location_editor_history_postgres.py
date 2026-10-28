"""Run the editor API regressions against real PostgreSQL JSON columns.

Set VTT_TEST_POSTGRES_URL explicitly. Each run uses a unique temporary schema;
application tables outside that schema are never created, changed or dropped.
"""
import os
import uuid

import pytest
from sqlalchemy import create_engine, text

from app import create_app
from app.config import TestingConfig
from app.extensions import db
from test_location_editor_history import (
    editor,
    test_atomic_mixed_group_restore_and_revision_conflict,
    test_decor_conflict_does_not_commit_any_other_changes,
    test_lamp_history_keeps_other_settings_and_detects_foreign_lamp,
    test_history_endpoint_is_gm_only_and_rejects_duplicate_ids,
    test_mixed_cell_patch_restores_absent_fields_and_precise_state,
    test_overlapping_cell_conflict_rolls_back_objects_darkness_and_other_cells,
    test_darkness_cells_preserve_disjoint_foreign_paint_and_conflict_atomically,
    test_environment_history_preserves_lamps_and_rejects_stale_preview,
    test_invalid_cell_patch_is_not_committed,
)


@pytest.fixture(scope='module')
def postgres_schema():
    url = os.environ.get('VTT_TEST_POSTGRES_URL')
    if not url:
        pytest.skip('VTT_TEST_POSTGRES_URL is not configured')
    engine = create_engine(url, connect_args={'connect_timeout': 5})
    assert engine.dialect.name == 'postgresql'
    schema = 'test_loc_history_' + uuid.uuid4().hex
    try:
        with engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        yield url, schema
    finally:
        # schema consists only of a fixed test prefix and a generated UUID.
        with engine.begin() as connection:
            connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        engine.dispose()


@pytest.fixture
def app(postgres_schema, monkeypatch):
    url, schema = postgres_schema
    monkeypatch.setattr(TestingConfig, 'SQLALCHEMY_DATABASE_URI', url)
    monkeypatch.setattr(TestingConfig, 'SQLALCHEMY_ENGINE_OPTIONS', {
        'connect_args': {'options': f'-csearch_path={schema}', 'connect_timeout': 5},
    }, raising=False)
    test_app = create_app('testing')
    with test_app.app_context():
        # Verify isolation before entering any block that can drop tables.
        assert db.session.execute(text('SELECT current_schema()')).scalar() == schema
        assert all(table.schema in (None, schema) for table in db.metadata.tables.values())
        try:
            db.create_all()
            yield test_app
        finally:
            db.session.remove()
            db.drop_all()
            db.engine.dispose()
