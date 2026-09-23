from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from starlette.datastructures import UploadFile

from app.api.audio import MAX_AUDIO_BYTES
from app.config import Settings
from app.main import create_app


@pytest.fixture
def audio_app(tmp_path):
    return create_app(
        Settings(
            database_url="sqlite://",
            demo_mode=True,
            ai_provider="stub",
            openai_api_key="audio-test-secret",
            mail_outbox_dir=str(tmp_path / "outbox"),
        )
    )


@pytest.fixture
def audio_client(audio_app):
    with TestClient(audio_app) as client:
        yield client


def transcribe(client, content=b"sample audio", filename="recording.webm", actor="business-1"):
    headers = {"X-Actor-ID": actor} if actor else {}
    return client.post(
        "/api/v1/ai/transcribe",
        headers=headers,
        files={"file": (filename, content, "audio/webm")},
    )


@pytest.mark.parametrize("actor,expected", [(None, 401), ("student-1", 403)])
def test_transcription_requires_business(audio_client, monkeypatch, actor, expected):
    async def no_network(*_args, **_kwargs):
        raise AssertionError("Unauthorized request must not use provider")

    monkeypatch.setattr(httpx.AsyncClient, "post", no_network)
    assert transcribe(audio_client, actor=actor).status_code == expected


@pytest.mark.parametrize("key", [None, "", "   "])
def test_missing_key_fails_without_fake_transcription(audio_client, audio_app, monkeypatch, key):
    audio_app.state.settings.openai_api_key = SecretStr(key) if key is not None else None

    async def no_network(*_args, **_kwargs):
        raise AssertionError("Unconfigured transcription must not use provider")

    monkeypatch.setattr(httpx.AsyncClient, "post", no_network)
    response = transcribe(audio_client)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "AI_NOT_CONFIGURED"
    assert "text" not in response.json()


@pytest.mark.parametrize(
    "filename,content,status,code",
    [
        ("recording.webm", b"", 422, "AUDIO_EMPTY"),
        ("notes.txt", b"not audio", 415, "AUDIO_FORMAT"),
        ("recording.webm", b"a" * (MAX_AUDIO_BYTES + 1), 413, "AUDIO_TOO_LARGE"),
    ],
    ids=["empty", "unsupported-format", "oversize"],
)
def test_invalid_upload_never_reaches_provider(
    audio_client,
    monkeypatch,
    filename,
    content,
    status,
    code,
):
    async def no_network(*_args, **_kwargs):
        raise AssertionError("Invalid upload must not use provider")

    monkeypatch.setattr(httpx.AsyncClient, "post", no_network)
    response = transcribe(audio_client, content=content, filename=filename)
    assert response.status_code == status
    assert response.json()["error"]["code"] == code


def test_success_forwards_multipart_closes_file_and_persists_nothing(
    audio_client,
    audio_app,
    monkeypatch,
    tmp_path,
):
    closed = []
    original_close = UploadFile.close

    async def close_upload(self):
        await original_close(self)
        closed.append(self.file.closed)

    async def provider(self, url, **kwargs):
        assert url == "https://api.openai.com/v1/audio/transcriptions"
        assert kwargs["headers"] == {"Authorization": "Bearer audio-test-secret"}
        assert kwargs["data"] == {
            "model": audio_app.state.settings.openai_transcription_model,
            "response_format": "json",
        }
        assert kwargs["files"] == {"file": ("recording.wav", b"voice content", "audio/webm")}
        return httpx.Response(
            200,
            json={"text": "  Нужно автоматизировать учёт товаров.  "},
            request=httpx.Request("POST", url),
        )

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(UploadFile, "close", close_upload)
    monkeypatch.setattr(httpx.AsyncClient, "post", provider)
    response = transcribe(audio_client, content=b"voice content", filename="../../private.wav")
    assert response.status_code == 200
    assert response.json() == {"text": "Нужно автоматизировать учёт товаров.", "provider": "openai"}
    assert closed and all(closed)
    assert list(Path(tmp_path).rglob("*")) == []


@pytest.mark.parametrize("failure", ["http", "timeout", "missing", "empty", "type", "long"])
def test_provider_failure_is_explicit_and_does_not_expose_secret(
    audio_client,
    monkeypatch,
    failure,
):
    async def provider(self, url, **_kwargs):
        request = httpx.Request("POST", url)
        if failure == "timeout":
            raise httpx.ReadTimeout("audio-test-secret provider private details", request=request)
        if failure == "http":
            return httpx.Response(401, json={"error": "audio-test-secret"}, request=request)
        body = {
            "missing": {},
            "empty": {"text": "   "},
            "type": {"text": ["not text"]},
            "long": {"text": "a" * 8001},
        }[failure]
        return httpx.Response(200, json=body, request=request)

    monkeypatch.setattr(httpx.AsyncClient, "post", provider)
    response = transcribe(audio_client)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "TRANSCRIPTION_FAILED"
    assert "audio-test-secret" not in response.text
    assert "provider private details" not in response.text
    assert "text" not in response.json()


def test_large_content_length_is_rejected_before_multipart_parse(audio_client, monkeypatch):
    async def no_network(*_args, **_kwargs):
        raise AssertionError("Oversize request must not use provider")

    monkeypatch.setattr(httpx.AsyncClient, "post", no_network)
    response = audio_client.post(
        "/api/v1/ai/transcribe",
        headers={
            "X-Actor-ID": "business-1",
            "Content-Length": str(MAX_AUDIO_BYTES * 2),
        },
        content=b"not even multipart",
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "AUDIO_TOO_LARGE"
