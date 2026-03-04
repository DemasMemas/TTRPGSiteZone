# app/sockets/__init__.py
import logging
from flask_socketio import emit
from app.extensions import socketio

logger = logging.getLogger(__name__)

from . import auth
from . import chat
from . import dice
from . import markers