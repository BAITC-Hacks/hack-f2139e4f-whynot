import pytest
from sqlalchemy import func, select

from app.chat_models import ChatMessage
from app.models import Actor, Proposal, Task, Team
from app.student_profiles import StudentProfile
from app.team_models import TeamMembership


def headers(actor_id):
    return {"X-Actor-ID": actor_id}


@pytest.fixture
def chat_setup(client, app, full_card):
    with app.state.session_factory() as db:
        db.add_all(
            [
                Actor(id="chat-leader", name="Лидер", role="student"),
                Actor(id="chat-member", name="Участник", role="student"),
                Actor(id="chat-member-2", name="Второй участник", role="student"),
                Actor(id="chat-outsider", name="Другая команда", role="student"),
                Actor(id="chat-no-team", name="Без команды", role="student"),
            ]
        )
        db.flush()
        db.add_all(
            [
                Team(id="chat-team", owner_id="chat-leader", name="Команда из трёх"),
                Team(id="other-chat-team", owner_id="chat-outsider", name="Другая команда"),
                Task(
                    id="chat-task",
                    owner_id="business-1",
                    raw_description="Задача для команды",
                    card=full_card,
                    published_card=full_card,
                    published_revision=1,
                ),
            ]
        )
        db.flush()
        db.add_all(
            [
                TeamMembership(actor_id="chat-leader", team_id="chat-team", slot=1),
                TeamMembership(actor_id="chat-member", team_id="chat-team", slot=2),
                TeamMembership(actor_id="chat-member-2", team_id="chat-team", slot=3),
                TeamMembership(actor_id="chat-outsider", team_id="other-chat-team", slot=1),
                StudentProfile(
                    actor_id="chat-leader", username="team_leader", phone="+77001112233"
                ),
                StudentProfile(
                    actor_id="chat-member", username="private_member", phone="+77009998877"
                ),
                Proposal(
                    id="chat-proposal",
                    task_id="chat-task",
                    team_id="chat-team",
                    idea="Идея",
                    plan="План",
                    timeline="Неделя",
                    status="pending",
                ),
                Proposal(
                    id="another-chat-proposal",
                    task_id="chat-task",
                    team_id="chat-team",
                    idea="Другая идея",
                    plan="План",
                    timeline="Неделя",
                    status="accepted",
                ),
            ]
        )
        db.commit()
    return "chat-proposal"


def send(client, actor_id, body, proposal_id="chat-proposal"):
    return client.post(
        f"/api/v1/proposals/{proposal_id}/messages", headers=headers(actor_id), json={"body": body}
    )


@pytest.mark.parametrize("status", ["pending", "accepted"])
def test_business_and_all_current_members_share_durable_chat(client, app, chat_setup, status):
    with app.state.session_factory() as db:
        db.get(Proposal, chat_setup).status = status
        db.commit()
    authors = ["business-1", "chat-leader", "chat-member", "chat-member-2"]
    messages = []
    for actor_id in authors:
        response = send(client, actor_id, f"  Сообщение {actor_id}  ")
        assert response.status_code == 201, response.text
        assert response.headers["cache-control"] == "no-store"
        message = response.json()
        assert message["sender_id"] == actor_id
        assert message["body"] == f"Сообщение {actor_id}"
        assert message["sender_role"] == ("business" if actor_id == "business-1" else "student")
        assert message["sender_name"]
        assert message["created_at"].endswith("Z")
        messages.append(message)
    for actor_id in authors:
        response = client.get(f"/api/v1/proposals/{chat_setup}/messages", headers=headers(actor_id))
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json() == {"items": messages, "has_more": False}
    with app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(ChatMessage)) == 4
        assert db.get(ChatMessage, messages[0]["id"]).body == messages[0]["body"]


@pytest.mark.parametrize("actor_id", [None, "business-2", "chat-outsider", "chat-no-team"])
def test_chat_and_contact_deny_anonymous_and_nonparticipants(client, chat_setup, actor_id):
    expected = 401 if actor_id is None else 404
    request_headers = headers(actor_id) if actor_id else {}
    for suffix in ("messages", "contact"):
        response = client.get(f"/api/v1/proposals/{chat_setup}/{suffix}", headers=request_headers)
        assert response.status_code == expected, response.text
    response = client.post(
        f"/api/v1/proposals/{chat_setup}/messages",
        headers=request_headers,
        json={"body": "Сообщение"},
    )
    assert response.status_code == expected
    assert "Лидер" not in response.text
    assert "+77001112233" not in response.text


def test_missing_proposal_is_not_found_for_authenticated_actor(client, chat_setup):
    for suffix in ("messages", "contact"):
        response = client.get(f"/api/v1/proposals/missing/{suffix}", headers=headers("business-1"))
        assert response.status_code == 404
    assert send(client, "chat-leader", "Сообщение", proposal_id="missing").status_code == 404


def test_departed_member_loses_chat_and_contact_but_messages_remain(client, app, chat_setup):
    assert send(client, "chat-member", "Сообщение до выхода").status_code == 201
    with app.state.session_factory() as db:
        db.delete(db.get(TeamMembership, "chat-member"))
        db.commit()
    for suffix in ("messages", "contact"):
        response = client.get(
            f"/api/v1/proposals/{chat_setup}/{suffix}", headers=headers("chat-member")
        )
        assert response.status_code == 404
    assert send(client, "chat-member", "Сообщение после выхода").status_code == 404
    remaining = client.get(
        f"/api/v1/proposals/{chat_setup}/messages", headers=headers("business-1")
    ).json()
    assert len(remaining["items"]) == 1
    assert remaining["items"][0]["sender_id"] == "chat-member"
    with app.state.session_factory() as db:
        db.add(TeamMembership(actor_id="chat-no-team", team_id="chat-team", slot=2))
        db.commit()
    joined = client.get(f"/api/v1/proposals/{chat_setup}/messages", headers=headers("chat-no-team"))
    assert joined.status_code == 200
    assert joined.json() == remaining
    assert send(client, "chat-no-team", "Я новый участник").status_code == 201


def test_rejected_proposal_chat_is_read_only(client, app, chat_setup):
    assert send(client, "chat-leader", "До решения").status_code == 201
    with app.state.session_factory() as db:
        db.get(Proposal, chat_setup).status = "rejected"
        db.commit()
    for actor_id in ("business-1", "chat-leader", "chat-member"):
        response = send(client, actor_id, "После отказа")
        assert response.status_code == 409
        assert response.json()["error"]["code"] == "CHAT_READ_ONLY"
        page = client.get(
            f"/api/v1/proposals/{chat_setup}/messages", headers=headers(actor_id)
        ).json()
        assert len(page["items"]) == 1
        assert page["items"][0]["body"] == "До решения"


@pytest.mark.parametrize(
    "payload",
    [
        {"body": ""},
        {"body": " \n\t "},
        {"body": "я" * 4001},
        {"body": None},
        {"body": 1},
        {"body": "Текст", "sender_id": "business-1"},
    ],
)
def test_message_validation_rejects_empty_oversized_and_spoofed_messages(
    client, chat_setup, payload
):
    response = client.post(
        f"/api/v1/proposals/{chat_setup}/messages",
        headers=headers("chat-leader"),
        json=payload,
    )
    assert response.status_code == 422
    page = client.get(
        f"/api/v1/proposals/{chat_setup}/messages", headers=headers("chat-leader")
    ).json()
    assert page["items"] == []


def test_message_body_preserves_plain_text_and_accepts_maximum_length(client, chat_setup):
    literal = '<script>alert("test")</script>\n**Обычный текст**'
    response = send(client, "chat-leader", literal)
    assert response.status_code == 201
    assert response.json()["body"] == literal
    assert send(client, "chat-leader", "я" * 4000).status_code == 201


def test_message_cursor_pagination_never_mixes_other_conversations(client, chat_setup):
    own = []
    for number in range(5):
        own.append(send(client, "chat-leader", f"Текст {number}").json())
        response = send(
            client, "chat-leader", f"Другая переписка {number}", "another-chat-proposal"
        )
        assert response.status_code == 201
    base = f"/api/v1/proposals/{chat_setup}/messages"
    first = client.get(f"{base}?limit=2", headers=headers("business-1")).json()
    second = client.get(
        f"{base}?limit=2&after_id={first['items'][-1]['id']}", headers=headers("business-1")
    ).json()
    third = client.get(
        f"{base}?limit=2&after_id={second['items'][-1]['id']}", headers=headers("business-1")
    ).json()
    assert first["has_more"] is second["has_more"] is True
    assert third["has_more"] is False
    assert [*first["items"], *second["items"], *third["items"]] == own
    assert len({message["id"] for message in own}) == 5
    after_last = client.get(
        f"{base}?after_id={own[-1]['id']}", headers=headers("business-1")
    ).json()
    assert after_last == {"items": [], "has_more": False}
    for query in ("limit=0", "limit=101", "after_id=-1", f"after_id={2**63}"):
        assert client.get(f"{base}?{query}", headers=headers("business-1")).status_code == 422


def test_chat_rate_limit_is_per_actor_across_proposals_and_recovers(
    client,
    chat_setup,
    monkeypatch,
):
    time = [1000.0]
    monkeypatch.setattr("app.auth.monotonic", lambda: time[0])
    for number in range(30):
        proposal_id = chat_setup if number % 2 else "another-chat-proposal"
        assert send(client, "chat-leader", f"Сообщение {number}", proposal_id).status_code == 201
    blocked = send(client, "chat-leader", "Лишнее сообщение")
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "RATE_LIMITED"
    assert send(client, "chat-member", "Другой участник").status_code == 201
    time[0] += 61
    assert send(client, "chat-leader", "Следующая минута").status_code == 201


def test_contact_exposes_only_current_leader_contact_to_participants(client, app, chat_setup):
    expected = {"name": "Лидер", "username": "team_leader", "phone": "+77001112233"}
    for actor_id in ("business-1", "chat-leader", "chat-member", "chat-member-2"):
        response = client.get(f"/api/v1/proposals/{chat_setup}/contact", headers=headers(actor_id))
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json() == expected
        assert "+77009998877" not in response.text
        assert "private_member" not in response.text
    with app.state.session_factory() as db:
        db.get(StudentProfile, "chat-leader").phone = "+77004445566"
        db.commit()
    refreshed = client.get(
        f"/api/v1/proposals/{chat_setup}/contact", headers=headers("business-1")
    ).json()
    assert refreshed == {**expected, "phone": "+77004445566"}
    with app.state.session_factory() as db:
        db.delete(db.get(StudentProfile, "chat-leader"))
        db.commit()
    legacy = client.get(
        f"/api/v1/proposals/{chat_setup}/contact", headers=headers("business-1")
    ).json()
    assert legacy == {"name": "Лидер", "username": None, "phone": ""}
