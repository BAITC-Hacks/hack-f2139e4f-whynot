"""Additive team membership and immutable proposal participation tables."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models import now


class TeamMembership(Base):
    __tablename__ = "team_memberships"
    __table_args__ = (
        UniqueConstraint("team_id", "slot"),
        CheckConstraint("slot >= 1 AND slot <= 5"),
    )

    actor_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), primary_key=True)
    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), index=True)
    slot: Mapped[int]
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class TeamInvite(Base):
    __tablename__ = "team_invites"

    team_id: Mapped[str] = mapped_column(ForeignKey("teams.id"), primary_key=True)
    code_hash: Mapped[str] = mapped_column(String(64), unique=True)


class ProposalParticipant(Base):
    __tablename__ = "proposal_participants"

    proposal_id: Mapped[str] = mapped_column(ForeignKey("proposals.id"), primary_key=True)
    actor_id: Mapped[str] = mapped_column(ForeignKey("actors.id"), primary_key=True, index=True)
