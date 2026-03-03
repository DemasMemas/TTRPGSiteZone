# app/services/exceptions.py
class ServiceError(Exception):
    """Базовое исключение для сервисов."""
    pass

class ValidationError(ServiceError):
    """Ошибка валидации входных данных."""
    pass

class NotFoundError(ServiceError):
    """Объект не найден."""
    pass

class PermissionDenied(ServiceError):
    """Недостаточно прав."""
    pass