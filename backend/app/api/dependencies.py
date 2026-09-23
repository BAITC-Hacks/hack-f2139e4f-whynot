from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.errors import DomainError
from app.models import Actor


def get_session(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        yield session


DB = Annotated[Session, Depends(get_session)]


def current_actor(
    request: Request, db: DB, x_actor_id: Annotated[str | None, Header()] = None
) -> Actor:
    if not request.app.state.settings.demo_mode:
        raise DomainError(
            503, "AUTH_NOT_CONFIGURED", "Подключите авторизацию для рабочего сервера."
        )
    actor = db.get(Actor, x_actor_id) if x_actor_id else None
    if actor is None:
        raise DomainError(401, "ACTOR_REQUIRED", "Укажите X-Actor-ID из /api/v1/demo/actors.")
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
