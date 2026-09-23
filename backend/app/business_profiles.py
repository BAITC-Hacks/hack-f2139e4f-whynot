from typing import Annotated

from pydantic import StringConstraints
from sqlalchemy import ForeignKey, String, Text, or_, select
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.db import Base
from app.models import Actor, Task
from app.schemas import Schema

ProfileText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=4000)]


class BusinessProfile(Base):
    __tablename__ = "business_profiles"

    owner_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), primary_key=True)
    company_name: Mapped[str] = mapped_column(String(200), default="")
    industry: Mapped[str] = mapped_column(String(100), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    goals: Mapped[str] = mapped_column(Text, default="")
    values: Mapped[str] = mapped_column(Text, default="")
    use_history_for_ai: Mapped[bool] = mapped_column(default=True)


class BusinessProfileView(Schema):
    company_name: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    industry: Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] = ""
    description: ProfileText = ""
    goals: ProfileText = ""
    values: ProfileText = ""
    use_history_for_ai: bool = True


def business_profile(db: Session, actor: Actor) -> BusinessProfileView:
    profile = db.get(BusinessProfile, actor.id)
    if profile is None:
        return BusinessProfileView(company_name=actor.name)
    return BusinessProfileView.model_validate(profile)


def business_ai_context(db: Session, actor: Actor, current_task_id: str) -> dict:
    profile = business_profile(db, actor)
    history = []
    if profile.use_history_for_ai:
        tasks = db.scalars(
            select(Task)
            .where(
                Task.owner_id == actor.id,
                Task.id != current_task_id,
                or_(Task.confirmed_revision == Task.revision, Task.published_card.is_not(None)),
            )
            .order_by(Task.created_at.desc(), Task.id)
            .limit(5)
        )
        for task in tasks:
            # Only explicit confirmed facts: unpublished edits and contact details stay out.
            card = task.card if task.confirmed_revision == task.revision else task.published_card
            history.append(
                {
                    "task_id": task.id,
                    "card": {
                        field: (card or {}).get(field, "")[:1000]
                        for field in (
                            "title",
                            "topic",
                            "need",
                            "expected_result",
                            "success_criteria",
                        )
                    },
                }
            )
    return {"profile": profile.model_dump(), "previous_tasks": history}
