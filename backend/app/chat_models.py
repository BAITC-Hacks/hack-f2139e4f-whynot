from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models import now


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_proposal_id_id", "proposal_id", "id"),
        CheckConstraint("sender_role IN ('business', 'student')"),
        CheckConstraint("length(body) >= 1 AND length(body) <= 4000"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    proposal_id: Mapped[str] = mapped_column(ForeignKey("proposals.id"))
    sender_id: Mapped[str] = mapped_column(ForeignKey("actors.id"))
    sender_name: Mapped[str] = mapped_column(String(200))
    sender_role: Mapped[str] = mapped_column(String(20))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
