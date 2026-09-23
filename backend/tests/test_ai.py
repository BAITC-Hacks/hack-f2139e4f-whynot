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


def test_openai_generates_questions_without_changing_card(monkeypatch):
    def fake_post(self, url, **kwargs):
        assert url == "https://api.openai.com/v1/responses"
        assert kwargs["headers"]["Authorization"] == "Bearer test-secret"
        body = kwargs["json"]
        assert body["model"] == "gpt-4o-mini"
        assert body["store"] is False
        assert body["text"]["format"]["type"] == "json_schema"
        assert body["text"]["format"]["strict"] is True
        source = json.loads(body["input"])
        assert source["card"]["data"] == "CSV продаж"
        assert "success_criteria" in source["missing_fields"]
        output = {
            "questions": [
                {
                    "field": "success_criteria",
                    "question": "Как проверить результат на тестовых данных?",
                },
                {"field": "constraints", "question": "Какие сроки есть у команды?"},
                {"field": "users", "question": "Кто будет использовать результат?"},
            ]
        }
        return httpx.Response(
            200,
            json={
                "status": "completed",
                "output": [
                    {"type": "reasoning"},
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": json.dumps(output)}],
                    },
                ],
            },
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    result = Assistant(Settings(ai_provider="openai", openai_api_key="test-secret")).assist(
        "Нужен прогноз", Card(), 3, AssistInput(answers={"data": "CSV продаж"})
    )
    assert result.provider == "openai"
    assert result.fallback_reason is None
    assert result.based_on_revision == 3
    assert len(result.questions) == 3
    assert result.suggested_card.data == "CSV продаж"
    assert not result.suggested_card.success_criteria


@pytest.mark.parametrize(
    "body",
    [
        {"status": "incomplete", "output": []},
        {"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal"}]}]},
        {
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": '{"questions":[]}'}],
                }
            ],
        },
    ],
)
def test_openai_invalid_response_falls_back(monkeypatch, body):
    def fake_post(self, url, **kwargs):
        return httpx.Response(200, json=body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    result = Assistant(Settings(ai_provider="openai", openai_api_key="test-secret")).assist(
        "Нужен прогноз", Card(), 1, AssistInput()
    )
    assert result.provider == "stub"
    assert result.fallback_reason
    assert len(result.questions) == 3


def test_openai_missing_key_falls_back_without_http_call(monkeypatch):
    def fail_if_called(*args, **kwargs):
        raise AssertionError("HTTP call should not happen without an API key")

    monkeypatch.setattr(httpx.Client, "post", fail_if_called)
    result = Assistant(Settings(ai_provider="openai", openai_api_key=None)).assist(
        "Нужен прогноз", Card(), 1, AssistInput()
    )
    assert result.provider == "stub"
    assert "пока не подключён" in result.fallback_reason


def test_openai_http_error_falls_back_without_exposing_key(monkeypatch):
    def fake_post(self, url, **kwargs):
        return httpx.Response(
            401,
            json={"error": {"message": "Invalid API key"}},
            request=httpx.Request("POST", url),
        )

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    result = Assistant(Settings(ai_provider="openai", openai_api_key="test-secret")).assist(
        "Нужен прогноз", Card(), 1, AssistInput()
    )
    assert result.provider == "stub"
    assert result.fallback_reason
    assert "test-secret" not in result.fallback_reason


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
            == 401
        )
