"""Permanently remove soft-deleted lobbies with no active world entities.

Run from the project root with ``python -m scripts.purge_inactive_lobbies``
for a dry run. Add ``--apply --expected-ids 1,2,3`` to confirm the exact set
of inactive lobbies inspected immediately before deletion.
"""

import argparse

from sqlalchemy import bindparam, text

from app import create_app
from app.extensions import db
from app.models import Lobby


SAFE_CHILD_TABLES = (
    'map_chunks',
    'lobby_participants',
    'game_states',
    'chat_messages',
    'lobby_item_templates',
    'lobby_characters',
)
REFUSE_IF_PRESENT = (
    'locations',
    'world_groups',
    'world_map_events',
    'world_travel_events',
)


def _count(table, ids):
    query = text(f'SELECT count(*) FROM {table} WHERE lobby_id IN :ids').bindparams(
        bindparam('ids', expanding=True),
    )
    return db.session.execute(query, {'ids': ids}).scalar_one()


def purge_inactive_lobbies(expected_ids=None, apply=False):
    ids = sorted(row.id for row in Lobby.query.filter_by(is_active=False).all())
    counts = {table: _count(table, ids) for table in SAFE_CHILD_TABLES + REFUSE_IF_PRESENT} if ids else {}
    if not apply:
        return ids, counts
    if expected_ids is None or ids != sorted(expected_ids):
        raise ValueError('Inactive lobby IDs changed; run the dry run again')
    if any(counts[table] for table in REFUSE_IF_PRESENT):
        raise ValueError('Some inactive lobbies contain locations or world entities; no data was deleted')

    for table in SAFE_CHILD_TABLES:
        query = text(f'DELETE FROM {table} WHERE lobby_id IN :ids').bindparams(
            bindparam('ids', expanding=True),
        )
        db.session.execute(query, {'ids': ids})
    if ids:
        db.session.execute(
            text('DELETE FROM lobbies WHERE id IN :ids AND is_active IS FALSE').bindparams(
                bindparam('ids', expanding=True),
            ), {'ids': ids},
        )
    db.session.commit()
    return ids, counts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-ids', help='Comma-separated IDs printed by the dry run')
    args = parser.parse_args()
    expected_ids = [int(value) for value in args.expected_ids.split(',')] if args.expected_ids else None
    app = create_app()
    with app.app_context():
        ids, counts = purge_inactive_lobbies(expected_ids=expected_ids, apply=args.apply)
        print(f'Inactive lobby IDs: {ids}')
        print(f'Child rows: {counts}')
        print('Deleted.' if args.apply else 'Dry run only; nothing deleted.')


if __name__ == '__main__':
    main()
