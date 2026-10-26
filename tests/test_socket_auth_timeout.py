from app.extensions import socketio


def test_unauthenticated_client_is_disconnected_on_timeout(app, monkeypatch):
    from app.sockets import auth

    timers = []

    class Timer:
        def __init__(self, interval, callback, args):
            self.callback = callback
            self.args = args
            self.cancelled = False
            timers.append(self)

        def start(self):
            pass

        def cancel(self):
            self.cancelled = True

    monkeypatch.setattr(auth.threading, 'Timer', Timer)
    socketio.on_event('connect', auth.handle_connect)
    socketio.on_event('disconnect', auth.handle_disconnect)
    client = socketio.test_client(app)
    assert client.is_connected()
    timer = timers[-1]
    sid = timer.args[0]
    timer.callback(*timer.args)
    assert not client.is_connected()
    assert sid not in auth.pending_auth
    assert timer.cancelled
