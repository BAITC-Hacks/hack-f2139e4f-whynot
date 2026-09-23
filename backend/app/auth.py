"""Password hashing, opaque sessions, one-use resets and local/SMTP mail delivery."""

import hashlib
import hmac
import secrets
import smtplib
import ssl
from collections import deque
from datetime import timedelta
from email.message import EmailMessage
from pathlib import Path
from threading import Lock, Semaphore
from time import monotonic
from urllib.parse import urlsplit

from fastapi import Request
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.account_models import Account, LoginSession, PasswordReset
from app.config import Settings
from app.errors import DomainError
from app.models import Actor, now
from app.passwords import normalize_password, require_password_policy

SESSION_COOKIE = "ai_sana_session"
# Scrypt consumes ~128 MiB per call. Bound concurrency even under login floods.
_password_slots = Semaphore(2)
_dummy_salt = secrets.token_bytes(16)


def _derive_password(password: str, salt: bytes) -> bytes:
    with _password_slots:
        return hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=2**17,
            r=8,
            p=1,
            dklen=64,
            maxmem=256 * 1024 * 1024,
        )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    normalized = normalize_password(password)
    return f"scrypt-nfc$131072$8$1${salt.hex()}${_derive_password(normalized, salt).hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    # Missing accounts still pay the same hashing cost as a bad password.
    try:
        if stored is None:
            _derive_password(normalize_password(password), _dummy_salt)
            return False
        algorithm, n, r, p, salt, expected = stored.split("$")
        if algorithm not in {"scrypt", "scrypt-nfc"} or (n, r, p) != ("131072", "8", "1"):
            return False
        if algorithm == "scrypt-nfc":
            password = normalize_password(password)
        actual = _derive_password(password, bytes.fromhex(salt))
        return hmac.compare_digest(actual.hex(), expected)
    except (ValueError, TypeError, DomainError):
        return False


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_session(db: Session, actor_id: str, settings: Settings) -> str:
    token = secrets.token_urlsafe(32)
    db.execute(delete(LoginSession).where(LoginSession.expires_at <= now()))
    db.add(
        LoginSession(
            token_hash=token_digest(token),
            actor_id=actor_id,
            expires_at=now() + timedelta(hours=settings.session_hours),
        )
    )
    return token


def session_actor(db: Session, token: str | None) -> Actor | None:
    if not token or len(token) > 200:
        return None
    return db.scalar(
        select(Actor)
        .join(LoginSession, LoginSession.actor_id == Actor.id)
        .where(
            LoginSession.token_hash == token_digest(token),
            LoginSession.expires_at > now(),
        )
    )


def revoke_session(db: Session, token: str | None) -> None:
    if token and len(token) <= 200:
        db.execute(delete(LoginSession).where(LoginSession.token_hash == token_digest(token)))


def check_request_origin(request: Request) -> None:
    """Browser auth and cookie writes need an explicitly trusted Origin."""
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    is_auth = request.url.path.startswith("/api/v1/auth/")
    has_cookie = SESSION_COOKIE in request.cookies
    if not (is_auth or has_cookie):
        return
    origin = request.headers.get("origin")
    settings = request.app.state.settings
    frontend = urlsplit(settings.frontend_url)
    allowed = {*settings.cors_origins, f"{frontend.scheme}://{frontend.netloc}"}
    if not origin or origin not in allowed:
        raise DomainError(403, "UNTRUSTED_ORIGIN", "Запрос отправлен с недопустимого сайта.")


class AuthRateLimiter:
    """Per-process IP and account limits; use a shared store for multiple workers."""

    def __init__(self):
        self._events: dict[tuple[str, int], deque[float]] = {}
        self._lock = Lock()

    def check(self, key: str, limit: int, window: int = 15 * 60) -> None:
        current = monotonic()
        bucket = (key, window)
        with self._lock:
            for expired_key in [
                item
                for item, events in self._events.items()
                if not events or events[-1] <= current - item[1]
            ]:
                self._events.pop(expired_key, None)
            if bucket not in self._events and len(self._events) >= 10000:
                raise DomainError(429, "RATE_LIMITED", "Повторите попытку позже.")
            events = self._events.setdefault(bucket, deque())
            while events and events[0] <= current - window:
                events.popleft()
            if len(events) >= limit:
                raise DomainError(429, "RATE_LIMITED", "Слишком много попыток. Повторите позже.")
            events.append(current)


def limit_auth(request: Request, action: str, email: str | None = None) -> None:
    limiter = request.app.state.auth_rate_limiter
    peer = request.client.host if request.client else "unknown"
    # Never trust a client-supplied X-Forwarded-For header for these limits.
    limiter.check(f"ip:{action}:{peer}", 30)
    if email:
        limiter.check(f"account:{action}:{token_digest(email)}", 8)


def deliver_reset_mail(settings: Settings, email: str, token: str) -> None:
    # URL fragments are never sent to the frontend server or its request logs.
    url = f"{settings.frontend_url.rstrip('/')}/reset-password#token={token}"
    message = EmailMessage()
    message["From"] = settings.mail_from
    message["To"] = email
    message["Subject"] = "AI Sana: восстановление пароля"
    message.set_content(
        "Чтобы задать новый пароль, откройте ссылку в течение 30 минут:\n\n"
        f"{url}\n\nЕсли вы не запрашивали восстановление, проигнорируйте письмо."
    )
    if settings.mail_mode == "file":
        directory = Path(settings.mail_outbox_dir)
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f"{secrets.token_hex(16)}.eml"
        with target.open("xb") as stream:
            stream.write(message.as_bytes())
        return
    if not settings.smtp_host:
        raise ValueError("SMTP host is not configured")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_starttls:
            smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(
                settings.smtp_username,
                settings.smtp_password.get_secret_value() if settings.smtp_password else "",
            )
        smtp.send_message(message)


def issue_password_reset(db: Session, account: Account) -> str:
    token = secrets.token_urlsafe(32)
    db.execute(delete(PasswordReset).where(PasswordReset.actor_id == account.actor_id))
    db.execute(delete(PasswordReset).where(PasswordReset.expires_at <= now()))
    db.add(
        PasswordReset(
            token_hash=token_digest(token),
            actor_id=account.actor_id,
            expires_at=now() + timedelta(minutes=30),
        )
    )
    return token


def reset_password(db: Session, token: str, password: str) -> None:
    password = require_password_policy(password)
    digest = token_digest(token)
    reset = db.scalar(
        select(PasswordReset).where(
            PasswordReset.token_hash == digest,
            PasswordReset.expires_at > now(),
        )
    )
    if reset is None:
        raise DomainError(
            400, "INVALID_RESET", "Ссылка недействительна или срок её действия истёк."
        )
    password_hash = hash_password(password)
    # The conditional DELETE claims this token atomically; a concurrent user cannot reuse it.
    actor_id = db.scalar(
        delete(PasswordReset)
        .where(
            PasswordReset.token_hash == digest,
            PasswordReset.expires_at > now(),
        )
        .returning(PasswordReset.actor_id)
        .execution_options(synchronize_session=False)
    )
    if actor_id is None:
        db.rollback()
        raise DomainError(
            400, "INVALID_RESET", "Ссылка недействительна или срок её действия истёк."
        )
    db.execute(
        update(Account).where(Account.actor_id == actor_id).values(password_hash=password_hash)
    )
    db.execute(delete(LoginSession).where(LoginSession.actor_id == actor_id))
    db.execute(delete(PasswordReset).where(PasswordReset.actor_id == actor_id))
    db.commit()
