from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.dependencies import DB, Business, Student
from app.business_profiles import BusinessProfile, BusinessProfileView, business_profile
from app.models import Milestone, Proposal, Task
from app.schemas import MilestoneView, ProposalView, Schema, TaskView
from app.tasks import task_view
from app.team_models import ProposalParticipant

router = APIRouter(tags=["Profiles and history"])
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0)]


class ProposalWithResults(ProposalView):
    milestones: list[MilestoneView]


class BusinessHistoryItem(Schema):
    task: TaskView
    proposals: list[ProposalWithResults]


class BusinessHistoryPage(Schema):
    items: list[BusinessHistoryItem]
    total: int
    limit: int
    offset: int


class HistoryTask(Schema):
    id: str
    title: str
    topic: str


class StudentHistoryItem(Schema):
    task: HistoryTask
    proposal: ProposalView
    milestones: list[MilestoneView]


class StudentHistoryPage(Schema):
    items: list[StudentHistoryItem]
    total: int
    limit: int
    offset: int


@router.get("/business/profile", response_model=BusinessProfileView)
def get_profile(db: DB, actor: Business):
    return business_profile(db, actor)


@router.put("/business/profile", response_model=BusinessProfileView)
def save_profile(payload: BusinessProfileView, db: DB, actor: Business):
    profile = db.get(BusinessProfile, actor.id)
    if profile is None:
        profile = BusinessProfile(owner_id=actor.id)
        db.add(profile)
    for field, value in payload.model_dump().items():
        setattr(profile, field, value)
    db.commit()
    return profile


def results_for(db, proposal_ids: list[str]) -> dict[str, list[MilestoneView]]:
    grouped: dict[str, list[MilestoneView]] = {}
    if proposal_ids:
        for item in db.scalars(
            select(Milestone)
            .where(Milestone.proposal_id.in_(proposal_ids))
            .order_by(Milestone.confirmed_at, Milestone.id)
        ):
            grouped.setdefault(item.proposal_id, []).append(MilestoneView.model_validate(item))
    return grouped


@router.get("/business/history", response_model=BusinessHistoryPage)
def business_history(db: DB, actor: Business, limit: Limit = 20, offset: Offset = 0):
    scope = Task.owner_id == actor.id
    total = db.scalar(select(func.count()).select_from(Task).where(scope)) or 0
    tasks = db.scalars(
        select(Task)
        .where(scope)
        .order_by(Task.created_at.desc(), Task.id)
        .limit(limit)
        .offset(offset)
    ).all()
    proposals = (
        db.scalars(
            select(Proposal)
            .where(Proposal.task_id.in_([task.id for task in tasks]))
            .order_by(Proposal.created_at.desc(), Proposal.id)
        ).all()
        if tasks
        else []
    )
    results = results_for(db, [proposal.id for proposal in proposals])
    grouped: dict[str, list[ProposalWithResults]] = {}
    for proposal in proposals:
        grouped.setdefault(proposal.task_id, []).append(
            ProposalWithResults(
                **ProposalView.model_validate(proposal).model_dump(),
                milestones=results.get(proposal.id, []),
            )
        )
    return BusinessHistoryPage(
        items=[
            BusinessHistoryItem(task=task_view(task), proposals=grouped.get(task.id, []))
            for task in tasks
        ],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/students/history", response_model=StudentHistoryPage)
def student_history(db: DB, actor: Student, limit: Limit = 20, offset: Offset = 0):
    scope = ProposalParticipant.actor_id == actor.id
    total = (
        db.scalar(select(func.count()).select_from(Proposal).join(ProposalParticipant).where(scope))
        or 0
    )
    rows = db.execute(
        select(Proposal, Task)
        .join(ProposalParticipant, ProposalParticipant.proposal_id == Proposal.id)
        .join(Task, Proposal.task_id == Task.id)
        .where(scope)
        .order_by(Proposal.created_at.desc(), Proposal.id)
        .limit(limit)
        .offset(offset)
    ).all()
    results = results_for(db, [proposal.id for proposal, _ in rows])
    return StudentHistoryPage(
        items=[
            StudentHistoryItem(
                task=HistoryTask(
                    id=task.id,
                    title=(task.published_card or {}).get("title", "Задача"),
                    topic=(task.published_card or {}).get("topic", ""),
                ),
                proposal=ProposalView.model_validate(proposal),
                milestones=results.get(proposal.id, []),
            )
            for proposal, task in rows
        ],
        total=total,
        limit=limit,
        offset=offset,
    )
