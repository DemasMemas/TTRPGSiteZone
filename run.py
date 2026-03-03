import os
from app import create_app, socketio

app = create_app(os.getenv('FLASK_ENV') or 'development')

if __name__ == '__main__':
    socketio.run(app, debug=True)