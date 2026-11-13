from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from vgt.i18n import Locale, Weekday
from vgt.models import ClientKind, ClipSource, Direction, JobKind, JobStatus, Role, WordStatus

Username = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=3, max_length=32, pattern=r"^[A-Za-z0-9._-]+$"
    ),
]
Password = Annotated[str, StringConstraints(min_length=8, max_length=200)]
ClipMode = Literal["replace", "extra"]
SplitMethod = Literal["motion", "freeze"]


class HealthOut(BaseModel):
    status: Literal["ok"]
    version: str
    release: str
    environment: Literal["local", "dev", "pro"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- groups / users -------------------------------------------------------------------------


class LanguageOut(ORM):
    code: str
    name: str
    locale: Annotated[Locale, Field(description="Spoken language of the glosses")]


class OrgBrief(ORM):
    id: int
    name: str
    slug: str
    language: LanguageOut


class MyOrg(OrgBrief):
    role: Role


class GroupBrief(ORM):
    id: int
    org_id: int
    year: int
    weekday: Weekday
    label: str
    active: bool


class Me(BaseModel):
    id: int
    username: str
    is_superadmin: bool
    locale: Annotated[
        Locale | None, Field(description="Chosen interface language; null follows the school")
    ]
    created_at: datetime
    org: Annotated[OrgBrief | None, Field(description="The organisation the user works in now")]
    role: Annotated[Role | None, Field(description="The user's role in that organisation")]
    group: Annotated[GroupBrief | None, Field(description="The group the user works in now")]
    organisations: list[MyOrg]
    groups: Annotated[list[GroupBrief], Field(description="All groups, in every organisation")]


class LocaleIn(BaseModel):
    locale: Locale | None


class ContextIn(BaseModel):
    org_id: int
    group_id: int | None = None


class JoinIn(BaseModel):
    invite_code: str


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
    org: OrgBrief


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


class DifficultWordOut(WordOut):
    """A word whose most recent answer was wrong, with the directions in which it was."""

    directions: list[Direction]


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
    """A segment for an existing word (``word_id``) or for a new word (``gloss``)."""

    word_id: int | None = None
    gloss: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
        | None
    ) = None
    mode: ClipMode = "replace"

    @model_validator(mode="after")
    def _one_target(self) -> "RecordingItem":
        if (self.word_id is None) == (self.gloss is None):
            raise ValueError("Give either word_id or gloss")
        return self


class RecordingApplyIn(BaseModel):
    items: list[RecordingItem] = Field(min_length=1)
    # Where new words (items with a gloss) go. The lesson follows from the list number.
    year: int | None = Field(None, ge=1, le=10)
    list_number: Annotated[str, StringConstraints(strip_whitespace=True, max_length=16)] | None = (
        None
    )
    # New words are drafts unless this is set.
    publish: bool = False


class SplitIn(BaseModel):
    method: SplitMethod = "motion"


class TrimIn(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class RecordingOut(BaseModel):
    id: int
    status: JobStatus
    filename: str
    created_at: datetime
    error: str | None
    source_url: str | None
    duration: float | None
    method: SplitMethod | None
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


class MemberOut(BaseModel):
    id: int
    username: str
    role: Role
    created_at: datetime
    last_active_at: datetime | None


class MoveStudentsIn(BaseModel):
    user_ids: list[int] = Field(min_length=1)
    from_group_id: int
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
    groups: Annotated[list[GroupBrief], Field(description="Groups in this organisation")]


class RoleIn(BaseModel):
    role: Role


class UserCreate(BaseModel):
    username: Username
    role: Role = Role.teacher


class MemberAddOut(BaseModel):
    username: str
    created: Annotated[bool, Field(description="False when an existing account was added")]
    temporary_password: Annotated[str | None, Field(description="Only for a new account")] = None


# --- superadmin: organisations --------------------------------------------------------------

Slug = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, min_length=2, max_length=64, pattern=r"^[a-z0-9-]+$"
    ),
]
OrgName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]


class OrgOut(OrgBrief):
    active: bool
    created_at: datetime
    member_count: int
    group_count: int
    word_count: int


class OrgCreate(BaseModel):
    name: OrgName
    slug: Slug | None = None
    language_code: str = "vgt"
    admin_username: Annotated[
        Username | None, Field(description="First admin: an existing user, or a new account")
    ] = None


class OrgCreateOut(BaseModel):
    org: OrgOut
    admin: MemberAddOut | None


class OrgUpdate(BaseModel):
    name: OrgName | None = None
    language_code: str | None = None
    active: bool | None = None
