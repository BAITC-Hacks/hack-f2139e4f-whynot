from fastapi import APIRouter, Request
from sqlalchemy import select

from app.account_models import Account
from app.api.dependencies import DB, Student
from app.errors import DomainError
from app.models import Actor, Team
from app.proposals import current_team, team_view
from app.schemas import ActorView, TeamInput, TeamView

router = APIRouter(tags=["Teams"])


@router.get("/demo/actors", response_model=list[ActorView], tags=["Demo"])
def actors(db: DB, request: Request):
    if not request.app.state.settings.demo_mode:
        raise DomainError(404, "NOT_FOUND", "Демо-режим выключен.")
    return db.scalars(
        select(Actor).where(~Actor.id.in_(select(Account.actor_id))).order_by(Actor.id)
    ).all()


@router.get("/teams", response_model=list[TeamView])
def teams(db: DB):
    return [team_view(db, team) for team in db.scalars(select(Team).order_by(Team.name))]


@router.get("/teams/me", response_model=TeamView)
def my_team(db: DB, actor: Student):
    return team_view(db, current_team(db, actor))


@router.put("/teams/me", response_model=TeamView)
def save_team(payload: TeamInput, db: DB, actor: Student):
    team = db.scalar(select(Team).where(Team.owner_id == actor.id))
    if team is None:
        team = Team(owner_id=actor.id, **payload.model_dump())
        db.add(team)
    else:
        for field, value in payload.model_dump().items():
            setattr(team, field, value)
    db.commit()
    return team_view(db, team)
