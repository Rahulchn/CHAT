from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class GroupMessage(Base):
    # Separate from legacy private messages: old conversations are never published.
    __tablename__ = "group_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[str] = mapped_column(String(36))
    name: Mapped[str] = mapped_column(String(40))
    avatar: Mapped[str] = mapped_column(String(20), default="orbit", server_default="orbit")
    body: Mapped[str] = mapped_column(Text)
    image_url: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc),
    )
