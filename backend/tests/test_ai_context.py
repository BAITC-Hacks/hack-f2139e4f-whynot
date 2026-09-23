import json

import httpx
import pytest

from app.ai import Assistant
from app.config import Settings
from app.rating import CRITERIA
from app.schemas import AIQuestions, AssistInput, Card, Question


def sample_questions():
    return [
        {"field": "data", "question": "Какие поля есть в доступных материалах?"},
        {"field": "constraints", "question": "Какие ограничения учитывать в прототипе?"},
        {"field": "success_criteria", "question": "Как проверить результат на примере?"},
    ]


@pytest.mark.parametrize("provider", ["openai", "ollama"])
def test_provider_receives_each_tasks_context_answers_and_history(monkeypatch, provider):
    sources = []

    def fake_post(self, url, **kwargs):
        body = kwargs["json"]
        sources.append(json.loads(body["input" if provider == "openai" else "prompt"]))
        output = json.dumps({"questions": sample_questions()}, ensure_ascii=False)
        response_body = (
            {
                "status": "completed",
                "output": [
                    {"type": "message", "content": [{"type": "output_text", "text": output}]}
                ],
            }
            if provider == "openai"
            else {"response": output}
        )
        return httpx.Response(200, json=response_body, request=httpx.Request("POST", url))

    monkeypatch.setattr(httpx.Client, "post", fake_post)
    assistant = Assistant(
        Settings(ai_provider=provider, openai_api_key="test-secret", ollama_model="test-model")
    )
    raw_description = "Остатки магазина проверяем вручную; нужен прогноз закупок."
    card = Card(
        title="Прогноз закупок",
        topic="retail",
        context="Закупщик сверяет остатки каждый вечер.",
        data="Данные есть",
        users="Закупщик",
    )
    original_card = card.model_dump()
    history = [Question(field="data", question="Какие данные о продажах доступны?")]
    answers = {"data": "CSV продаж и остатков за 6 месяцев, обновляется каждый день."}
    first = assistant.assist(
        raw_description,
        card,
        7,
        AssistInput(answers=answers, previous_questions=history),
    )
    second_description = "Ответы студентов теряются в чатах курса."
    second = assistant.assist(
        second_description,
        Card(title="Обратная связь курса", topic="education"),
        1,
        AssistInput(),
    )

    assert first.provider == second.provider == provider
    assert first.fallback_reason is second.fallback_reason is None
    assert len(sources) == 2
    source, unrelated_source = sources
    assert source["raw_description"] == raw_description
    assert source["card"] == {**original_card, **answers}
    assert source["answers"] == answers
    assert source["previous_questions"] == [question.model_dump() for question in history]
    assert source["category"]["id"] == "retail"
    assert source["category"]["label"] != "retail"
    assert source["category"]["considerations"]
    assert "data" not in source["missing_fields"]
    assert "success_criteria" in source["missing_fields"]
    assert source["criteria"] == [
        {"label": item.label, "field_weights": item.weights, "guidance": item.suggestion}
        for item in CRITERIA
    ]
    assert unrelated_source["raw_description"] == second_description
    assert unrelated_source["category"]["id"] == "education"
    assert unrelated_source["category"] != source["category"]
    assert unrelated_source["card"]["context"] == second_description
    assert unrelated_source["card"]["data"] == ""
    assert unrelated_source["answers"] == {}
    assert unrelated_source["previous_questions"] == []
    assert "data" in unrelated_source["missing_fields"]
    assert first.suggested_card.data == answers["data"]
    assert first.suggested_card.context == card.context
    assert first.based_on_revision == 7
    assert card.model_dump() == original_card


def test_assist_round_uses_saved_card_without_saving_new_answers(
    monkeypatch, client, app, business, full_card
):
    sources = []

    def fake_questions(source):
        sources.append(source)
        return AIQuestions(questions=sample_questions())

    app.state.assistant.settings.ai_provider = "openai"
    monkeypatch.setattr(app.state.assistant, "openai_questions", fake_questions)
    created = client.post(
        "/api/v1/tasks",
        headers=business,
        json={"raw_description": "Нужен прогноз закупок магазина.", "topic": "retail"},
    )
    assert created.status_code == 201
    task_url = f"/api/v1/tasks/{created.json()['id']}"
    saved = client.put(
        f"{task_url}/card",
        headers=business,
        json={"expected_revision": 1, "card": full_card},
    )
    assert saved.status_code == 200
    before = saved.json()
    history = [{"field": "data", "question": "С какой частотой обновляются данные?"}]
    answers = {"data": "CSV продаж, новый файл ежедневно; передадим обезличенный пример."}
    response = client.post(
        f"{task_url}/assist",
        headers=business,
        json={"answers": answers, "previous_questions": history},
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "openai"
    assert response.json()["based_on_revision"] == before["revision"]
    assert response.json()["suggested_card"]["data"] == answers["data"]
    assert len(sources) == 1
    assert sources[0]["raw_description"] == before["raw_description"]
    assert sources[0]["card"] == {**full_card, **answers}
    assert sources[0]["previous_questions"] == history
    after = client.get(task_url, headers=business)
    assert after.status_code == 200
    assert after.json() == before


@pytest.mark.parametrize(("history_size", "expected_status"), [(40, 200), (41, 422)])
def test_assist_api_bounds_question_history(client, business, history_size, expected_status):
    created = client.post(
        "/api/v1/tasks",
        headers=business,
        json={"raw_description": "Упростить планирование доставок.", "topic": "logistics"},
    )
    assert created.status_code == 201
    task_url = f"/api/v1/tasks/{created.json()['id']}"
    before = client.get(task_url, headers=business).json()
    response = client.post(
        f"{task_url}/assist",
        headers=business,
        json={
            "previous_questions": [
                {"field": "constraints", "question": f"Какое ограничение действует на этапе {n}?"}
                for n in range(history_size)
            ]
        },
    )

    assert response.status_code == expected_status
    assert client.get(task_url, headers=business).json() == before
