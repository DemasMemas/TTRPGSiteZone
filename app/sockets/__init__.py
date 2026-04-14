# app/sockets/__init__.py
"""
Обработчики WebSocket событий.

- auth.py        : подключение, аутентификация, выход
- chat.py        : отправка сообщений, команды /roll
- dice.py        : броски навыков персонажа
- markers.py     : создание, редактирование, перемещение маркеров на карте
- character.py   : обновление данных персонажа в реальном времени
- kick.py        : вспомогательная функция для кика пользователя
- utils.py       : получение пользователя из JWT токена
"""

import logging
from flask_socketio import emit
from app.extensions import socketio

logger = logging.getLogger(__name__)

from . import auth
from . import chat
from . import dice
from . import markers
from . import character

@socketio.on('*')
def catch_all(event, data):
    print(f"GOT EVENT: {event} with data {data}")