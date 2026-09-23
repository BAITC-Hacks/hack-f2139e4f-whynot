import hashlib
import unicodedata

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import passwords
from app.account_models import Account, PasswordReset
from app.auth import issue_password_reset, token_digest
from app.config import Settings
from app.main import create_app
from app.models import Actor

ORIGIN = "http://127.0.0.1:5173"
SAFE_PASSWORD = "copper orchard glacier lantern"


@pytest.fixture
def client(tmp_path):
    app = create_app(
        Settings(
            database_url="sqlite://",
            demo_mode=False,
            ai_provider="stub",
            mail_mode="file",
            mail_outbox_dir=str(tmp_path / "outbox"),
        )
    )
    with TestClient(app, headers={"Origin": ORIGIN}) as client:
        yield client


def strength(client, password):
    return client.post("/api/v1/auth/password-strength", json={"password": password})


def register(client, password=SAFE_PASSWORD):
    return client.post(
        "/api/v1/auth/register",
        json={
            "name": "Test business",
            "email": "password-test@example.com",
            "password": password,
            "role": "business",
        },
    )


def login(client, password):
    return client.post(
        "/api/v1/auth/login",
        json={
            "email": "password-test@example.com",
            "password": password,
        },
    )


def reset_token(client):
    with client.app.state.session_factory() as db:
        account = db.scalar(select(Account))
        token = issue_password_reset(db, account)
        db.commit()
        return token


@pytest.mark.parametrize(
    "candidate,score,level,label,acceptable",
    [
        ("passwordpassword", 0, "weak", "Слабый", False),
        ("orangeorange12345", 1, "weak", "Слабый", True),
        ("sugarcubesugarcube", 2, "fair", "Нормальный", True),
        (SAFE_PASSWORD, 4, "strong", "Хороший", True),
    ],
)
def test_meter_returns_real_local_scores_and_safe_russian_guidance(
    client,
    candidate,
    score,
    level,
    label,
    acceptable,
):
    response = strength(client, candidate)
    assert response.status_code == 200
    body = response.json()
    assert (body["score"], body["level"], body["label"]) == (score, level, label)
    assert body["acceptable"] == acceptable
    assert body["length"] == len(candidate)
    assert body["min_length"] == 15 and body["max_length"] == 128
    assert [check["code"] for check in body["checks"]] == ["min_length", "max_length", "not_common"]
    assert all(isinstance(check["passed"], bool) for check in body["checks"])
    assert body["suggestions"] and candidate not in response.text
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("length", [0, 14, 15, 128, 129, 1024])
def test_meter_reports_full_length_without_truncation(client, length):
    candidate = ("qrkstujvwlxpymnz" * 70)[:length]
    response = strength(client, candidate)
    assert response.status_code == 200
    body = response.json()
    assert body["length"] == length
    assert body["acceptable"] == (15 <= length <= 128)
    assert body["checks"][0]["passed"] == (length >= 15)
    assert body["checks"][1]["passed"] == (length <= 128)


def test_meter_counts_unicode_codepoints_after_nfc(client):
    candidate = "e\u0301" * 10 + "🦊" * 5
    body = strength(client, candidate).json()
    assert body["length"] == 15
    assert body["acceptable"] is True
    assert strength(client, "🦊" * 14).json()["checks"][0]["passed"] is False


@pytest.mark.parametrize(
    "candidate",
    [
        "123456789012345",
        "abcdefghijklmnop",
        "а" * 15,
        "AI SANA PASSWORD",
        "correct horse battery staple",
        "PasswordPassword",
        "TaskRank password",
    ],
)
def test_common_long_values_are_blocked_consistently_in_meter_and_registration(client, candidate):
    meter = strength(client, candidate).json()
    assert meter["checks"][0]["passed"] is True
    assert meter["checks"][2]["passed"] is False
    assert not meter["acceptable"]
    response = register(client, candidate)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "WEAK_PASSWORD"
    assert candidate not in response.text
    with client.app.state.session_factory() as db:
        assert db.scalar(select(Account)) is None


@pytest.mark.parametrize("candidate", ["fourteenchars!", "r" * 129, ""])
def test_register_rejects_client_bypass_of_length_policy(client, candidate):
    response = register(client, candidate)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "WEAK_PASSWORD"


@pytest.mark.parametrize(
    "candidate",
    [
        "passwordpassword beneath distant amber mountains",
        "taskrank password beneath distant amber mountains",
    ],
)
def test_long_lowercase_phrase_with_blocklisted_substring_is_allowed(client, candidate):
    body = strength(client, candidate).json()
    assert body["acceptable"] is True
    assert register(client, candidate).status_code == 201
    assert login(client, candidate).status_code == 200


def test_score_is_advisory_not_an_additional_mandatory_rule(client):
    candidate = "orangeorange12345"
    body = strength(client, candidate).json()
    assert body["level"] == "weak" and body["acceptable"] is True
    assert register(client, candidate).status_code == 201


@pytest.mark.parametrize("weak", ["PasswordPassword", "short", "p" * 129])
def test_reset_enforces_same_policy_without_consuming_valid_token(client, weak):
    register(client)
    token = reset_token(client)
    response = client.post("/api/v1/auth/reset-password", json={"token": token, "password": weak})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "WEAK_PASSWORD"
    assert token not in response.text and weak not in response.text
    with client.app.state.session_factory() as db:
        assert db.get(PasswordReset, token_digest(token)) is not None
    accepted = client.post(
        "/api/v1/auth/reset-password",
        json={
            "token": token,
            "password": "distant coral meadow lantern",
        },
    )
    assert accepted.status_code == 200
    assert login(client, "distant coral meadow lantern").status_code == 200


@pytest.mark.parametrize("through_reset", [False, True])
def test_normalized_128_character_password_logs_in_with_long_decomposed_representation(
    client,
    through_reset,
):
    canonical = "éabcdefghij" * 11 + "éabcdef"
    decomposed = unicodedata.normalize("NFD", canonical)
    assert len(canonical) == 128 and len(decomposed) > 128
    assert strength(client, decomposed).json()["length"] == 128
    if through_reset:
        register(client)
        response = client.post(
            "/api/v1/auth/reset-password",
            json={
                "token": reset_token(client),
                "password": decomposed,
            },
        )
        assert response.status_code == 200
    else:
        assert register(client, decomposed).status_code == 201
    assert login(client, decomposed).status_code == 200
    assert login(client, canonical).status_code == 200
    assert login(client, canonical[:-1] + "x").status_code == 401
    with client.app.state.session_factory() as db:
        assert db.scalar(select(Account)).password_hash.startswith("scrypt-nfc$")


def test_leading_trailing_spaces_are_preserved_when_hashing(client):
    candidate = "  " + SAFE_PASSWORD + "  "
    assert register(client, candidate).status_code == 201
    assert login(client, candidate).status_code == 200
    assert login(client, candidate.strip()).status_code == 401


@pytest.mark.parametrize("legacy", ["oldpassword!", "e\u0301abcd" * 3])
def test_existing_legacy_hashes_remain_usable_without_new_policy_or_normalization(client, legacy):
    salt = b"legacy-test-salt"
    digest = hashlib.scrypt(
        legacy.encode("utf-8"),
        salt=salt,
        n=2**17,
        r=8,
        p=1,
        dklen=64,
        maxmem=256 * 1024 * 1024,
    ).hex()
    with client.app.state.session_factory() as db:
        db.add(Actor(id="legacy", role="business", name="Legacy business"))
        db.flush()
        db.add(
            Account(
                actor_id="legacy",
                email="password-test@example.com",
                password_hash=f"scrypt$131072$8$1${salt.hex()}${digest}",
            )
        )
        db.commit()
    assert login(client, legacy).status_code == 200
    if unicodedata.normalize("NFC", legacy) != legacy:
        assert login(client, unicodedata.normalize("NFC", legacy)).status_code == 401


def test_oversized_candidates_do_not_reach_expensive_estimator(client, monkeypatch):
    def must_not_run(*_args, **_kwargs):
        raise AssertionError("Oversized candidate reached estimator")

    monkeypatch.setattr(passwords, "zxcvbn", must_not_run)
    assert strength(client, "q" * 1024).json()["acceptable"] is False
    too_large = strength(client, "q" * 1025)
    assert too_large.status_code == 422
    assert "q" * 1025 not in too_large.text


def test_estimator_failures_do_not_leak_password_or_disable_server_policy(
    client, monkeypatch, caplog
):
    def fail(candidate, **_kwargs):
        raise RuntimeError("upstream detail " + candidate)

    monkeypatch.setattr(passwords, "zxcvbn", fail)
    response = strength(client, SAFE_PASSWORD)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "PASSWORD_STRENGTH_UNAVAILABLE"
    assert SAFE_PASSWORD not in response.text and SAFE_PASSWORD not in caplog.text
    assert register(client).status_code == 201


def test_estimator_result_is_filtered_to_safe_fields(client, monkeypatch):
    def estimate(candidate, **_kwargs):
        return {
            "password": candidate,
            "score": 3,
            "feedback": {"warning": candidate},
            "sequence": [{"pattern": "dictionary", "token": candidate}],
        }

    monkeypatch.setattr(passwords, "zxcvbn", estimate)
    response = strength(client, SAFE_PASSWORD)
    assert response.status_code == 200
    assert SAFE_PASSWORD not in response.text
    assert set(response.json()) == {
        "score",
        "level",
        "label",
        "acceptable",
        "length",
        "min_length",
        "max_length",
        "checks",
        "suggestions",
    }


def test_meter_concurrency_limit_returns_safe_busy_response(client):
    assert passwords._estimate_slots.acquire(blocking=False)
    assert passwords._estimate_slots.acquire(blocking=False)
    try:
        response = strength(client, SAFE_PASSWORD)
        assert response.status_code == 503
        assert response.json()["error"]["code"] == "PASSWORD_STRENGTH_UNAVAILABLE"
    finally:
        passwords._estimate_slots.release()
        passwords._estimate_slots.release()
    assert strength(client, SAFE_PASSWORD).status_code == 200


def test_meter_requires_trusted_origin_and_limits_sixty_checks_per_minute(client):
    response = client.post(
        "/api/v1/auth/password-strength",
        headers={"Origin": "https://evil.example"},
        json={"password": SAFE_PASSWORD},
    )
    assert response.status_code == 403
    for _ in range(60):
        assert strength(client, "").status_code == 200
    limited = strength(client, "")
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "RATE_LIMITED"
    # Preview requests do not consume registration's independent attempt bucket.
    assert register(client).status_code == 201
