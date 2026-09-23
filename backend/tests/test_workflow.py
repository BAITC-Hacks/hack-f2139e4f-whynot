from sqlalchemy import func, select
from sqlalchemy.orm.exc import StaleDataError

from app.models import Milestone, Proposal, Task, Team
from app.seed import seed_demo


def create_task(client, business):
    response = client.post(
        "/api/v1/tasks",
        headers=business,
        json={
            "raw_description": "Нужен прогноз остатков магазина",
            "topic": "retail",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def post_action(client, task, action, business):
    return client.post(
        f"/api/v1/tasks/{task['id']}/{action}",
        headers=business,
        json={"expected_revision": task["revision"]},
    )


def publish(client, task, business):
    assert post_action(client, task, "confirm", business).status_code == 200
    response = post_action(client, task, "publish", business)
    assert response.status_code == 200, response.text
    return response.json()


def submit(client, task, student="student-1"):
    headers = {"X-Actor-ID": student}
    response = client.put(
        "/api/v1/teams/me",
        headers=headers,
        json={
            "name": f"Team {student}",
            "skills": ["Python"],
            "interests": ["retail"],
            "technologies": ["FastAPI"],
        },
    )
    assert response.status_code == 200, response.text
    return client.post(
        f"/api/v1/tasks/{task['id']}/proposals",
        headers=headers,
        json={
            "idea": "Прогноз по истории продаж",
            "plan": "Анализ, прототип, проверка",
            "timeline": "2 недели",
            "prototype_url": "https://example.com/demo",
        },
    )


def test_full_workflow_manual_selection_and_points(client, app, business, full_card):
    task = create_task(client, business)
    task_url = f"/api/v1/tasks/{task['id']}"
    assert task["rating"]["score"] == 0
    assert post_action(client, task, "publish", business).status_code == 409
    assist = client.post(f"{task_url}/assist", headers=business, json={}).json()
    assert assist["provider"] == "stub"
    assert len(assist["questions"]) >= 3
    # AI only suggests: the stored card has not changed.
    assert client.get(task_url, headers=business).json()["revision"] == 1
    response = client.put(
        f"{task_url}/card", headers=business, json={"expected_revision": 1, "card": full_card}
    )
    assert response.status_code == 200, response.text
    task = response.json()
    assert task["rating"]["preview_score"] == 100
    assert task["rating"]["score"] == 0
    task = publish(client, task, business)
    assert task["rating"]["score"] == 100
    assert client.get("/api/v1/catalog").json()["items"][0]["id"] == task["id"]

    # Business can select several teams; submitting and selecting award no points.
    for student in ["student-1", "student-2"]:
        response = submit(client, task, student)
        assert response.status_code == 201, response.text
        proposal = response.json()
        assert proposal["status"] == "pending"
        decision_url = f"/api/v1/proposals/{proposal['id']}/decision"
        assert (
            client.post(
                decision_url, headers={"X-Actor-ID": student}, json={"decision": "accepted"}
            ).status_code
            == 403
        )
        assert (
            client.post(decision_url, headers=business, json={"decision": "accepted"}).json()[
                "status"
            ]
            == "accepted"
        )
    assert all(team["points"] == 0 for team in client.get("/api/v1/teams").json())
    milestone_url = f"/api/v1/proposals/{proposal['id']}/milestones"
    payload = {"code": "prototype", "evidence": "Прототип проверен на 20 тестовых примерах."}
    first = client.post(milestone_url, headers=business, json=payload)
    second = client.post(milestone_url, headers=business, json=payload)
    assert first.status_code == second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    with app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(Milestone)) == 1
    assert (
        client.get("/api/v1/teams/me", headers={"X-Actor-ID": "student-2"}).json()["points"] == 20
    )


def test_zero_score_is_visible_and_accepts_unlimited_proposals(client, business):
    task = publish(client, create_task(client, business), business)
    assert task["rating"]["score"] == 0
    catalog = client.get("/api/v1/catalog?readiness=draft").json()
    assert catalog["total"] == 1
    for _ in range(3):
        assert submit(client, task).status_code == 201
    proposals = client.get(f"/api/v1/tasks/{task['id']}/proposals", headers=business).json()
    assert len(proposals) == 3
    assert all(proposal["status"] == "pending" for proposal in proposals)
    url = f"/api/v1/proposals/{proposals[0]['id']}"
    assert (
        client.post(
            f"{url}/milestones", headers=business, json={"code": "prototype", "evidence": "Demo"}
        ).status_code
        == 409
    )
    assert (
        client.post(f"{url}/decision", headers=business, json={"decision": "rejected"}).json()[
            "status"
        ]
        == "rejected"
    )
    assert (
        client.post(f"{url}/decision", headers=business, json={"decision": "accepted"}).status_code
        == 409
    )


def test_edits_require_confirmation_and_do_not_leak_to_catalog(client, business, full_card):
    task = create_task(client, business)
    task_url = f"/api/v1/tasks/{task['id']}"
    task = client.put(
        f"{task_url}/card", headers=business, json={"expected_revision": 1, "card": full_card}
    ).json()
    task = publish(client, task, business)
    full_card["data"] = "Новые данные ещё не подтверждены"
    full_card["topic"] = "new-topic"
    edited = client.put(
        f"{task_url}/card",
        headers=business,
        json={"expected_revision": task["revision"], "card": full_card},
    ).json()
    assert edited["rating"]["score"] == 80
    assert edited["confirmed_revision"] is None
    assert post_action(client, edited, "publish", business).status_code == 409
    old = client.get(f"/api/v1/catalog/{task['id']}").json()
    assert old["rating"]["score"] == 100
    assert old["card"]["topic"] == "retail"
    assert old["card"]["data"] != full_card["data"]
    assert post_action(client, task, "confirm", business).status_code == 409
    assert (
        client.put(
            f"{task_url}/card", headers=business, json={"expected_revision": 1, "card": full_card}
        ).status_code
        == 409
    )
    publish(client, edited, business)
    assert client.get("/api/v1/catalog?topic=new-topic").json()["total"] == 1


def test_ownership_private_drafts_and_invalid_requests(client, business):
    task = create_task(client, business)
    url = f"/api/v1/tasks/{task['id']}"
    assert client.get("/api/v1/catalog").json()["total"] == 0
    assert client.get(f"/api/v1/catalog/{task['id']}").status_code == 404
    assert client.get(url).status_code == 401
    assert client.get(url, headers={"X-Actor-ID": "business-2"}).status_code == 404
    assert (
        client.post(f"{url}/assist", headers={"X-Actor-ID": "business-2"}, json={}).status_code
        == 404
    )
    assert submit(client, task).status_code == 404
    assert (
        client.post(
            "/api/v1/tasks", headers=business, json={"raw_description": "  ", "topic": "retail"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/tasks",
            headers=business,
            json={"raw_description": "Task", "topic": "retail", "score": 100},
        ).json()["error"]["code"]
        == "VALIDATION_ERROR"
    )
    assert (
        client.post(
            f"{url}/assist", headers=business, json={"answers": {"title": "x" * 201}}
        ).status_code
        == 422
    )
    publish(client, task, business)
    proposal = submit(client, task).json()
    assert (
        client.post(
            f"/api/v1/proposals/{proposal['id']}/decision",
            headers={"X-Actor-ID": "business-2"},
            json={"decision": "accepted"},
        ).status_code
        == 404
    )
    assert (
        client.get("/api/v1/proposals/mine", headers={"X-Actor-ID": "student-1"}).json()[0]["id"]
        == proposal["id"]
    )
    assert client.get("/api/v1/catalog?limit=0").status_code == 422


def test_seed_is_idempotent_and_catalog_sorted_filtered(client, app):
    with app.state.session_factory() as db:
        seed_demo(db)
        seed_demo(db)
        assert db.scalar(select(func.count()).select_from(Task)) == 10
        assert db.scalar(select(func.count()).select_from(Team)) == 5
        assert db.scalar(select(func.count()).select_from(Proposal)) == 5
    page = client.get("/api/v1/catalog").json()
    scores = [item["rating"]["score"] for item in page["items"]]
    assert scores == [100, 90, 80, 55, 20]
    assert client.get("/api/v1/catalog?topic=retail").json()["total"] == 1
    assert client.get("/api/v1/catalog?readiness=priority").json()["total"] == 2
    assert len(client.get("/api/v1/catalog?limit=2&offset=2").json()["items"]) == 2
    assert client.get("/api/v1/catalog?offset=100").json()["items"] == []


def test_concurrent_writes_are_rejected(client, app, business):
    task = create_task(client, business)
    with app.state.session_factory() as first, app.state.session_factory() as second:
        old = first.get(Task, task["id"])
        newer = second.get(Task, task["id"])
        newer.card = {**newer.card, "title": "Updated by another request"}
        second.commit()
        old.card = {**old.card, "title": "Stale update"}
        import pytest

        with pytest.raises(StaleDataError):
            first.commit()


def test_openapi_and_cors(client):
    schema = client.get("/openapi.json").json()
    assert "/api/v1/tasks/{task_id}/confirm" in schema["paths"]
    response = client.options(
        "/api/v1/tasks",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Content-Type,X-Actor-ID",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
