from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import JSON, CheckConstraint, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def new_id() -> str:
    return str(uuid4())


def now() -> datetime:
    return datetime.now(UTC)


class Actor(Base):
    __tablename__ = "actors"
    __table_args__ = (CheckConstraint("role IN ('business', 'student')"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20))


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    interests: Mapped[list] = mapped_column(JSON, default=list)
    skills: Mapped[list] = mapped_column(JSON, default=list)
    technologies: Mapped[list] = mapped_column(JSON, default=list)


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (CheckConstraint("published_score >= 0 AND published_score <= 100"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), index=True)
    raw_description: Mapped[str] = mapped_column(Text)
    card: Mapped[dict] = mapped_column(JSON)
    confirmed_fields: Mapped[list] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(default=1)
    confirmed_revision: Mapped[int | None]
    published_revision: Mapped[int | None]
    published_card: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    published_score: Mapped[int] = mapped_column(default=0, index=True)
    published_topic: Mapped[str | None] = mapped_column(String(100), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lock_version: Mapped[int] = mapped_column(default=1)

    __mapper_args__ = {"version_id_col": lock_version}


class Proposal(Base):
    __tablename__ = "proposals"
    __table_args__ = (CheckConstraint("status IN ('pending', 'accepted', 'rejected')"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"), index=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    idea: Mapped[str] = mapped_column(Text)
    plan: Mapped[str] = mapped_column(Text)
    timeline: Mapped[str] = mapped_column(String(500))
    prototype_url: Mapped[str | None] = mapped_column(String(2000))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    decision_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    lock_version: Mapped[int] = mapped_column(default=1)

    __mapper_args__ = {"version_id_col": lock_version}


class Milestone(Base):
    __tablename__ = "milestones"
    __table_args__ = (
        UniqueConstraint("proposal_id", "code"),
        CheckConstraint("code IN ('prototype', 'pilot', 'delivery')"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=new_id)
    proposal_id: Mapped[str] = mapped_column(ForeignKey("proposals.id"), index=True)
    code: Mapped[str] = mapped_column(String(30))
    evidence: Mapped[str] = mapped_column(Text)
    points: Mapped[int]
    confirmed_by: Mapped[str] = mapped_column(ForeignKey("actors.id"))
    confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
