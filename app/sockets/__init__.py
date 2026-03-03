# app/sockets/__init__.py
from flask_socketio import emit
from app.extensions import socketio

from . import auth
from . import chat
from . import dice
from . import markers