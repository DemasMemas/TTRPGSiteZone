# app/services/exceptions.py
class ServiceError(Exception):
    """Базовое исключение сервисного слоя."""
    def __init__(self, message, code=400):
        super().__init__(message)
        self.code = code


class ConflictError(ServiceError):
    def __init__(self, message='Данные персонажа уже изменились. Откройте свежую версию листа перед сохранением.'):
        super().__init__(message, 409)

class ValidationError(ServiceError):
    def __init__(self, message, code=400):
        super().__init__(message, code)

class NotFoundError(ServiceError):
    def __init__(self, message, code=404):
        super().__init__(message, code)

class PermissionDenied(ServiceError):
    def __init__(self, message, code=403):
        super().__init__(message, code)
