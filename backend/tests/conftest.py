import smtplib

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import Actor


@pytest.fixture(autouse=True)
def isolated_settings_and_transports(request, monkeypatch):
    """Tests must not use the developer's credentials or contact real providers."""
    for field in Settings.model_fields:
        monkeypatch.delenv(field.upper(), raising=False)
        monkeypatch.delenv(field.lower(), raising=False)
    # Config tests deliberately supply temporary dotenv files and verify the default path.
    if request.path.name != "test_config.py":
        monkeypatch.setitem(Settings.model_config, "env_file", None)

    def deny_network(*_args, **_kwargs):
        raise AssertionError("External HTTP/SMTP is disabled in tests; mock the provider.")

    async def deny_async_network(*_args, **_kwargs):
        deny_network()

    # TestClient has its own ASGI transport, so local API requests still work.
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", deny_network)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", deny_async_network)
    monkeypatch.setattr(smtplib.SMTP, "connect", deny_network)


@pytest.fixture
def app():
    return create_app(Settings(database_url="sqlite://", demo_mode=True, ai_provider="stub"))


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        with app.state.session_factory() as db:
            db.add(Actor(id="business-2", role="business", name="Другой бизнес"))
            db.commit()
        yield client


@pytest.fixture
def business():
    return {"X-Actor-ID": "business-1"}


@pytest.fixture
def full_card():
    return {
        "title": "Прогноз остатков",
        "topic": "retail",
        "context": "Остатки магазина проверяются вручную каждый вечер.",
        "need": "Сократить время проверки остатков.",
        "users": "Закупщик магазина",
        "data": "CSV продаж и остатков за 6 месяцев.",
        "constraints": "2 недели, Python, без персональных данных.",
        "expected_result": "Прототип прогноза с отчётом.",
        "success_criteria": "Ошибка прогноза меньше 15% на отложенных данных.",
        "contact": "demo@example.com",
        "interaction_format": "Созвон раз в неделю; ответ в течение двух дней.",
    }
