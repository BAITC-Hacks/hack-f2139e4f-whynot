import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator


class EmailInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Укажите корректный адрес электронной почты.")
        return value


class LoginInput(EmailInput):
    password: SecretStr = Field(min_length=1, max_length=128)


class RegisterInput(EmailInput):
    name: str = Field(min_length=2, max_length=200)
    password: SecretStr = Field(min_length=12, max_length=128)
    role: Literal["business", "student"]

    @field_validator("name")
    @classmethod
    def trim_name(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Укажите имя или название организации.")
        return value


class ResetPasswordInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: SecretStr = Field(min_length=20, max_length=200)
    password: SecretStr = Field(min_length=12, max_length=128)


class AccountActorView(BaseModel):
    id: str
    name: str
    role: Literal["business", "student"]
    email: str


class AuthView(BaseModel):
    actor: AccountActorView


class MessageView(BaseModel):
    message: str
    delivery: Literal["file", "smtp"] | None = None
