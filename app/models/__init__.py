"""
Модели SQLAlchemy для таблиц базы данных.

- User           : пользователи
- Lobby          : игровые комнаты
- LobbyParticipant : связь пользователей с комнатами (участники)
- GameState      : состояние карты (маркеры)
- ChatMessage    : сообщения чата
- LobbyCharacter : персонажи в комнате
- MapChunk       : данные чанков карты
- ItemTemplate   : глобальные шаблоны предметов
- LobbyItemTemplate : локальные (кастомные) шаблоны комнаты
"""

from .user import User
from .lobby import Lobby
from .participant import LobbyParticipant
from .game_state import GameState
from .chat_message import ChatMessage
from .character import LobbyCharacter
from .map_chunk import MapChunk