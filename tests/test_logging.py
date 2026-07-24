import logging

from flask import Flask

from app import _configure_logging, _is_project_log_handler, create_app


def test_testing_apps_do_not_accumulate_file_handlers():
    first = create_app("testing")
    second = create_app("testing")

    assert not any(_is_project_log_handler(handler) for handler in first.logger.handlers)
    assert first.logger is second.logger


def test_file_logging_is_idempotent(tmp_path):
    app = Flask("app.logging_test")
    log_path = tmp_path / "ttrpg.log"
    app.config.update(
        LOG_TO_FILE=True,
        LOG_FILE=str(log_path),
        LOG_LEVEL="INFO",
        LOG_MAX_BYTES=1024,
        LOG_BACKUP_COUNT=1,
    )

    first_handler = _configure_logging(app)
    second_handler = _configure_logging(app)
    app.logger.info("single log entry")
    first_handler.flush()

    project_handlers = [
        handler for handler in app.logger.handlers
        if _is_project_log_handler(handler)
    ]
    assert project_handlers == [first_handler]
    assert second_handler is first_handler
    assert log_path.read_text(encoding="utf-8").count("single log entry") == 1

    app.logger.removeHandler(first_handler)
    first_handler.close()
