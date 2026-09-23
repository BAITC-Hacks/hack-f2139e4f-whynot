"""Local password policy and advisory strength estimates; never persist candidate secrets."""

import string
import unicodedata
from threading import BoundedSemaphore
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr
from zxcvbn import zxcvbn
from zxcvbn.frequency_lists import FREQUENCY_LISTS

from app.errors import DomainError

MIN_PASSWORD_LENGTH = 15
MAX_PASSWORD_LENGTH = 128
MAX_PASSWORD_INPUT_LENGTH = 1024
_estimate_slots = BoundedSemaphore(2)

# The bundled MIT-licensed zxcvbn password corpus contains 30,000 whole values.
# Common sequences, published example passphrases and service-specific guesses
# supplement that list. No word or substring within a longer password is banned.
_COMMON_VALUES = {
    "correct horse battery staple",
    "correcthorsebatterystaple",
    "passwordpassword",
    "passwordpasswordpassword",
    "password123456789",
    "123456789012345",
    "1234567890123456",
    "12345678901234567890",
    "123456789123456789",
    "qwertyuiopasdfgh",
    "qwertyuiopasdfghjkl",
    "qwertyuiopasdfghjklzxcvbnm",
    "abcdefghijklmnopqrstuvwxyz",
    "abcdefghijklmnop",
    "this is my password",
    "thisismypassword",
    "letmeinletmeinletmein",
    "i love you forever",
    "iloveyouiloveyou",
    "please let me in",
    "парольпарольпароль",
    "мой очень сложный пароль",
    "это мой пароль",
}
_SERVICE_ROOTS = (
    "ai sana",
    "aisana",
    "ai_sana",
    "ai-sana",
    "whynot",
    "why not",
    "taskrank",
    "task rank",
    "task_rank",
    "task-rank",
)
_SERVICE_SUFFIXES = (
    "",
    "123",
    "123456",
    "1234567890",
    "2026",
    "2026!",
    "password",
    "password123",
    " password",
    " password123",
    " password 2026",
    " пароль",
    " пароль 2026",
)
_REPEATED_CHARACTERS = (
    string.ascii_lowercase + string.digits + " " + "абвгдеёжзийклмнопрстуфхцчшщъыьэюя"
)
COMMON_PASSWORDS = frozenset(
    {unicodedata.normalize("NFC", value).casefold() for value in FREQUENCY_LISTS["passwords"]}
    | _COMMON_VALUES
    | {root + suffix for root in _SERVICE_ROOTS for suffix in _SERVICE_SUFFIXES}
    | {character * length for character in _REPEATED_CHARACTERS for length in range(1, 129)}
)


class PasswordStrengthInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: SecretStr = Field(max_length=MAX_PASSWORD_INPUT_LENGTH)


class PasswordCheck(BaseModel):
    code: Literal["min_length", "max_length", "not_common"]
    passed: bool
    message: str


class PasswordStrengthView(BaseModel):
    score: int = Field(ge=0, le=4)
    level: Literal["weak", "fair", "strong"]
    label: str
    acceptable: bool
    length: int
    min_length: int = MIN_PASSWORD_LENGTH
    max_length: int = MAX_PASSWORD_LENGTH
    checks: list[PasswordCheck]
    suggestions: list[str]


def normalize_password(password: str) -> str:
    normalized = unicodedata.normalize("NFC", password)
    # Lone surrogates are invalid Unicode scalars and cannot be encoded for hashing.
    try:
        normalized.encode("utf-8")
    except UnicodeEncodeError:
        raise DomainError(
            422, "WEAK_PASSWORD", "Введите пароль из допустимых символов Unicode."
        ) from None
    return normalized


def password_checks(normalized: str) -> list[PasswordCheck]:
    return [
        PasswordCheck(
            code="min_length",
            passed=len(normalized) >= MIN_PASSWORD_LENGTH,
            message="Не менее 15 символов.",
        ),
        PasswordCheck(
            code="max_length",
            passed=len(normalized) <= MAX_PASSWORD_LENGTH,
            message="Не более 128 символов.",
        ),
        PasswordCheck(
            code="not_common",
            passed=normalized.casefold() not in COMMON_PASSWORDS,
            message="Пароль отсутствует в локальном списке распространённых вариантов.",
        ),
    ]


def require_password_policy(password: str) -> str:
    normalized = normalize_password(password)
    checks = password_checks(normalized)
    if not all(check.passed for check in checks):
        if not checks[0].passed or not checks[1].passed:
            message = (
                "Используйте пароль от 15 до 128 символов. Можно использовать фразу с пробелами."
            )
        else:
            message = (
                "Этот пароль слишком распространён. Выберите другую фразу или пароль из менеджера."
            )
        raise DomainError(422, "WEAK_PASSWORD", message)
    return normalized


def password_strength(password: str) -> PasswordStrengthView:
    normalized = normalize_password(password)
    checks = password_checks(normalized)
    acceptable = all(check.passed for check in checks)
    score = 0
    suggestions: list[str] = []
    if not checks[0].passed:
        suggestions.append("Добавьте слова: нужно не менее 15 символов.")
    if not checks[1].passed:
        suggestions.append("Сократите пароль до 128 символов; введённый пароль не обрезается.")
    if not checks[2].passed:
        suggestions.append(
            "Выберите другую фразу: этот пароль есть в локальном списке распространённых."
        )
    if acceptable:
        if not _estimate_slots.acquire(blocking=False):
            raise DomainError(
                503, "PASSWORD_STRENGTH_UNAVAILABLE", "Оценка временно занята. Повторите позже."
            )
        try:
            # Limit128 is intentional: the endpoint bounds length, concurrency and request rate.
            result = zxcvbn(normalized, max_length=MAX_PASSWORD_LENGTH)
            score = int(result["score"])
            if not 0 <= score <= 4:
                raise ValueError("Invalid estimator score")
            patterns = {item.get("pattern") for item in result.get("sequence", [])}
        except Exception:
            # The library result/exception may include the password. Never expose either.
            raise DomainError(
                503, "PASSWORD_STRENGTH_UNAVAILABLE", "Не удалось оценить пароль. Повторите позже."
            ) from None
        finally:
            _estimate_slots.release()
        if score < 3:
            suggestions.append(
                "Добавьте несколько не связанных между собой слов или используйте менеджер паролей."
            )
            if patterns & {"repeat", "sequence", "spatial"}:
                suggestions.append(
                    "Повторы, последовательности и соседние клавиши легко предсказать."
                )
        else:
            suggestions.append(
                "Используйте этот пароль только здесь и сохраните его в менеджере паролей."
            )
    level = "weak" if score <= 1 else "fair" if score == 2 else "strong"
    label = {"weak": "Слабый", "fair": "Нормальный", "strong": "Хороший"}[level]
    return PasswordStrengthView(
        score=score,
        level=level,
        label=label,
        acceptable=acceptable,
        length=len(normalized),
        checks=checks,
        suggestions=suggestions,
    )
