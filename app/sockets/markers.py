# app/sockets/markers.py
import logging
import uuid
from datetime import datetime, timezone
from flask import request
from flask_socketio import emit
from sqlalchemy.orm.attributes import flag_modified
from app.extensions import socketio, db
from app.models import LobbyParticipant, GameState, Lobby
from .utils import get_user_from_token

logger = logging.getLogger(__name__)

# ========== Вспомогательные функции для работы с маршрутами ==========
def reorder_route_points(markers, route_id, new_order, exclude_id=None):
    changed_ids = []
    for m in markers:
        if (m.get('type') == 'route_point' and
            m.get('routeId') == route_id and
            m.get('id') != exclude_id and
            m.get('routeOrder', 0) >= new_order):
            m['routeOrder'] = m.get('routeOrder', 0) + 1
            changed_ids.append(m['id'])
    return changed_ids

def compact_route_points(markers, route_id, exclude_id=None):
    points = [m for m in markers
              if m.get('type') == 'route_point'
              and m.get('routeId') == route_id
              and m.get('id') != exclude_id]
    points.sort(key=lambda x: x.get('routeOrder', 0))
    changed_ids = []
    for idx, m in enumerate(points):
        expected = idx + 1
        if m.get('routeOrder') != expected:
            m['routeOrder'] = expected
            changed_ids.append(m['id'])
    return changed_ids

def marker_recipient_ids(lobby_id):
    lobby = db.session.get(Lobby, lobby_id)
    recipient_ids = {
        participant.user_id
        for participant in LobbyParticipant.query.filter_by(lobby_id=lobby_id, is_banned=False).all()
    }
    if lobby:
        recipient_ids.add(lobby.gm_id)
    return recipient_ids


def emit_marker_added(marker, lobby_id):
    for user_id in marker_recipient_ids(lobby_id):
        if can_see_marker(user_id, lobby_id, marker):
            emit('marker_added', marker, room=f"user_{user_id}")


def emit_marker_updated(marker, lobby_id, updates):
    hidden_payload = {
        'id': marker.get('id'),
        'updates': {'visibleTo': marker.get('visibleTo', [])},
    }
    visible_payload = {
        'id': marker.get('id'),
        'updates': updates,
        'marker': marker,
    }
    for user_id in marker_recipient_ids(lobby_id):
        payload = visible_payload if can_see_marker(user_id, lobby_id, marker) else hidden_payload
        emit('marker_updated', payload, room=f"user_{user_id}")


def emit_route_point_updates(markers, lobby_id, marker_ids):
    for marker_id in marker_ids:
        updated_marker = next((m for m in markers if m.get('id') == marker_id), None)
        if updated_marker:
            emit_marker_updated(updated_marker, lobby_id, {
                'routeId': updated_marker.get('routeId'),
                'routeOrder': updated_marker.get('routeOrder'),
            })

def can_edit_marker(user_id, lobby_id, marker):
    lobby = Lobby.query.get(lobby_id)
    if not lobby:
        return False
    if lobby.gm_id == user_id:
        return True
    created_by = marker.get('createdBy')
    can_edit = str(created_by) == str(user_id)
    logger.debug(f"can_edit_marker: user_id={user_id}, createdBy={created_by}, result={can_edit}")
    return can_edit

def can_see_marker(user_id, lobby_id, marker):
    lobby = Lobby.query.get(lobby_id)
    if lobby.gm_id == user_id:
        return True
    visible_to = marker.get('visibleTo', [])
    if not isinstance(visible_to, list):
        visible_to = [visible_to]
    normalized_visible_to = {str(value) for value in visible_to}
    if 'all' in normalized_visible_to:
        return True
    return str(user_id) in normalized_visible_to

def filter_markers_for_user(markers, user_id, lobby_id):
    return [m for m in markers if can_see_marker(user_id, lobby_id, m)]

def get_game_state(lobby_id):
    game_state = GameState.query.filter_by(lobby_id=lobby_id).first()
    if not game_state:
        game_state = GameState(lobby_id=lobby_id)
        db.session.add(game_state)
        db.session.commit()
    else:
        db.session.refresh(game_state)
    if 'markers' not in game_state.map_data:
        game_state.map_data['markers'] = []
        flag_modified(game_state, 'map_data')
        db.session.commit()
    return game_state

# ========== Обработчики событий ==========
@socketio.on('get_markers')
def handle_get_markers(data):
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    if not token or not lobby_id:
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    game_state = get_game_state(lobby_id)
    markers = game_state.map_data.get('markers', [])
    visible_markers = filter_markers_for_user(markers, user.id, lobby_id)
    emit('markers_list', visible_markers, room=request.sid)

@socketio.on('add_marker')
def handle_add_marker(data):
    logger.info(f"add_marker called with data: {data}")
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    marker_data = data.get('marker')
    if not all([token, lobby_id, marker_data]):
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
    if not participant or participant.is_banned:
        emit('error', {'message': 'Access denied'}, room=request.sid)
        return

    lobby = Lobby.query.get(lobby_id)
    is_gm = (lobby.gm_id == user.id)

    marker_type = marker_data.get('type')
    if not is_gm and marker_type in ['anomaly', 'route']:
        emit('error', {'message': 'Only GM can create this marker type'}, room=request.sid)
        return

    game_state = get_game_state(lobby_id)
    markers = game_state.map_data.get('markers', [])

    new_id = str(uuid.uuid4())
    while any(m.get('id') == new_id for m in markers):
        new_id = str(uuid.uuid4())

    new_marker = {
        'id': new_id,
        'type': marker_type,
        'name': marker_data.get('name', ''),
        'description': marker_data.get('description', ''),
        'position': marker_data.get('position', {'x': 0, 'y': 0, 'z': 0}),
        'color': marker_data.get('color', '#ffffff'),
        'visibleTo': marker_data.get('visibleTo', ['all'] if not is_gm else ['all']),
        'createdBy': user.id,
        'createdAt': datetime.now(timezone.utc).isoformat(),
        'routePoints': marker_data.get('routePoints', []),
        'routeId': marker_data.get('routeId'),
        'routeOrder': marker_data.get('routeOrder')
    }

    changed_ids = []  # ID маркеров, у которых изменился порядок
    # Если это точка маршрута, выполняем перенумерацию
    if marker_type == 'route_point' and new_marker.get('routeId') and new_marker.get('routeOrder') is not None:
        changed_ids = reorder_route_points(markers, new_marker['routeId'], new_marker['routeOrder'])

    try:
        markers.append(new_marker)
        game_state.map_data['markers'] = markers
        flag_modified(game_state, 'map_data')
        db.session.commit()
        logger.info(f"Marker {new_id} added by {user.username} in lobby {lobby_id}")

        # Отправляем новый маркер
        emit_marker_added(new_marker, lobby_id)

        # Отправляем обновления для затронутых маркеров
        for marker_id in changed_ids:
            # Находим обновлённый маркер (уже после коммита)
            updated_marker = next((m for m in markers if m['id'] == marker_id), None)
            if updated_marker:
                emit('marker_updated', {
                    'id': marker_id,
                    'updates': {'routeOrder': updated_marker['routeOrder']}
                }, room=f"lobby_{lobby_id}")
    except Exception as e:
        db.session.rollback()
        logger.exception("Failed to add marker")
        emit('error', {'message': 'Database error: ' + str(e)}, room=request.sid)

@socketio.on('update_marker')
def handle_update_marker(data):
    logger.info(f"update_marker called with data: {data}")
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    marker_id = data.get('marker_id')
    updates = data.get('updates')
    if not all([token, lobby_id, marker_id, updates]):
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
    if not participant or participant.is_banned:
        emit('error', {'message': 'Access denied'}, room=request.sid)
        return

    game_state = get_game_state(lobby_id)
    markers = game_state.map_data.get('markers', [])
    marker = next((m for m in markers if m.get('id') == marker_id), None)
    if not marker:
        emit('error', {'message': 'Marker not found'}, room=request.sid)
        return
    if not can_edit_marker(user.id, lobby_id, marker):
        emit('error', {'message': 'You cannot edit this marker'}, room=request.sid)
        return

    # Сохраняем старые значения для проверки изменений маршрута
    old_route_id = marker.get('routeId')
    old_order = marker.get('routeOrder')
    old_type = marker.get('type')

    allowed_fields = ['name', 'description', 'color', 'visibleTo', 'routePoints', 'type', 'position', 'routeId', 'routeOrder']
    for field in allowed_fields:
        if field in updates:
            marker[field] = updates[field]

    # Если это точка маршрута, выполняем корректировку порядка
    new_type = marker.get('type')
    new_route_id = marker.get('routeId')
    new_order = marker.get('routeOrder')

    # Сначала удаляем старую точку из старого маршрута (если была)
    changed_ids = []
    if old_type == 'route_point' and old_route_id:
        # Удаляем точку из старого маршрута (она всё ещё в markers, но мы её временно исключим из расчётов)
        # Сдвигаем точки с order > old_order на -1
        for m in markers:
            if (m.get('type') == 'route_point' and
                m.get('routeId') == old_route_id and
                m.get('id') != marker_id and
                m.get('routeOrder', 0) > old_order):
                m['routeOrder'] = m['routeOrder'] - 1
                changed_ids.append(m['id'])

    # Если теперь это точка маршрута и есть новый routeId
    if new_type == 'route_point' and new_route_id:
        # Вставляем в новый маршрут с новым order
        changed_ids.extend(reorder_route_points(markers, new_route_id, new_order, exclude_id=marker_id))

    # Упорядочиваем оба маршрута (старый и новый, если они разные)
    if old_type == 'route_point' and old_route_id and old_route_id != new_route_id:
        changed_ids.extend(compact_route_points(markers, old_route_id))
    if new_type == 'route_point' and new_route_id:
        changed_ids.extend(compact_route_points(markers, new_route_id))

    try:
        game_state.map_data['markers'] = markers
        flag_modified(game_state, 'map_data')
        db.session.commit()
        logger.info(f"Marker {marker_id} updated by {user.username} in lobby {lobby_id}")
        emit_marker_updated(marker, lobby_id, updates)
        emit_route_point_updates(markers, lobby_id, list(dict.fromkeys(changed_ids)))
    except Exception as e:
        db.session.rollback()
        logger.exception("Failed to update marker")
        emit('error', {'message': 'Database error: ' + str(e)}, room=request.sid)

@socketio.on('move_marker')
def handle_move_marker(data):
    logger.info(f"move_marker called with data: {data}")
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    marker_id = data.get('marker_id')
    new_position = data.get('position')
    if not all([token, lobby_id, marker_id, new_position]):
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
    if not participant or participant.is_banned:
        emit('error', {'message': 'Access denied'}, room=request.sid)
        return

    game_state = get_game_state(lobby_id)
    markers = game_state.map_data.get('markers', [])
    marker = next((m for m in markers if m.get('id') == marker_id), None)
    if not marker:
        emit('error', {'message': 'Marker not found'}, room=request.sid)
        return
    if not can_edit_marker(user.id, lobby_id, marker):
        emit('error', {'message': 'You cannot move this marker'}, room=request.sid)
        return

    marker['position'] = new_position

    try:
        game_state.map_data['markers'] = markers
        flag_modified(game_state, 'map_data')
        db.session.commit()
        logger.info(f"Marker {marker_id} moved by {user.username} in lobby {lobby_id} to {new_position}")
        for recipient_id in marker_recipient_ids(lobby_id):
            if can_see_marker(recipient_id, lobby_id, marker):
                emit(
                    'marker_moved',
                    {'id': marker_id, 'position': new_position},
                    room=f"user_{recipient_id}",
                )
    except Exception as e:
        db.session.rollback()
        logger.exception("Failed to move marker")
        emit('error', {'message': 'Database error: ' + str(e)}, room=request.sid)

@socketio.on('delete_marker')
def handle_delete_marker(data):
    logger.info(f"delete_marker called with data: {data}")
    token = data.get('token')
    lobby_id = data.get('lobby_id')
    marker_id = data.get('marker_id')
    if not all([token, lobby_id, marker_id]):
        return

    user = get_user_from_token(token)
    if not user:
        emit('error', {'message': 'Invalid token'}, room=request.sid)
        return

    participant = LobbyParticipant.query.filter_by(lobby_id=lobby_id, user_id=user.id).first()
    if not participant or participant.is_banned:
        emit('error', {'message': 'Access denied'}, room=request.sid)
        return

    game_state = get_game_state(lobby_id)
    markers = game_state.map_data.get('markers', [])
    marker = next((m for m in markers if m.get('id') == marker_id), None)
    if not marker:
        emit('error', {'message': 'Marker not found'}, room=request.sid)
        return
    if not can_edit_marker(user.id, lobby_id, marker):
        emit('error', {'message': 'You cannot delete this marker'}, room=request.sid)
        return

    # Если удаляется точка маршрута, сдвигаем оставшиеся
    if marker.get('type') == 'route_point' and marker.get('routeId'):
        route_id = marker['routeId']
        order = marker.get('routeOrder', 0)
        for m in markers:
            if (m.get('type') == 'route_point' and
                m.get('routeId') == route_id and
                m.get('id') != marker_id and
                m.get('routeOrder', 0) > order):
                m['routeOrder'] = m['routeOrder'] - 1

    markers = [m for m in markers if m.get('id') != marker_id]

    try:
        game_state.map_data['markers'] = markers
        flag_modified(game_state, 'map_data')
        db.session.commit()
        logger.info(f"Marker {marker_id} deleted by {user.username} in lobby {lobby_id}")
        emit('marker_deleted', {'id': marker_id}, room=f"lobby_{lobby_id}")
    except Exception as e:
        db.session.rollback()
        logger.exception("Failed to delete marker")
        emit('error', {'message': 'Database error: ' + str(e)}, room=request.sid)
