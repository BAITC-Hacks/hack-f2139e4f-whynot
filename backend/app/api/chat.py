from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import StringConstraints, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import DB, current_actor
from app.chat_models import ChatMessage
from app.errors import DomainError
from app.models import Actor, Proposal, Task, Team
from app.schemas import Schema
from app.student_profiles import StudentProfile
from app.team_models import TeamMembership


def private_response(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


router = APIRouter(tags=["Proposal chat"], dependencies=[Depends(private_response)])
Participant = Annotated[Actor, Depends(current_actor)]


class MessageInput(Schema):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class MessageView(Schema):
    id: int
    proposal_id: str
    sender_id: str
    sender_name: str
    sender_role: Literal["business", "student"]
    body: str
    created_at: datetime

    @field_validator("created_at")
    @classmethod
    def ensure_utc(cls, value: datetime) -> datetime:
        # SQLite loads UTC timestamps without tzinfo; keep the wire format unambiguous.
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value


class MessagesPage(Schema):
    items: list[MessageView]
    has_more: bool


class LeaderContact(Schema):
    name: str
    username: str | None
    phone: str


def participant_proposal(db: Session, actor: Actor, proposal_id: str) -> Proposal:
    proposal = db.get(Proposal, proposal_id)
    if proposal is not None:
        if actor.role == "business":
            task = db.get(Task, proposal.task_id)
            if task is not None and task.owner_id == actor.id:
                return proposal
        elif actor.role == "student":
            membership = db.get(TeamMembership, actor.id)
            if membership is not None and membership.team_id == proposal.team_id:
                return proposal
    raise DomainError(404, "PROPOSAL_NOT_FOUND", "Отклик не найден или недоступен.")


@router.get("/proposals/{proposal_id}/messages", response_model=MessagesPage)
def messages(
    proposal_id: str,
    db: DB,
    actor: Participant,
    after_id: Annotated[int, Query(ge=0, le=2**63 - 1)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
):
    participant_proposal(db, actor, proposal_id)
    rows = db.scalars(
        select(ChatMessage)
        .where(ChatMessage.proposal_id == proposal_id, ChatMessage.id > after_id)
        .order_by(ChatMessage.id)
        .limit(limit + 1)
    ).all()
    return MessagesPage(
        items=[MessageView.model_validate(message) for message in rows[:limit]],
        has_more=len(rows) > limit,
    )


@router.post("/proposals/{proposal_id}/messages", response_model=MessageView, status_code=201)
def send_message(
    proposal_id: str, payload: MessageInput, db: DB, actor: Participant, request: Request
):
    proposal = participant_proposal(db, actor, proposal_id)
    if proposal.status == "rejected":
        raise DomainError(409, "CHAT_READ_ONLY", "Отклик отклонён. Чат доступен для чтения.")
    request.app.state.auth_rate_limiter.check(f"chat:{actor.id}", 30, window=60)
    message = ChatMessage(
        proposal_id=proposal.id,
        sender_id=actor.id,
        sender_name=actor.name,
        sender_role=actor.role,
        body=payload.body,
    )
    db.add(message)
    db.commit()
    return MessageView.model_validate(message)


@router.get("/proposals/{proposal_id}/contact", response_model=LeaderContact)
def leader_contact(proposal_id: str, db: DB, actor: Participant):
    proposal = participant_proposal(db, actor, proposal_id)
    team = db.get(Team, proposal.team_id)
    leader = db.get(Actor, team.owner_id)
    profile = db.get(StudentProfile, leader.id)
    return LeaderContact(
        name=leader.name,
        username=profile.username if profile else None,
        phone=profile.phone if profile else "",
    )
