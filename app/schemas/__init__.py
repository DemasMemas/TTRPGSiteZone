# app/schemas/__init__.py
"""
Marshmallow схемы для валидации входящих данных и сериализации ответов.

- user.py        : UserSchema, UserLoginSchema, UserProfileSchema
- lobby.py       : LobbyCreateSchema, LobbySchema, LobbyDetailSchema, LobbyMySchema
- participant.py : ParticipantSchema, BannedUserSchema
- character.py   : CharacterSchema, CharacterCreateSchema
- map.py         : GameStateSchema, MapChunkSchema, TileUpdateSchema
- templates.py   : ItemTemplateSchema
- lobby_templates.py : LobbyItemTemplateSchema
"""

from .user import UserSchema
from .lobby import LobbySchema, LobbyCreateSchema, LobbyResponseSchema
from .participant import ParticipantSchema
from .character import CharacterSchema, CharacterCreateSchema
from .map import GameStateSchema, MapChunkSchema