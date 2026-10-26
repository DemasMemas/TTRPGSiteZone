"""Acknowledgement endpoint for the client connection monitor."""

import time

from flask import request

from app.extensions import socketio


@socketio.on("network_ping")
def handle_network_ping(_payload=None):
    return {
        "server_time_ms": round(time.time() * 1000),
        "transport": socketio.server.transport(request.sid),
    }
