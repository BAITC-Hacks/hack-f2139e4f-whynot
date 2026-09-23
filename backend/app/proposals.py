from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import DomainError
from app.models import Actor, Milestone, Proposal, Task, Team, now
from app.schemas import DecisionInput, MilestoneInput, ProposalCreate, TeamView

MILESTONE_POINTS = {"prototype": 20, "pilot": 30, "delivery": 50}


def current_team(db: Session, actor: Actor) -> Team:
    team = db.scalar(select(Team).where(Team.owner_id == actor.id))
    if team is None:
        raise DomainError(409, "TEAM_REQUIRED", "Сначала создайте профиль команды.")
    return team


def team_view(db: Session, team: Team) -> TeamView:
    points = db.scalar(
        select(func.coalesce(func.sum(Milestone.points), 0))
        .join(
            Proposal,
            Milestone.proposal_id == Proposal.id,
        )
        .where(Proposal.team_id == team.id)
    )
    return TeamView(
        id=team.id,
        owner_id=team.owner_id,
        name=team.name,
        interests=team.interests,
        skills=team.skills,
        technologies=team.technologies,
        points=points,
    )


def create_proposal(db: Session, actor: Actor, task_id: str, payload: ProposalCreate) -> Proposal:
    task = db.get(Task, task_id)
    if task is None or task.published_revision is None:
        raise DomainError(404, "TASK_NOT_FOUND", "Опубликованная задача не найдена.")
    team = current_team(db, actor)
    proposal = Proposal(task_id=task.id, team_id=team.id, **payload.model_dump(mode="json"))
    db.add(proposal)
    db.commit()
    return proposal


def business_proposal(db: Session, actor: Actor, proposal_id: str) -> Proposal:
    proposal = db.scalar(
        select(Proposal)
        .join(Task)
        .where(
            Proposal.id == proposal_id,
            Task.owner_id == actor.id,
        )
    )
    if proposal is None:
        raise DomainError(404, "PROPOSAL_NOT_FOUND", "Отклик не найден.")
    return proposal


def decide(db: Session, proposal: Proposal, payload: DecisionInput) -> Proposal:
    if proposal.status == payload.decision:
        return proposal
    if proposal.status != "pending":
        raise DomainError(409, "DECISION_FINAL", "Решение по этому отклику уже принято.")
    proposal.status = payload.decision
    proposal.decision_note = payload.note
    proposal.decided_at = now()
    db.commit()
    return proposal


def confirm_milestone(
    db: Session, actor: Actor, proposal: Proposal, payload: MilestoneInput
) -> Milestone:
    if proposal.status != "accepted":
        raise DomainError(409, "TEAM_NOT_SELECTED", "Этапы доступны только выбранной команде.")
    existing = db.scalar(
        select(Milestone).where(
            Milestone.proposal_id == proposal.id,
            Milestone.code == payload.code,
        )
    )
    if existing is not None:
        if existing.evidence != payload.evidence:
            raise DomainError(409, "MILESTONE_EXISTS", "Этап уже подтверждён с другим результатом.")
        return existing
    milestone = Milestone(
        proposal_id=proposal.id,
        code=payload.code,
        evidence=payload.evidence,
        points=MILESTONE_POINTS[payload.code],
        confirmed_by=actor.id,
    )
    db.add(milestone)
    db.commit()
    return milestone
