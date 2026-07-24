import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()


class Config:
    """Base application configuration."""

    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-only-secret-key')
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', SECRET_KEY)
    LOG_TO_FILE = True
    LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
    LOG_MAX_BYTES = 5 * 1024 * 1024
    LOG_BACKUP_COUNT = 3
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JSON_AS_ASCII = False
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=4)


class DevelopmentConfig(Config):
    """Development configuration."""

    DEBUG = True
    SQLALCHEMY_DATABASE_URI = (
        os.environ.get('DEV_DATABASE_URL')
        or os.environ.get('DATABASE_URL')
        or 'sqlite:///ttrpg_dev.db'
    )


class ProductionConfig(Config):
    """Production configuration."""

    DEBUG = False
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL')


class TestingConfig(Config):
    """Isolated configuration used by the automated test suite."""

    TESTING = True
    LOG_TO_FILE = False
    SQLALCHEMY_DATABASE_URI = 'sqlite://'
    JWT_SECRET_KEY = 'test-jwt-secret-that-is-at-least-32-bytes'
    SECRET_KEY = 'test-app-secret-that-is-at-least-32-bytes'


config_by_name = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig,
}
