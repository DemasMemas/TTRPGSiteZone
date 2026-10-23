import os

from flask import Flask, render_template

from app.config import DevelopmentConfig


def test_development_templates_reload_with_debugger_disabled(tmp_path):
    template = tmp_path / 'controls.html'
    template.write_text('<input step="any">', encoding='utf-8')
    app = Flask(__name__, template_folder=str(tmp_path))
    app.config.from_object(DevelopmentConfig)
    # run.py passes debug=False for the normal LAN startup.
    app.debug = False

    with app.app_context():
        assert render_template('controls.html') == '<input step="any">'
        previous_mtime = template.stat().st_mtime
        template.write_text('<input step="0.5">', encoding='utf-8')
        os.utime(template, (previous_mtime + 2, previous_mtime + 2))
        assert app.jinja_env.auto_reload is True
        assert render_template('controls.html') == '<input step="0.5">'
