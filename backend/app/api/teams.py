from fastapi import APIRouter, Request
from sqlalchemy import select

from app import teams as service
from app.account_models import Account
from app.api.dependencies import DB, Student
from app.errors import DomainError
from app.models import Actor, Team
from app.schemas import (
    ActorView,
    TeamInput,
    TeamInviteView,
    TeamJoinInput,
    TeamPublicView,
    TeamView,
)

router = APIRouter(tags=["Teams"])


@router.get("/demo/actors", response_model=list[ActorView], tags=["Demo"])
def actors(db: DB, request: Request):
    if not request.app.state.settings.demo_mode:
        raise DomainError(404, "NOT_FOUND", "Демо-режим выключен.")
    return db.scalars(
        select(Actor).where(~Actor.id.in_(select(Account.actor_id))).order_by(Actor.id)
    ).all()


@router.get("/teams", response_model=list[TeamPublicView])
def teams(db: DB):
    return [
        service.public_team_view(db, team) for team in db.scalars(select(Team).order_by(Team.name))
    ]


@router.post("/teams", response_model=TeamView, status_code=201, response_model_exclude_none=True)
def create_team(payload: TeamInput, db: DB, actor: Student):
    team, code = service.create_team(db, actor, payload)
    return service.team_view(db, team, actor, invite_code=code)


@router.post("/teams/join", response_model=TeamView, response_model_exclude_none=True)
def join_team(payload: TeamJoinInput, db: DB, actor: Student, request: Request):
    request.app.state.auth_rate_limiter.check(f"team-invite:{actor.id}", 20)
    team = service.join_team(db, actor, payload.name, payload.invite_code)
    return service.team_view(db, team, actor)


@router.get("/teams/me", response_model=TeamView, response_model_exclude_none=True)
def my_team(db: DB, actor: Student):
    return service.team_view(db, service.current_team(db, actor), actor)


@router.put("/teams/me", response_model=TeamView, response_model_exclude_none=True)
def save_team(payload: TeamInput, db: DB, actor: Student):
    return service.team_view(db, service.update_team(db, actor, payload), actor)


@router.post("/teams/me/invite", response_model=TeamInviteView)
def rotate_invite(db: DB, actor: Student):
    return TeamInviteView(invite_code=service.rotate_invite(db, actor))


@router.post("/teams/me/leave")
def leave_team(db: DB, actor: Student):
    service.leave_team(db, actor)
    return {"message": "Вы вышли из команды."}
