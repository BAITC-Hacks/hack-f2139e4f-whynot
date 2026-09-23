from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, Request, UploadFile

from app.api.dependencies import Business
from app.errors import DomainError
from app.schemas import Schema

router = APIRouter(tags=["AI"])
MAX_AUDIO_BYTES = 10 * 1024 * 1024
AUDIO_EXTENSIONS = {".mp3", ".mp4", ".mpeg", ".mpga", ".m4a", ".wav", ".webm"}


class TranscriptionView(Schema):
    text: str
    provider: Literal["openai"] = "openai"


@router.post("/ai/transcribe", response_model=TranscriptionView)
async def transcribe(file: UploadFile, request: Request, actor: Business):
    try:
        request.app.state.auth_rate_limiter.check(f"audio:{actor.id}", 20)
        suffix = Path(file.filename or "").suffix.lower()
        if suffix not in AUDIO_EXTENSIONS:
            raise DomainError(415, "AUDIO_FORMAT", "Выберите аудио MP3, MP4, M4A, WAV или WebM.")
        audio = await file.read(MAX_AUDIO_BYTES + 1)
        if not audio:
            raise DomainError(422, "AUDIO_EMPTY", "Запись пустая. Запишите голос ещё раз.")
        if len(audio) > MAX_AUDIO_BYTES:
            raise DomainError(413, "AUDIO_TOO_LARGE", "Размер аудио не должен превышать 10 МБ.")
        settings = request.app.state.settings
        key = settings.openai_api_key
        if key is None or not key.get_secret_value().strip():
            raise DomainError(
                503,
                "AI_NOT_CONFIGURED",
                "Голосовой ввод пока не настроен. Введите описание текстом.",
            )
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(60, connect=10)) as client:
                response = await client.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers={"Authorization": f"Bearer {key.get_secret_value()}"},
                    data={"model": settings.openai_transcription_model, "response_format": "json"},
                    files={
                        "file": (f"recording{suffix}", audio, file.content_type or "audio/webm")
                    },
                )
                response.raise_for_status()
                text = response.json()["text"].strip()
                if not isinstance(text, str) or not text or len(text) > 8000:
                    raise ValueError("Invalid transcription")
        except (httpx.HTTPError, KeyError, TypeError, ValueError, AttributeError) as exc:
            raise DomainError(
                503,
                "TRANSCRIPTION_FAILED",
                "Не удалось распознать запись. Попробуйте короткую запись или введите текст.",
            ) from exc
        return TranscriptionView(text=text)
    finally:
        await file.close()
