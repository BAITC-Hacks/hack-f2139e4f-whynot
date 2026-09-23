"""Student identities stay separate from team membership and private credentials."""

import re
from typing import Annotated

from pydantic import BeforeValidator, Field, StringConstraints, field_validator
from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.account_models import Account
from app.db import Base
from app.errors import DomainError
from app.models import Actor
from app.schemas import Schema, Tag


def normalize_username(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Укажите ID студента.")
    value = value.strip().removeprefix("@").lower()
    if not re.fullmatch(r"[a-z][a-z0-9_]{2,31}", value):
        raise ValueError("ID: 3–32 латинские буквы, цифры или _, первый символ — буква.")
    return value


def normalize_phone(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("Укажите номер телефона.")
    value = re.sub(r"[\s()\-]", "", value)
    if not re.fullmatch(r"\+[1-9][0-9]{9,14}", value):
        raise ValueError("Телефон должен содержать +, код страны и 10–15 цифр.")
    return value


Username = Annotated[str, BeforeValidator(normalize_username)]
Phone = Annotated[str, BeforeValidator(normalize_phone)]
Position = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


def distinct_labels(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if value.casefold() not in seen:
            seen.add(value.casefold())
            result.append(value)
    return result


class StudentProfile(Base):
    __tablename__ = "student_profiles"

    actor_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    phone: Mapped[str] = mapped_column(String(16))
    positions: Mapped[list] = mapped_column(JSON, default=list)
    skills: Mapped[list] = mapped_column(JSON, default=list)


class StudentProfileInput(Schema):
    username: Username
    phone: Phone
    positions: list[Position] = Field(min_length=1, max_length=10)
    skills: list[Tag] = Field(min_length=1, max_length=30)

    @field_validator("positions", "skills")
    @classmethod
    def unique_labels(cls, value: list[str]) -> list[str]:
        return distinct_labels(value)


class StudentProfileView(Schema):
    actor_id: str
    username: str | None = None
    phone: str = ""
    positions: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)


def student_profile(db: Session, actor: Actor) -> StudentProfileView:
    profile = db.get(StudentProfile, actor.id)
    if profile is None:
        return StudentProfileView(actor_id=actor.id)
    return StudentProfileView.model_validate(profile)


def require_student_profile(db: Session, actor: Actor) -> None:
    # Synthetic demo actors do not have login accounts or real phone numbers.
    if db.get(Account, actor.id) is None:
        return
    profile = db.get(StudentProfile, actor.id)
    if profile is None or not all(
        (profile.username, profile.phone, profile.positions, profile.skills)
    ):
        raise DomainError(
            409,
            "STUDENT_PROFILE_REQUIRED",
            "Заполните ID, телефон, специальности и навыки в профиле студента.",
        )
