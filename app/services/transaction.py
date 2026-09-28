from functools import wraps
from app.extensions import db


def atomic_operation(operation):
    """Commit a complete operation, rolling back even a failed intermediate flush."""
    @wraps(operation)
    def run(*args, **kwargs):
        try:
            result = operation(*args, **kwargs)
            db.session.commit()
            return result
        except Exception:
            db.session.rollback()
            raise
    return run
