from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data/ai_sana.db"
    demo_mode: bool = False
    session_hours: int = Field(default=24 * 7, ge=1, le=24 * 30)
    cookie_secure: bool = False
    frontend_url: str = "http://127.0.0.1:5173"
    mail_mode: Literal["file", "smtp"] = "file"
    mail_outbox_dir: str = "data/outbox"
    mail_from: str = "AI Sana <noreply@localhost>"
    smtp_host: str = ""
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str = ""
    smtp_password: SecretStr | None = None
    smtp_starttls: bool = True
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]
    ai_provider: Literal["stub", "ollama", "openai"] = "stub"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = ""
    openai_api_key: SecretStr | None = None
    openai_model: str = "gpt-4o-mini"
    openai_transcription_model: str = "gpt-4o-mini-transcribe"
    ai_timeout_seconds: float = Field(default=30, gt=0, le=120)
