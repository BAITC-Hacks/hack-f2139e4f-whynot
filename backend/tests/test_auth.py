from datetime import timedelta
from email import policy
from email.parser import BytesParser
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.account_models import Account, LoginSession, PasswordReset
from app.auth import SESSION_COOKIE, AuthRateLimiter, hash_password, token_digest, verify_password
from app.config import Settings
from app.errors import DomainError
from app.main import create_app
from app.models import Actor, Team, now

ORIGIN = "http://127.0.0.1:5173"
PASSWORD = "correct horse battery staple"
NEW_PASSWORD = "replacement secure passphrase"


@pytest.fixture
def auth_app(tmp_path):
    return create_app(
        Settings(
            database_url="sqlite://",
            demo_mode=False,
            ai_provider="stub",
            mail_mode="file",
            mail_outbox_dir=str(tmp_path / "outbox"),
            frontend_url=ORIGIN,
        )
    )


@pytest.fixture
def auth_client(auth_app):
    with TestClient(auth_app, headers={"Origin": ORIGIN}) as client:
        yield client


def register(client, email="business@example.com", role="business"):
    return client.post(
        "/api/v1/auth/register",
        json={
            "name": "Test business" if role == "business" else "Test student",
            "email": email,
            "password": PASSWORD,
            "role": role,
            **(
                {
                    "username": "test_student",
                    "phone": "+77010000001",
                    "positions": ["Backend"],
                    "skills": ["Python"],
                }
                if role == "student"
                else {}
            ),
        },
    )


def login(client, email="business@example.com", password=PASSWORD):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def read_reset_token(app):
    from pathlib import Path

    mails = sorted(Path(app.state.settings.mail_outbox_dir).glob("*.eml"))
    assert len(mails) == 1
    mail = BytesParser(policy=policy.default).parsebytes(mails[0].read_bytes())
    content = mail.get_content()
    url = next(line for line in content.splitlines() if line.startswith("http"))
    assert url.startswith(ORIGIN + "/reset-password#token=")
    assert urlsplit(url).query == ""
    return parse_qs(urlsplit(url).fragment)["token"][0]


def test_register_cookie_and_hash_keep_password_and_token_private(auth_client, auth_app):
    response = register(auth_client, " Business@Example.COM ")
    assert response.status_code == 201
    actor = response.json()["actor"]
    assert actor["email"] == "business@example.com"
    assert actor["role"] == "business"
    assert PASSWORD not in response.text
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/api" in cookie
    token = auth_client.cookies[SESSION_COOKIE]
    with auth_app.state.session_factory() as db:
        account = db.get(Account, actor["id"])
        assert account.password_hash.startswith("scrypt$131072$8$1$")
        assert PASSWORD not in account.password_hash
        assert verify_password(PASSWORD, account.password_hash)
        assert db.get(LoginSession, token) is None
        assert db.get(LoginSession, token_digest(token)).actor_id == actor["id"]
    assert auth_client.get("/api/v1/auth/me").json() == response.json()
    assert auth_client.get("/api/v1/auth/me").headers["cache-control"] == "no-store"


def test_student_starts_without_team_and_cannot_create_business_task(auth_client, auth_app):
    actor = register(auth_client, "student@example.com", "student").json()["actor"]
    with auth_app.state.session_factory() as db:
        team = db.scalar(select(Team).where(Team.owner_id == actor["id"]))
        assert team is None
    assert auth_client.get("/api/v1/teams/me").status_code == 409
    assert auth_client.get("/api/v1/students/profile").json()["username"] == "test_student"
    assert (
        auth_client.post(
            "/api/v1/tasks",
            json={
                "raw_description": "Test task description",
                "topic": "retail",
            },
        ).status_code
        == 403
    )


def test_logout_revokes_server_session_and_login_rotates(auth_client):
    register(auth_client)
    original = auth_client.cookies[SESSION_COOKIE]
    assert login(auth_client).status_code == 200
    replacement = auth_client.cookies[SESSION_COOKIE]
    assert replacement != original
    assert (
        auth_client.get(
            "/api/v1/auth/me",
            headers={
                "Cookie": f"{SESSION_COOKIE}={original}",
            },
        ).status_code
        == 401
    )
    assert auth_client.post("/api/v1/auth/logout").status_code == 200
    assert SESSION_COOKIE not in auth_client.cookies
    assert (
        auth_client.get(
            "/api/v1/auth/me",
            headers={
                "Cookie": f"{SESSION_COOKIE}={replacement}",
            },
        ).status_code
        == 401
    )


def test_invalid_credentials_are_generic(auth_client):
    register(auth_client)
    known = login(auth_client, password="incorrect-password")
    unknown = login(auth_client, email="missing@example.com", password="incorrect-password")
    assert known.status_code == unknown.status_code == 401
    assert known.json() == unknown.json()


def test_expired_session_and_header_spoofing_rejected(auth_client, auth_app):
    actor = register(auth_client).json()["actor"]
    with auth_app.state.session_factory() as db:
        db.execute(update(LoginSession).values(expires_at=now() - timedelta(seconds=1)))
        db.commit()
    assert auth_client.get("/api/v1/auth/me").status_code == 401
    assert (
        auth_client.get("/api/v1/tasks/mine", headers={"X-Actor-ID": actor["id"]}).status_code
        == 401
    )
    auth_client.cookies.clear()
    assert (
        auth_client.get("/api/v1/tasks/mine", headers={"X-Actor-ID": actor["id"]}).status_code
        == 401
    )
    assert auth_client.get("/api/v1/demo/actors").status_code == 404


def test_registered_accounts_cannot_be_impersonated_even_in_demo(tmp_path):
    app = create_app(Settings(database_url="sqlite://", demo_mode=True, ai_provider="stub"))
    with TestClient(app, headers={"Origin": ORIGIN}) as client:
        actor = register(client).json()["actor"]
        demo_ids = [item["id"] for item in client.get("/api/v1/demo/actors").json()]
        assert actor["id"] not in demo_ids
        assert "business-1" in demo_ids
        assert (
            client.get(
                "/api/v1/auth/me",
                headers={
                    "X-Actor-ID": "business-1",
                },
            ).json()["actor"]["id"]
            == actor["id"]
        )
        client.cookies.clear()
        assert (
            client.get("/api/v1/tasks/mine", headers={"X-Actor-ID": actor["id"]}).status_code == 401
        )
        assert (
            client.get("/api/v1/tasks/mine", headers={"X-Actor-ID": "business-1"}).status_code
            == 200
        )


def test_businesses_cannot_read_each_others_private_tasks(auth_client):
    register(auth_client)
    created = auth_client.post(
        "/api/v1/tasks",
        json={
            "raw_description": "Business one private task description",
            "topic": "retail",
        },
    )
    assert created.status_code == 201
    task_id = created.json()["id"]
    auth_client.post("/api/v1/auth/logout")
    register(auth_client, "second@example.com")
    assert auth_client.get(f"/api/v1/tasks/{task_id}").status_code in {403, 404}
    listing = auth_client.get("/api/v1/tasks/mine").json()
    assert task_id not in str(listing)


def test_password_reset_private_single_use_revokes_all_sessions(auth_client, auth_app):
    register(auth_client)
    first = auth_client.cookies[SESSION_COOKIE]
    # Keep an independent active session, as if logged in on another device.
    auth_client.cookies.clear()
    login(auth_client)
    second = auth_client.cookies[SESSION_COOKIE]
    response = auth_client.post(
        "/api/v1/auth/forgot-password",
        json={
            "email": "business@example.com",
        },
    )
    missing = auth_client.post(
        "/api/v1/auth/forgot-password",
        json={
            "email": "absent@example.com",
        },
    )
    assert response.status_code == missing.status_code == 200
    assert response.json() == missing.json()
    token = read_reset_token(auth_app)
    assert token not in response.text
    with auth_app.state.session_factory() as db:
        assert db.get(PasswordReset, token) is None
        assert db.get(PasswordReset, token_digest(token)) is not None
    reset = auth_client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": token,
            "password": NEW_PASSWORD,
        },
    )
    assert reset.status_code == 200
    for old_session in (first, second):
        assert (
            auth_client.get(
                "/api/v1/auth/me",
                headers={
                    "Cookie": f"{SESSION_COOKIE}={old_session}",
                },
            ).status_code
            == 401
        )
    assert (
        auth_client.post(
            "/api/v1/auth/reset-password",
            json={
                "token": token,
                "password": NEW_PASSWORD,
            },
        ).status_code
        == 400
    )
    assert login(auth_client).status_code == 401
    assert login(auth_client, password=NEW_PASSWORD).status_code == 200


def test_expired_reset_cannot_change_password(auth_client, auth_app):
    register(auth_client)
    auth_client.post("/api/v1/auth/forgot-password", json={"email": "business@example.com"})
    token = read_reset_token(auth_app)
    with auth_app.state.session_factory() as db:
        db.execute(update(PasswordReset).values(expires_at=now() - timedelta(seconds=1)))
        db.commit()
    assert (
        auth_client.post(
            "/api/v1/auth/reset-password",
            json={
                "token": token,
                "password": NEW_PASSWORD,
            },
        ).status_code
        == 400
    )
    assert login(auth_client).status_code == 200


@pytest.mark.parametrize("origin", ["https://attacker.example", "null", ""])
def test_login_and_cookie_writes_reject_untrusted_origins(auth_client, origin):
    register(auth_client)
    assert (
        auth_client.post(
            "/api/v1/auth/login",
            headers={"Origin": origin},
            json={
                "email": "business@example.com",
                "password": PASSWORD,
            },
        ).status_code
        == 403
    )
    assert auth_client.post("/api/v1/auth/logout", headers={"Origin": origin}).status_code == 403
    assert (
        auth_client.post(
            "/api/v1/tasks",
            headers={"Origin": origin},
            json={
                "raw_description": "Test description",
                "topic": "retail",
            },
        ).status_code
        == 403
    )
    assert auth_client.get("/api/v1/auth/me").status_code == 200


def test_credentialed_cors_preflight(auth_client):
    response = auth_client.options(
        "/api/v1/auth/register",
        headers={
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ORIGIN
    assert response.headers["access-control-allow-credentials"] == "true"


def test_auth_account_attempts_rate_limited_without_revealing_account(auth_client):
    for _ in range(8):
        assert (
            auth_client.post(
                "/api/v1/auth/forgot-password",
                json={
                    "email": "nonexistent@example.com",
                },
            ).status_code
            == 200
        )
    assert (
        auth_client.post(
            "/api/v1/auth/forgot-password",
            json={
                "email": "nonexistent@example.com",
            },
        ).status_code
        == 429
    )


@pytest.mark.parametrize("password", ["short", "x" * 129])
def test_registration_password_policy(auth_client, password):
    result = auth_client.post(
        "/api/v1/auth/register",
        json={
            "name": "Business",
            "email": "test@example.com",
            "role": "business",
            "password": password,
        },
    )
    assert result.status_code == 422
    assert password not in result.text


def test_cannot_register_privileged_role(auth_client):
    result = auth_client.post(
        "/api/v1/auth/register",
        json={
            "name": "Business",
            "email": "test@example.com",
            "role": "admin",
            "password": PASSWORD,
        },
    )
    assert result.status_code == 422


def test_email_recovery_delivery_failure_does_not_enumerate(auth_client, monkeypatch):
    register(auth_client)

    def fail(*_args):
        raise OSError("private SMTP server reply")

    monkeypatch.setattr("app.api.auth.deliver_reset_mail", fail)
    existing = auth_client.post(
        "/api/v1/auth/forgot-password",
        json={
            "email": "business@example.com",
        },
    )
    missing = auth_client.post(
        "/api/v1/auth/forgot-password",
        json={
            "email": "nobody@example.com",
        },
    )
    assert existing.status_code == missing.status_code == 200
    assert existing.json() == missing.json()


def test_password_change_during_login_cannot_create_session(auth_client, auth_app, monkeypatch):
    actor_id = register(auth_client).json()["actor"]["id"]
    auth_client.post("/api/v1/auth/logout")

    def verify_while_resetting(password, stored):
        assert verify_password(password, stored)
        # Simulate a reset committing while this request hashes the old password.
        with auth_app.state.session_factory() as db:
            db.execute(
                update(Account)
                .where(Account.actor_id == actor_id)
                .values(password_hash=hash_password(NEW_PASSWORD))
            )
            db.commit()
        return True

    monkeypatch.setattr("app.api.auth.verify_password", verify_while_resetting)
    assert login(auth_client).status_code == 401
    assert SESSION_COOKIE not in auth_client.cookies
    with auth_app.state.session_factory() as db:
        assert db.scalar(select(LoginSession)) is None


def test_registration_duplicate_at_flush_rolls_back_and_keeps_original_session(
    auth_client,
    auth_app,
    monkeypatch,
):
    actor = register(auth_client).json()["actor"]
    original_scalar = Session.scalar

    def stale_account_lookup(self, statement, *args, **kwargs):
        descriptions = getattr(statement, "column_descriptions", [])
        if descriptions and descriptions[0].get("entity") is Account:
            # A competing signup may commit after this optimistic pre-check.
            return None
        return original_scalar(self, statement, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Session, "scalar", stale_account_lookup)
        response = register(auth_client, role="student")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "ACCOUNT_EXISTS"
    assert auth_client.get("/api/v1/auth/me").json()["actor"] == actor
    with auth_app.state.session_factory() as db:
        assert [row.id for row in db.scalars(select(Actor))] == [actor["id"]]
        assert db.scalars(select(Team)).all() == []
        assert len(db.scalars(select(Account)).all()) == 1
        assert len(db.scalars(select(LoginSession)).all()) == 1


def test_chat_window_does_not_expire_login_attempts(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr("app.auth.monotonic", lambda: clock[0])
    limiter = AuthRateLimiter()
    limiter.check("login", 1, window=900)
    clock[0] = 61
    limiter.check("chat", 30, window=60)
    with pytest.raises(DomainError) as error:
        limiter.check("login", 1, window=900)
    assert error.value.status == 429
    clock[0] = 901
    limiter.check("login", 1, window=900)
