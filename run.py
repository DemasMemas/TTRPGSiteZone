import os

from app import create_app, socketio


app = create_app(os.getenv('FLASK_ENV') or 'development')


if __name__ == '__main__':
    debug = os.getenv('FLASK_DEBUG', '').lower() in {'1', 'true', 'yes', 'on'}
    host = os.getenv('FLASK_HOST', '127.0.0.1')
    port = int(os.getenv('FLASK_PORT', '5000'))
    socketio.run(app, host=host, port=port, debug=debug)
