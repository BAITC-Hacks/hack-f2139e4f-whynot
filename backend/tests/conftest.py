import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import Actor


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
