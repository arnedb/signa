from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from vgt.models import ClientKind, ClipSource, Direction, JobKind, JobStatus, Role, WordStatus

Username = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=3, max_length=32, pattern=r"^[A-Za-z0-9._-]+$"
    ),
]
Password = Annotated[str, StringConstraints(min_length=8, max_length=200)]
Weekday = Literal["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"]
ClipMode = Literal["replace", "extra"]


class HealthOut(BaseModel):
    status: Literal["ok"]
    version: str
    release: str
    environment: Literal["local", "dev", "pro"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- groups / users -------------------------------------------------------------------------


class GroupBrief(ORM):
    id: int
    year: int
    weekday: str
    label: str
    active: bool


class Me(ORM):
    id: int
    username: str
    role: Role
    groups: list[GroupBrief]
    created_at: datetime


# --- auth -----------------------------------------------------------------------------------


class LoginIn(BaseModel):
    username: str
    password: str
    client: ClientKind = ClientKind.web


class LoginOut(BaseModel):
    user: Me
    token: Annotated[str | None, Field(description="Session token, only for the mobile client")] = (
        None
    )


class InviteOut(BaseModel):
    group: GroupBrief


class RegisterIn(BaseModel):
    invite_code: str
    username: Username
    password: Password
    client: ClientKind = ClientKind.web


class RegisterOut(LoginOut):
    recovery_code: str


class RecoverIn(BaseModel):
    username: str
    recovery_code: str
    new_password: Password


class RecoveryCodeOut(BaseModel):
    recovery_code: str


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: Password


class PasswordConfirmIn(BaseModel):
    password: str


# --- words & clips --------------------------------------------------------------------------


class ClipOut(ORM):
    id: int
    duration: float
    source: ClipSource
    is_primary: bool
    archived: bool
    recorded_at: datetime | None
    updated_at: datetime
    url: str
    thumb_url: str | None


class WordOut(ORM):
    id: int
    gloss: str
    year: int
    lesson: int | None
    list_number: str | None
    position: int
    notes: str
    clips: list[ClipOut]


class AdminWordOut(WordOut):
    status: WordStatus
    legacy_id: str | None
    created_at: datetime
    updated_at: datetime


class CatalogList(BaseModel):
    list_number: str | None
    lesson: int | None
    count: int


class CatalogYear(BaseModel):
    year: int
    count: int
    lessons: list[int]
    lists: list[CatalogList]


class Catalog(BaseModel):
    years: list[CatalogYear]


class WordCreate(BaseModel):
    gloss: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    year: int = Field(ge=1, le=10)
    lesson: int | None = Field(None, ge=0, le=100)
    list_number: Annotated[str, StringConstraints(strip_whitespace=True, max_length=16)] | None = (
        None
    )
    position: int = 0
    notes: str = ""
    status: WordStatus = WordStatus.draft


class WordUpdate(BaseModel):
    gloss: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
        | None
    ) = None
    year: int | None = Field(None, ge=1, le=10)
    lesson: int | None = Field(None, ge=0, le=100)
    list_number: Annotated[str, StringConstraints(strip_whitespace=True, max_length=16)] | None = (
        None
    )
    position: int | None = None
    notes: str | None = None
    status: WordStatus | None = None


class EventUser(ORM):
    id: int
    username: str


class WordEventOut(ORM):
    id: int
    word_id: int
    action: str
    diff_json: dict[str, Any]
    undone: bool
    at: datetime
    user: EventUser | None


# --- practice -------------------------------------------------------------------------------


class ResultIn(BaseModel):
    word_id: int
    direction: Direction
    correct: bool
    at: datetime | None = None


class ResultsIn(BaseModel):
    results: list[ResultIn] = Field(max_length=500)


class ResultsOut(BaseModel):
    saved: int


# --- jobs & recordings ----------------------------------------------------------------------


class JobOut(ORM):
    id: int
    kind: JobKind
    status: JobStatus
    payload: dict[str, Any]
    result: dict[str, Any] | None
    error: str | None
    created_at: datetime
    updated_at: datetime


class Segment(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class SegmentsIn(BaseModel):
    segments: list[Segment]


class RecordingItem(Segment):
    word_id: int
    mode: ClipMode = "replace"


class RecordingApplyIn(BaseModel):
    items: list[RecordingItem] = Field(min_length=1)


class RecordingOut(BaseModel):
    id: int
    status: JobStatus
    filename: str
    created_at: datetime
    error: str | None
    source_url: str | None
    duration: float | None
    segments: list[Segment]
    applied: list[dict[str, Any]]


# --- admin: groups & users ------------------------------------------------------------------


class GroupOut(GroupBrief):
    invite_code: str
    student_count: int
    teacher_count: int
    teaching: bool


class GroupCreate(BaseModel):
    year: int = Field(ge=1, le=10)
    weekday: Weekday
    label: str | None = None


class GroupUpdate(BaseModel):
    year: int | None = Field(None, ge=1, le=10)
    weekday: Weekday | None = None
    label: str | None = None
    active: bool | None = None


class MemberOut(ORM):
    id: int
    username: str
    role: Role
    created_at: datetime
    last_active_at: datetime | None


class MoveStudentsIn(BaseModel):
    user_ids: list[int] = Field(min_length=1)
    to_group_id: int


class MoveGroupIn(BaseModel):
    to_group_id: int


class MoveOut(BaseModel):
    moved: int


class GroupEventOut(BaseModel):
    id: int
    at: datetime
    username: str | None
    from_group: str | None
    to_group: str | None
    by_username: str | None


class TempPasswordOut(BaseModel):
    username: str
    temporary_password: str


class UserOut(MemberOut):
    groups: list[GroupBrief]


class RoleIn(BaseModel):
    role: Role


class UserCreate(BaseModel):
    username: Username
    role: Role = Role.teacher
