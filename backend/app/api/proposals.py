from fastapi import APIRouter
from sqlalchemy import select

from app import proposals
from app.api.dependencies import DB, Business, Student
from app.models import Milestone, Proposal
from app.schemas import (
    DecisionInput,
    MilestoneInput,
    MilestoneView,
    ProposalCreate,
    ProposalView,
)
from app.tasks import owned_task

router = APIRouter(tags=["Proposals"])


@router.post("/tasks/{task_id}/proposals", response_model=ProposalView, status_code=201)
def submit_proposal(task_id: str, payload: ProposalCreate, db: DB, actor: Student):
    return proposals.create_proposal(db, actor, task_id, payload)


@router.get("/tasks/{task_id}/proposals", response_model=list[ProposalView])
def task_proposals(task_id: str, db: DB, actor: Business):
    owned_task(db, task_id, actor)
    return db.scalars(
        select(Proposal)
        .where(Proposal.task_id == task_id)
        .order_by(Proposal.created_at.desc(), Proposal.id)
    ).all()


@router.get("/proposals/mine", response_model=list[ProposalView])
def my_proposals(db: DB, actor: Student):
    team = proposals.current_team(db, actor)
    return db.scalars(
        select(Proposal)
        .where(Proposal.team_id == team.id)
        .order_by(Proposal.created_at.desc(), Proposal.id)
    ).all()


@router.post("/proposals/{proposal_id}/decision", response_model=ProposalView)
def decide(proposal_id: str, payload: DecisionInput, db: DB, actor: Business):
    return proposals.decide(db, proposals.business_proposal(db, actor, proposal_id), payload)


@router.post("/proposals/{proposal_id}/milestones", response_model=MilestoneView)
def confirm_milestone(proposal_id: str, payload: MilestoneInput, db: DB, actor: Business):
    return proposals.confirm_milestone(
        db,
        actor,
        proposals.business_proposal(db, actor, proposal_id),
        payload,
    )


@router.get("/proposals/{proposal_id}/milestones", response_model=list[MilestoneView])
def milestones(proposal_id: str, db: DB, actor: Business):
    proposals.business_proposal(db, actor, proposal_id)
    return db.scalars(
        select(Milestone)
        .where(Milestone.proposal_id == proposal_id)
        .order_by(Milestone.confirmed_at)
    ).all()
