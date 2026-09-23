import json
from datetime import UTC, datetime, timedelta

import pytest
from test_workflow import ensure_ready_team

from app.ai import Assistant
from app.business_profiles import business_ai_context
from app.config import Settings
from app.models import Actor, Task
from app.schemas import AIQuestions


def actor_headers(actor_id):
    return {"X-Actor-ID": actor_id}


def create_card(client, full_card, actor_id="business-1", title="История магазина"):
    headers = actor_headers(actor_id)
    response = client.post(
        "/api/v1/tasks",
        headers=headers,
        json={"raw_description": title, "title": title, "topic": "retail"},
    )
    assert response.status_code == 201, response.text
    task = response.json()
    response = client.put(
        f"/api/v1/tasks/{task['id']}/card",
        headers=headers,
        json={"expected_revision": task["revision"], "card": {**full_card, "title": title}},
    )
    assert response.status_code == 200, response.text
    return response.json()


def task_action(client, task, action, actor_id="business-1"):
    response = client.post(
        f"/api/v1/tasks/{task['id']}/{action}",
        headers=actor_headers(actor_id),
        json={"expected_revision": task["revision"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def publish_card(client, full_card, actor_id="business-1"):
    task = create_card(client, full_card, actor_id)
    task = task_action(client, task, "confirm", actor_id)
    return task_action(client, task, "publish", actor_id)


def submit_proposal(client, task, student="student-1"):
    headers = actor_headers(student)
    ensure_ready_team(client, student)
    response = client.post(
        f"/api/v1/tasks/{task['id']}/proposals",
        headers=headers,
        json={"idea": "Проверить прогноз", "plan": "Прототип и оценка", "timeline": "2 недели"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def decide(client, proposal, decision, actor_id="business-1"):
    response = client.post(
        f"/api/v1/proposals/{proposal['id']}/decision",
        headers=actor_headers(actor_id),
        json={"decision": decision, "note": f"Решение: {decision}"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def confirm_result(client, proposal, actor_id="business-1", code="prototype"):
    response = client.post(
        f"/api/v1/proposals/{proposal['id']}/milestones",
        headers=actor_headers(actor_id),
        json={"code": code, "evidence": f"Проверен результат {code}"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def assert_results(actual, expected):
    for stored, created in zip(actual, expected, strict=True):
        assert {key: value for key, value in stored.items() if key != "confirmed_at"} == {
            key: value for key, value in created.items() if key != "confirmed_at"
        }
        # SQLite returns stored UTC datetimes without a timezone suffix.
        assert datetime.fromisoformat(stored["confirmed_at"]).replace(tzinfo=UTC) == (
            datetime.fromisoformat(created["confirmed_at"]).replace(tzinfo=UTC)
        )


@pytest.fixture
def profile():
    return {
        "company_name": "Наш магазин",
        "industry": "Ритейл",
        "description": "Небольшой продуктовый магазин",
        "goals": "Снизить списания без потери качества",
        "values": "Забота о клиентах и прозрачность",
        "use_history_for_ai": True,
    }


def test_business_profiles_are_private_and_persist_independently(client, business, profile):
    other = actor_headers("business-2")
    assert client.get("/api/v1/business/profile", headers=other).json()["goals"] == ""
    response = client.put("/api/v1/business/profile", headers=business, json=profile)
    assert response.status_code == 200, response.text
    assert response.json() == profile
    other_profile = {**profile, "company_name": "Второй бизнес", "goals": "Цель второго бизнеса"}
    assert (
        client.put("/api/v1/business/profile", headers=other, json=other_profile).status_code == 200
    )
    assert client.get("/api/v1/business/profile", headers=business).json() == profile
    assert client.get("/api/v1/business/profile", headers=other).json() == other_profile
    response = client.put(
        "/api/v1/business/profile", headers=business, json={**profile, "owner_id": "business-2"}
    )
    assert response.status_code == 422
    assert client.get("/api/v1/business/profile", headers=other).json() == other_profile


@pytest.mark.parametrize(
    ("method", "path", "wrong_actor", "code"),
    [
        ("GET", "/business/profile", "student-1", "BUSINESS_REQUIRED"),
        ("PUT", "/business/profile", "student-1", "BUSINESS_REQUIRED"),
        ("GET", "/business/history", "student-1", "BUSINESS_REQUIRED"),
        ("GET", "/students/history", "business-1", "STUDENT_REQUIRED"),
    ],
)
def test_profile_and_history_require_login_and_correct_role(
    client, profile, method, path, wrong_actor, code
):
    payload = {"json": profile} if method == "PUT" else {}
    anonymous = client.request(method, "/api/v1" + path, **payload)
    assert anonymous.status_code == 401
    wrong_role = client.request(
        method, "/api/v1" + path, headers=actor_headers(wrong_actor), **payload
    )
    assert wrong_role.status_code == 403
    assert wrong_role.json()["error"]["code"] == code


@pytest.mark.parametrize(
    "path,actor_id",
    [
        ("/business/history", "business-1"),
        ("/students/history", "student-1"),
    ],
)
def test_history_empty_page_and_pagination_validation(client, path, actor_id):
    headers = actor_headers(actor_id)
    response = client.get("/api/v1" + path, headers=headers)
    assert response.status_code == 200
    assert response.json() == {"items": [], "total": 0, "limit": 20, "offset": 0}
    for query in ("limit=0", "limit=101", "offset=-1"):
        assert client.get(f"/api/v1{path}?{query}", headers=headers).status_code == 422


def test_business_history_contains_own_drafts_publications_and_results(client, business, full_card):
    published = publish_card(client, full_card)
    draft = create_card(client, full_card, title="Наш черновик")
    foreign = publish_card(client, full_card, "business-2")
    accepted = decide(client, submit_proposal(client, published), "accepted")
    result = confirm_result(client, accepted)
    rejected = decide(client, submit_proposal(client, published, "student-2"), "rejected")
    foreign_proposal = decide(client, submit_proposal(client, foreign), "accepted", "business-2")
    foreign_result = confirm_result(client, foreign_proposal, "business-2")

    response = client.get("/api/v1/business/history", headers=business)
    assert response.status_code == 200, response.text
    page = response.json()
    assert page["total"] == 2
    tasks = {item["task"]["id"]: item for item in page["items"]}
    assert set(tasks) == {published["id"], draft["id"]}
    assert tasks[draft["id"]]["task"]["status"] == "draft"
    assert tasks[draft["id"]]["proposals"] == []
    assert tasks[published["id"]]["task"]["rating"]["score"] == 100
    proposals = {item["id"]: item for item in tasks[published["id"]]["proposals"]}
    assert set(proposals) == {accepted["id"], rejected["id"]}
    assert_results(proposals[accepted["id"]]["milestones"], [result])
    assert proposals[rejected["id"]]["milestones"] == []
    assert proposals[rejected["id"]]["decision_note"] == "Решение: rejected"
    assert foreign_result["id"] not in response.text

    first = client.get("/api/v1/business/history?limit=1", headers=business).json()
    second = client.get("/api/v1/business/history?limit=1&offset=1", headers=business).json()
    assert first["total"] == second["total"] == 2
    assert first["items"][0]["task"]["id"] != second["items"][0]["task"]["id"]
    assert second["offset"] == 1
    own_second = client.get("/api/v1/business/history", headers=actor_headers("business-2")).json()
    assert own_second["total"] == 1
    assert own_second["items"][0]["task"]["id"] == foreign["id"]


def test_student_history_owns_outcomes_points_and_uses_published_task_snapshot(
    client,
    business,
    full_card,
):
    task = publish_card(client, full_card)
    accepted = decide(client, submit_proposal(client, task), "accepted")
    results = [confirm_result(client, accepted, code=code) for code in ("prototype", "pilot")]
    rejected = decide(client, submit_proposal(client, task), "rejected")
    pending = submit_proposal(client, task)
    foreign = decide(client, submit_proposal(client, task, "student-2"), "accepted")
    foreign_result = confirm_result(client, foreign, code="delivery")

    private_card = {**task["card"], "title": "Секретный новый заголовок", "topic": "private-topic"}
    edited = client.put(
        f"/api/v1/tasks/{task['id']}/card",
        headers=business,
        json={"expected_revision": task["revision"], "card": private_card},
    )
    assert edited.status_code == 200
    # Even confirmed edits stay private until the business publishes them.
    task_action(client, edited.json(), "confirm")
    response = client.get("/api/v1/students/history", headers=actor_headers("student-1"))
    assert response.status_code == 200, response.text
    page = response.json()
    assert page["total"] == 3
    entries = {item["proposal"]["id"]: item for item in page["items"]}
    assert set(entries) == {accepted["id"], rejected["id"], pending["id"]}
    assert_results(entries[accepted["id"]]["milestones"], results)
    assert sum(result["points"] for result in entries[accepted["id"]]["milestones"]) == 50
    assert entries[rejected["id"]]["proposal"]["status"] == "rejected"
    assert entries[rejected["id"]]["proposal"]["decision_note"] == "Решение: rejected"
    assert entries[pending["id"]]["proposal"]["status"] == "pending"
    assert entries[pending["id"]]["milestones"] == []
    for item in page["items"]:
        assert item["task"] == {
            "id": task["id"],
            "title": task["card"]["title"],
            "topic": task["card"]["topic"],
        }
    assert private_card["title"] not in response.text
    assert private_card["topic"] not in response.text
    assert foreign_result["id"] not in response.text
    page_two = client.get(
        "/api/v1/students/history?limit=1&offset=1", headers=actor_headers("student-1")
    ).json()
    assert page_two["total"] == 3
    assert len(page_two["items"]) == 1
    assert page_two["items"][0] == page["items"][1]
    other = client.get("/api/v1/students/history", headers=actor_headers("student-2")).json()
    assert other["total"] == 1
    assert other["items"][0]["proposal"]["id"] == foreign["id"]
    assert_results(other["items"][0]["milestones"], [foreign_result])


@pytest.fixture
def contextual_tasks(client, app, full_card):
    base_date = datetime(2026, 1, 1, tzinfo=UTC)
    confirmed = []
    for number in range(7):
        task = create_card(client, full_card, title=f"Подтверждённая задача {number}")
        confirmed.append(task_action(client, task, "confirm"))
    previous = publish_card(client, full_card)
    changed = client.put(
        f"/api/v1/tasks/{previous['id']}/card",
        headers=actor_headers("business-1"),
        json={
            "expected_revision": previous["revision"],
            "card": {**previous["card"], "title": "Неопубликованная тайна"},
        },
    )
    assert changed.status_code == 200
    current = task_action(client, create_card(client, full_card, title="Текущая задача"), "confirm")
    unconfirmed = create_card(client, full_card, title="Неподтверждённая задача")
    other = task_action(
        client,
        create_card(client, full_card, "business-2", "Чужая задача"),
        "confirm",
        "business-2",
    )
    with app.state.session_factory() as db:
        ordered = [*confirmed, previous, current, unconfirmed, other]
        for index, item in enumerate(ordered):
            db.get(Task, item["id"]).created_at = base_date + timedelta(days=index)
        db.commit()
    return {"confirmed": confirmed, "previous": previous, "current": current}


def test_business_context_selects_five_own_confirmed_facts_without_contact(
    app,
    contextual_tasks,
):
    current = contextual_tasks["current"]
    with app.state.session_factory() as db:
        context = business_ai_context(db, db.get(Actor, "business-1"), current["id"])
    history = context["previous_tasks"]
    expected = [contextual_tasks["previous"], *contextual_tasks["confirmed"][-4:][::-1]]
    assert [item["task_id"] for item in history] == [item["id"] for item in expected]
    assert history[0]["card"]["title"] == contextual_tasks["previous"]["card"]["title"]
    for item in history:
        assert "contact" not in item["card"]
        assert "interaction_format" not in item["card"]
    serialized = json.dumps(context, ensure_ascii=False)
    assert "Неопубликованная тайна" not in serialized
    assert "demo@example.com" not in serialized


def test_assist_route_passes_profile_and_history_and_respects_opt_out(
    client,
    app,
    business,
    profile,
    contextual_tasks,
    monkeypatch,
):
    sources = []
    assistant = Assistant(Settings(ai_provider="openai", openai_api_key="test-secret"))

    def capture_source(source):
        sources.append(source)
        return AIQuestions.model_validate(
            {
                "questions": [
                    {"field": "data", "question": "Какие данные доступны?"},
                    {"field": "constraints", "question": "Какие ограничения важны?"},
                    {"field": "success_criteria", "question": "Как проверить результат?"},
                ]
            }
        )

    monkeypatch.setattr(assistant, "openai_questions", capture_source)
    app.state.assistant = assistant
    assert client.put("/api/v1/business/profile", headers=business, json=profile).status_code == 200
    task = contextual_tasks["current"]
    url = f"/api/v1/tasks/{task['id']}/assist"
    first = client.post(url, headers=business, json={"answers": {"data": "Обезличенный CSV"}})
    assert first.status_code == 200, first.text
    assert first.json()["provider"] == "openai"
    assert sources[0]["business_context"]["profile"] == profile
    assert len(sources[0]["business_context"]["previous_tasks"]) == 5
    assert sources[0]["card"]["data"] == "Обезличенный CSV"

    disabled = {**profile, "use_history_for_ai": False}
    assert (
        client.put("/api/v1/business/profile", headers=business, json=disabled).status_code == 200
    )
    second = client.post(url, headers=business, json={})
    assert second.status_code == 200, second.text
    context = sources[1]["business_context"]
    assert context["previous_tasks"] == []
    assert context["profile"]["goals"] == profile["goals"]
    assert context["profile"]["values"] == profile["values"]
    stored = client.get(f"/api/v1/tasks/{task['id']}", headers=business).json()
    assert stored["card"] == task["card"]
    assert stored["revision"] == task["revision"]
    assert client.post(url, headers=actor_headers("business-2"), json={}).status_code == 404
    assert len(sources) == 2
