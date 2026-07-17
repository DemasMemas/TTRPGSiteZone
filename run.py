import os

from app import create_app, socketio


app = create_app(os.getenv('FLASK_ENV') or 'development')


if __name__ == '__main__':
    debug = os.getenv('FLASK_DEBUG', '').lower() in {'1', 'true', 'yes', 'on'}
    socketio.run(app, debug=debug)
