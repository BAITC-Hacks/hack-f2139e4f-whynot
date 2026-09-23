import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.account_models import Account
from app.auth import hash_password
from app.config import Settings
from app.main import create_app
from app.models import Actor, Team
from app.student_profiles import StudentProfile

ORIGIN = "http://127.0.0.1:5173"
PASSWORD = "quiet willow orbit amber lantern"


@pytest.fixture
def student_app():
    return create_app(Settings(database_url="sqlite://", demo_mode=False, ai_provider="stub"))


@pytest.fixture
def student_client(student_app):
    with TestClient(student_app, headers={"Origin": ORIGIN}) as client:
        yield client


def profile(**changes):
    return {
        "username": "sana_student",
        "phone": "+77010000001",
        "positions": ["Backend", "Frontend"],
        "skills": ["Python", "React"],
        **changes,
    }


def register(client, **changes):
    return client.post(
        "/api/v1/auth/register",
        json={
            "name": "Student Example",
            "email": "student@example.com",
            "role": "student",
            "password": PASSWORD,
            **profile(),
            **changes,
        },
    )


def test_student_registration_normalizes_identity_and_multiple_custom_positions(
    student_client, student_app
):
    response = register(
        student_client,
        username=" @Sana_Student ",
        phone="+7 (701) 000-00-01",
        positions=[" Backend ", "backend", "Robotics engineer"],
        skills=[" Python ", "python", "React"],
    )
    assert response.status_code == 201
    actor = response.json()["actor"]
    assert actor["username"] == "sana_student"
    assert "phone" not in actor
    result = student_client.get("/api/v1/students/profile").json()
    assert result == {
        **profile(positions=["Backend", "Robotics engineer"]),
        "actor_id": actor["id"],
    }
    with student_app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(Team)) == 0


def test_username_unique_case_insensitive_without_losing_current_session(student_client):
    first = register(student_client).json()["actor"]
    duplicate = register(student_client, username="@SANA_STUDENT", email="second@example.com")
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "USERNAME_TAKEN"
    assert student_client.get("/api/v1/auth/me").json()["actor"] == first


@pytest.mark.parametrize(
    "changes",
    [
        {"username": None},
        {"username": "a"},
        {"username": "2student"},
        {"username": "student-name"},
        {"username": "a" * 33},
        {"username": "студент"},
        {"phone": None},
        {"phone": "77010000001"},
        {"phone": "+123"},
        {"phone": "+" + "7" * 16},
        {"phone": "+7abc00000001"},
        {"positions": []},
        {"positions": [" "]},
        {"positions": ["x" * 81]},
        {"positions": [str(i) for i in range(11)]},
        {"skills": []},
        {"skills": [" "]},
        {"skills": ["x" * 101]},
        {"skills": [str(i) for i in range(31)]},
    ],
)
def test_invalid_student_details_do_not_create_account(student_client, student_app, changes):
    result = register(student_client, **changes)
    assert result.status_code == 422
    assert PASSWORD not in result.text
    with student_app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(Account)) == 0


def test_profile_is_private_and_cannot_overwrite_other_student(student_client):
    assert student_client.get("/api/v1/students/profile").status_code == 401
    first = register(student_client).json()["actor"]
    student_client.post("/api/v1/auth/logout")
    second = register(
        student_client, email="second@example.com", username="second_student", phone="+77010000002"
    ).json()["actor"]
    current = student_client.get("/api/v1/students/profile").json()
    assert current["actor_id"] == second["id"]
    assert current["phone"] == "+77010000002"
    assert (
        student_client.put(
            "/api/v1/students/profile", json={**profile(), "actor_id": first["id"]}
        ).status_code
        == 422
    )
    occupied = student_client.put("/api/v1/students/profile", json=profile())
    assert occupied.status_code == 409
    assert student_client.get("/api/v1/students/profile").json() == current
    saved = student_client.put(
        "/api/v1/students/profile", json=profile(username="@New_Student", phone="+77010000003")
    )
    assert saved.status_code == 200
    assert saved.json()["actor_id"] == second["id"]
    assert student_client.get("/api/v1/auth/me").json()["actor"]["username"] == "new_student"
    student_client.post("/api/v1/auth/logout")
    student_client.post(
        "/api/v1/auth/login", json={"email": "student@example.com", "password": PASSWORD}
    )
    assert student_client.get("/api/v1/students/profile").json() == {
        **profile(),
        "actor_id": first["id"],
    }


def test_business_registration_unchanged_but_cannot_read_student_profile(student_client):
    result = student_client.post(
        "/api/v1/auth/register",
        json={
            "name": "Business",
            "email": "business@example.com",
            "password": PASSWORD,
            "role": "business",
        },
    )
    assert result.status_code == 201
    assert student_client.get("/api/v1/students/profile").status_code == 403
    assert student_client.put("/api/v1/students/profile", json=profile()).status_code == 403


def test_legacy_student_can_complete_profile_without_recreating_account(
    student_client, student_app
):
    with student_app.state.session_factory() as db:
        db.add(Actor(id="legacy-student", name="Existing student", role="student"))
        db.flush()
        db.add(
            Account(
                actor_id="legacy-student",
                email="legacy@example.com",
                password_hash=hash_password(PASSWORD),
            )
        )
        db.commit()
    response = student_client.post(
        "/api/v1/auth/login", json={"email": "legacy@example.com", "password": PASSWORD}
    )
    assert response.status_code == 200
    assert response.json()["actor"]["username"] is None
    assert student_client.get("/api/v1/students/profile").json()["phone"] == ""
    blocked = student_client.post("/api/v1/teams", json={"name": "Legacy team"})
    assert blocked.status_code == 409
    assert blocked.json()["error"]["code"] == "STUDENT_PROFILE_REQUIRED"
    assert student_client.put("/api/v1/students/profile", json=profile()).status_code == 200
    assert student_client.post("/api/v1/teams", json={"name": "Legacy team"}).status_code == 201
    with student_app.state.session_factory() as db:
        assert db.get(StudentProfile, "legacy-student").username == "sana_student"
