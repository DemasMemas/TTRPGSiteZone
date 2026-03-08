# app/sockets/__init__.py
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