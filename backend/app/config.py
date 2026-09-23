from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data/ai_sana.db"
    demo_mode: bool = True
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]
    ai_provider: Literal["stub", "ollama"] = "stub"
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = ""
    ai_timeout_seconds: float = Field(default=30, gt=0, le=120)
