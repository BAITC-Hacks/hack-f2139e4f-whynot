from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.account_models import Account
from app.auth import SESSION_COOKIE, session_actor
from app.errors import DomainError
from app.models import Actor


def get_session(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session


DB = Annotated[Session, Depends(get_session)]


def current_actor(
    request: Request, db: DB, x_actor_id: Annotated[str | None, Header()] = None
) -> Actor:
    token = request.cookies.get(SESSION_COOKIE)
    actor = session_actor(db, token)
    if actor is not None:
        return actor
    # An invalid cookie must never silently downgrade to demo impersonation.
    if token or not request.app.state.settings.demo_mode:
        raise DomainError(401, "LOGIN_REQUIRED", "Войдите в аккаунт.")
    actor = db.get(Actor, x_actor_id) if x_actor_id else None
    if actor is not None and db.get(Account, actor.id) is not None:
        raise DomainError(401, "LOGIN_REQUIRED", "Войдите в аккаунт.")
    if actor is None:
        raise DomainError(401, "LOGIN_REQUIRED", "Войдите в аккаунт.")
    return actor


def business_actor(actor: Annotated[Actor, Depends(current_actor)]) -> Actor:
    if actor.role != "business":
        raise DomainError(403, "BUSINESS_REQUIRED", "Действие доступно представителю бизнеса.")
    return actor


def student_actor(actor: Annotated[Actor, Depends(current_actor)]) -> Actor:
    if actor.role != "student":
        raise DomainError(403, "STUDENT_REQUIRED", "Действие доступно студенческой команде.")
    return actor


Business = Annotated[Actor, Depends(business_actor)]
Student = Annotated[Actor, Depends(student_actor)]
