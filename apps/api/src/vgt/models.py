from datetime import datetime
from enum import Enum as PyEnum
from enum import StrEnum
from typing import Any

from sqlalchemy import JSON, Boolean, Enum, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from vgt.db import Base, utcnow


class Role(StrEnum):
    student = "student"
    teacher = "teacher"
    admin = "admin"


class WordStatus(StrEnum):
    draft = "draft"
    published = "published"


class ClipSource(StrEnum):
    legacy = "legacy"
    recording = "recording"
    demo = "demo"


class Direction(StrEnum):
    w2s = "w2s"  # word -> sign
    s2w = "s2w"  # sign -> word


class ClientKind(StrEnum):
    web = "web"
    mobile = "mobile"


class JobKind(PyEnum):  # not StrEnum: a member named 'split' would shadow str.split
    transcode = "transcode"
    split = "split"


class JobStatus(StrEnum):
    queued = "queued"
    running = "running"
    done = "done"
    failed = "failed"


def _enum(e: type[PyEnum]) -> Enum:
    return Enum(e, native_enum=False, length=16, validate_strings=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    recovery_hash: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(_enum(Role), default=Role.student)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_active_at: Mapped[datetime | None]

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    @property
    def groups(self) -> list["Group"]:
        return [m.group for m in self.memberships]


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    year: Mapped[int]
    weekday: Mapped[str] = mapped_column(String(16))
    label: Mapped[str] = mapped_column(String(64))
    invite_code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )


class Membership(Base):
    __tablename__ = "memberships"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    group_id: Mapped[int] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True
    )

    user: Mapped[User] = relationship(back_populates="memberships")
    group: Mapped[Group] = relationship(back_populates="memberships")


class Word(Base):
    __tablename__ = "words"
    __table_args__ = (Index("ix_words_year_list", "year", "list_number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    gloss: Mapped[str] = mapped_column(String(200), index=True)
    year: Mapped[int]
    lesson: Mapped[int | None]
    list_number: Mapped[str | None] = mapped_column(String(16))
    position: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[WordStatus] = mapped_column(_enum(WordStatus), default=WordStatus.draft)
    legacy_id: Mapped[str | None] = mapped_column(String(64), index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    clips: Mapped[list["Clip"]] = relationship(
        back_populates="word", order_by="Clip.id", cascade="all, delete-orphan"
    )

    @property
    def primary_clip(self) -> "Clip | None":
        live = [c for c in self.clips if not c.archived]
        for c in live:
            if c.is_primary:
                return c
        return live[0] if live else None


class Clip(Base):
    __tablename__ = "clips"

    id: Mapped[int] = mapped_column(primary_key=True)
    word_id: Mapped[int] = mapped_column(ForeignKey("words.id", ondelete="CASCADE"), index=True)
    file: Mapped[str] = mapped_column(String(255))
    duration: Mapped[float] = mapped_column(Float, default=0.0)
    thumb: Mapped[str | None] = mapped_column(String(255))
    source: Mapped[ClipSource] = mapped_column(_enum(ClipSource))
    recorded_at: Mapped[datetime | None]
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    word: Mapped[Word] = relationship(back_populates="clips")


class WordEvent(Base):
    __tablename__ = "word_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    word_id: Mapped[int] = mapped_column(ForeignKey("words.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(32))
    diff_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    undone: Mapped[bool] = mapped_column(Boolean, default=False)
    at: Mapped[datetime] = mapped_column(default=utcnow)

    user: Mapped[User | None] = relationship()


class GroupEvent(Base):
    __tablename__ = "group_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    from_group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id", ondelete="SET NULL"))
    to_group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id", ondelete="SET NULL"))
    by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    at: Mapped[datetime] = mapped_column(default=utcnow)


class Result(Base):
    __tablename__ = "results"
    __table_args__ = (Index("ix_results_user_word", "user_id", "word_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    word_id: Mapped[int] = mapped_column(ForeignKey("words.id", ondelete="CASCADE"))
    direction: Mapped[Direction] = mapped_column(_enum(Direction))
    correct: Mapped[bool] = mapped_column(Boolean)
    at: Mapped[datetime] = mapped_column(default=utcnow)


class AuthSession(Base):
    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    client: Mapped[ClientKind] = mapped_column(_enum(ClientKind))
    expires_at: Mapped[datetime]

    user: Mapped[User] = relationship()


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[JobKind] = mapped_column(_enum(JobKind))
    status: Mapped[JobStatus] = mapped_column(_enum(JobStatus), default=JobStatus.queued)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
