import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.ai import Assistant
from app.config import Settings
from app.main import create_app
from app.schemas import AssistInput, Card


@pytest.mark.parametrize(
    "body",
    [
        "not json",
        '{"questions": []}',
        json.dumps({"questions": [{"field": "data", "question": "Какие данные доступны?"}] * 3}),
        '{"questions": [{"field": "invented", "question": "Test?"}]}',
    ],
)
def test_malformed_provider_response_falls_back(monkeypatch, body):
    def fake_post(self, url, **kwargs):
        return httpx.Response(200, json={"response": body}, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    result = Assistant(Settings(ai_provider="ollama", ollama_model="test-model")).assist(
        "Нужно сократить ручную работу",
        Card(),
        1,
        AssistInput(),
    )
    assert result.provider == "stub"
    assert result.fallback_reason
    assert len(result.questions) == 3
    assert not result.suggested_card.data


def test_provider_timeout_falls_back(monkeypatch):
    def fake_post(*args, **kwargs):
        raise httpx.ReadTimeout("timeout")

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    result = Assistant(Settings(ai_provider="ollama", ollama_model="test-model")).assist(
        "Исходный текст",
        Card(),
        1,
        AssistInput(),
    )
    assert result.provider == "stub"
    assert result.fallback_reason


def test_valid_ai_questions_and_user_answers(monkeypatch):
    def fake_post(self, url, **kwargs):
        assert kwargs["json"]["format"]["type"] == "object"
        assert kwargs["json"]["stream"] is False
        body = {
            "questions": [
                {"field": "data", "question": "Какие данные доступны для прогноза?"},
                {"field": "constraints", "question": "Каковы ограничения по срокам?"},
                {"field": "users", "question": "Кто будет использовать прогноз?"},
            ]
        }
        return httpx.Response(
            200, json={"response": json.dumps(body)}, request=httpx.Request("POST", url)
        )

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    result = Assistant(Settings(ai_provider="ollama", ollama_model="test-model")).assist(
        "Нужен прогноз",
        Card(),
        3,
        AssistInput(answers={"data": "CSV продаж"}),
    )
    assert result.provider == "ollama"
    assert result.based_on_revision == 3
    assert result.suggested_card.data == "CSV продаж"
    assert result.suggested_card.context == "Нужен прогноз"
    assert not result.suggested_card.success_criteria
    assert result.fallback_reason is None


def test_disabling_demo_auth_does_not_enable_anonymous_writes():
    app = create_app(Settings(database_url="sqlite://", demo_mode=False))
    with TestClient(app) as client:
        assert client.get("/api/v1/demo/actors").status_code == 404
        assert (
            client.post(
                "/api/v1/tasks",
                headers={"X-Actor-ID": "business-1"},
                json={"raw_description": "Task", "topic": "retail"},
            ).status_code
            == 503
        )
