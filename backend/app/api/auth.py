import logging

from fastapi import APIRouter, BackgroundTasks, Request, Response
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.account_models import Account
from app.api.dependencies import DB
from app.auth import (
    SESSION_COOKIE,
    deliver_reset_mail,
    hash_password,
    issue_password_reset,
    limit_auth,
    new_session,
    reset_password,
    revoke_session,
    session_actor,
    verify_password,
)
from app.auth_schemas import (
    AuthView,
    EmailInput,
    LoginInput,
    MessageView,
    RegisterInput,
    ResetPasswordInput,
)
from app.config import Settings
from app.errors import DomainError
from app.models import Actor, new_id
from app.passwords import (
    PasswordStrengthInput,
    PasswordStrengthView,
    password_strength,
    require_password_policy,
)
from app.student_profiles import StudentProfile

router = APIRouter(prefix="/auth", tags=["Authentication"])
logger = logging.getLogger(__name__)


def _view(db, actor: Actor, account: Account) -> dict:
    profile = db.get(StudentProfile, actor.id) if actor.role == "student" else None
    return {
        "actor": {
            "id": actor.id,
            "name": actor.name,
            "role": actor.role,
            "email": account.email,
            "username": profile.username if profile else None,
        }
    }


def _set_session(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_hours * 3600,
        path="/api",
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"


@router.post("/register", response_model=AuthView, status_code=201)
def register(payload: RegisterInput, request: Request, response: Response, db: DB):
    limit_auth(request, "register", payload.email)
    password_hash = hash_password(require_password_policy(payload.password.get_secret_value()))
    if db.scalar(select(Account).where(Account.email == payload.email)):
        raise DomainError(
            409, "ACCOUNT_EXISTS", "Этот адрес уже зарегистрирован. Войдите в аккаунт."
        )
    if payload.username and db.scalar(
        select(StudentProfile.actor_id).where(StudentProfile.username == payload.username)
    ):
        raise DomainError(409, "USERNAME_TAKEN", "Этот ID уже занят. Придумайте другой.")
    actor = Actor(id=new_id(), name=payload.name, role=payload.role)
    try:
        db.add(actor)
        db.flush()
        account = Account(actor_id=actor.id, email=payload.email, password_hash=password_hash)
        db.add(account)
        if actor.role == "student":
            db.add(
                StudentProfile(
                    actor_id=actor.id,
                    username=payload.username,
                    phone=payload.phone,
                    positions=payload.positions,
                    skills=payload.skills,
                )
            )
        db.flush()
        revoke_session(db, request.cookies.get(SESSION_COOKIE))
        token = new_session(db, actor.id, request.app.state.settings)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if payload.username and db.scalar(
            select(StudentProfile.actor_id).where(StudentProfile.username == payload.username)
        ):
            raise DomainError(
                409, "USERNAME_TAKEN", "Этот ID уже занят. Придумайте другой."
            ) from exc
        raise DomainError(409, "ACCOUNT_EXISTS", "Этот адрес уже зарегистрирован.") from exc
    _set_session(response, token, request.app.state.settings)
    return _view(db, actor, account)


@router.post("/password-strength", response_model=PasswordStrengthView)
def strength(payload: PasswordStrengthInput, request: Request):
    peer = request.client.host if request.client else "unknown"
    request.app.state.auth_rate_limiter.check(f"ip:password-strength:{peer}", 60, window=60)
    return password_strength(payload.password.get_secret_value())


@router.post("/login", response_model=AuthView)
def login(payload: LoginInput, request: Request, response: Response, db: DB):
    limit_auth(request, "login", payload.email)
    account = db.scalar(select(Account).where(Account.email == payload.email))
    if not verify_password(
        payload.password.get_secret_value(),
        account.password_hash if account else None,
    ):
        raise DomainError(401, "INVALID_CREDENTIALS", "Неверный email или пароль.")
    # Serialize login with reset: a password changed while scrypt ran cannot create
    # a new session after the reset already revoked the old sessions.
    verified_hash = account.password_hash
    updated = db.execute(
        update(Account)
        .where(Account.actor_id == account.actor_id, Account.password_hash == verified_hash)
        .values(password_hash=verified_hash)
        .execution_options(synchronize_session=False)
    )
    if updated.rowcount != 1:
        db.rollback()
        raise DomainError(401, "INVALID_CREDENTIALS", "Неверный email или пароль.")
    actor = db.get(Actor, account.actor_id)
    revoke_session(db, request.cookies.get(SESSION_COOKIE))
    token = new_session(db, actor.id, request.app.state.settings)
    db.commit()
    _set_session(response, token, request.app.state.settings)
    return _view(db, actor, account)


@router.get("/me", response_model=AuthView)
def me(request: Request, response: Response, db: DB):
    actor = session_actor(db, request.cookies.get(SESSION_COOKIE))
    if actor is None:
        raise DomainError(401, "LOGIN_REQUIRED", "Войдите в аккаунт.")
    response.headers["Cache-Control"] = "no-store"
    return _view(db, actor, db.get(Account, actor.id))


@router.post("/logout", response_model=MessageView)
def logout(request: Request, response: Response, db: DB):
    revoke_session(db, request.cookies.get(SESSION_COOKIE))
    db.commit()
    response.delete_cookie(
        SESSION_COOKIE,
        path="/api",
        httponly=True,
        secure=request.app.state.settings.cookie_secure,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"
    return {"message": "Вы вышли из аккаунта."}


def _send_reset(settings: Settings, email: str, token: str) -> None:
    try:
        deliver_reset_mail(settings, email, token)
    except (OSError, ValueError) as exc:
        # Do not log SMTP responses, email addresses or the recovery token.
        logger.error("Password recovery mail delivery failed (%s).", type(exc).__name__)


@router.post("/forgot-password", response_model=MessageView)
def forgot_password(payload: EmailInput, request: Request, db: DB, background: BackgroundTasks):
    limit_auth(request, "forgot-password", payload.email)
    account = db.scalar(select(Account).where(Account.email == payload.email))
    if account:
        token = issue_password_reset(db, account)
        db.commit()
        background.add_task(_send_reset, request.app.state.settings, account.email, token)
    return {
        "message": "Если адрес зарегистрирован, запрос на восстановление принят.",
        "delivery": request.app.state.settings.mail_mode,
    }


@router.post("/reset-password", response_model=MessageView)
def recover_password(payload: ResetPasswordInput, request: Request, response: Response, db: DB):
    limit_auth(request, "reset-password")
    reset_password(db, payload.token.get_secret_value(), payload.password.get_secret_value())
    response.delete_cookie(
        SESSION_COOKIE,
        path="/api",
        httponly=True,
        secure=request.app.state.settings.cookie_secure,
        samesite="lax",
    )
    return {"message": "Пароль изменён. Войдите с новым паролем."}
