"""Resolve inventory template IDs, including lobby-local IDs exposed to clients."""

from app.extensions import db
from app.models.lobby_templates import LobbyItemTemplate
from app.models.templates import ItemTemplate


LOCAL_TEMPLATE_ID_OFFSET = 1_000_000


def resolve_item_template(item, lobby_id=None):
    try:
        template_id = int((item or {}).get("templateId") or 0)
    except (TypeError, ValueError):
        return None
    if template_id >= LOCAL_TEMPLATE_ID_OFFSET:
        if lobby_id is None:
            return None
        return LobbyItemTemplate.query.filter_by(
            id=template_id - LOCAL_TEMPLATE_ID_OFFSET, lobby_id=lobby_id,
        ).first()
    return db.session.get(ItemTemplate, template_id) if template_id > 0 else None
