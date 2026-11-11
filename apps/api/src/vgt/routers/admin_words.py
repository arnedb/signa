from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from vgt.deps import DB, Teacher
from vgt.jobs import enqueue
from vgt.models import Clip, JobKind, Word, WordEvent, WordStatus
from vgt.routers.uploads import save_upload
from vgt.routers.words import word_query
from vgt.schemas import AdminWordOut, JobOut, WordCreate, WordEventOut, WordUpdate
from vgt.services import words as svc

router = APIRouter(prefix="/admin", tags=["admin: words"])


def _word(db: DB, word_id: int) -> Word:
    word = db.get(Word, word_id)
    if word is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Word not found")
    return word


def _clip(db: DB, clip_id: int) -> Clip:
    clip = db.get(Clip, clip_id)
    if clip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    return clip


@router.get("/words", response_model=list[AdminWordOut])
def list_words(
    _user: Teacher,
    db: DB,
    year: int | None = None,
    lesson: int | None = None,
    list_number: str | None = None,
    q: str | None = None,
    status_: Annotated[WordStatus | None, Query(alias="status")] = None,
    missing_clip: bool = False,
) -> list[AdminWordOut]:
    stmt = word_query(year, lesson, list_number, q)
    if status_ is not None:
        stmt = stmt.where(Word.status == status_)
    words = [svc.admin_word_out(w) for w in db.scalars(stmt)]
    if missing_clip:
        words = [w for w in words if not any(not c.archived for c in w.clips)]
    return words


@router.post("/words", response_model=AdminWordOut, status_code=201)
def create_word(body: WordCreate, user: Teacher, db: DB) -> AdminWordOut:
    word = Word(**body.model_dump(), created_by=user.id, updated_by=user.id)
    db.add(word)
    db.flush()
    svc.log(db, word, user, "create", svc.snapshot(word))
    db.commit()
    return svc.admin_word_out(word)


@router.get("/words/{word_id}", response_model=AdminWordOut)
def get_word(word_id: int, _user: Teacher, db: DB) -> AdminWordOut:
    return svc.admin_word_out(_word(db, word_id))


@router.patch("/words/{word_id}", response_model=AdminWordOut)
def update_word(word_id: int, body: WordUpdate, user: Teacher, db: DB) -> AdminWordOut:
    word = _word(db, word_id)
    svc.apply_changes(db, word, body.model_dump(exclude_unset=True), user)
    db.commit()
    return svc.admin_word_out(word)


@router.get("/words/{word_id}/events", response_model=list[WordEventOut])
def word_events(word_id: int, _user: Teacher, db: DB) -> list[WordEventOut]:
    _word(db, word_id)
    events = db.scalars(
        select(WordEvent)
        .where(WordEvent.word_id == word_id)
        .options(selectinload(WordEvent.user))
        .order_by(WordEvent.id.desc())
    )
    return [WordEventOut.model_validate(e) for e in events]


@router.post("/events/{event_id}/undo", response_model=AdminWordOut)
def undo_event(event_id: int, user: Teacher, db: DB) -> AdminWordOut:
    event = db.get(WordEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    svc.undo(db, event, user)
    db.commit()
    return svc.admin_word_out(_word(db, event.word_id))


@router.post("/words/{word_id}/clips", response_model=JobOut, status_code=202)
def upload_clip(
    word_id: int,
    user: Teacher,
    db: DB,
    file: Annotated[UploadFile, File()],
    mode: Annotated[Literal["replace", "extra"], Form()] = "replace",
) -> JobOut:
    """Upload one clip for a word. It is converted in the background; poll the job."""
    _word(db, word_id)
    rel = save_upload(file)
    job = enqueue(
        db,
        JobKind.transcode,
        {"src": rel, "word_id": word_id, "mode": mode, "source": "recording", "delete_src": True},
        user,
    )
    return JobOut.model_validate(job)


@router.post("/clips/{clip_id}/primary", response_model=AdminWordOut)
def clip_primary(clip_id: int, user: Teacher, db: DB) -> AdminWordOut:
    clip = _clip(db, clip_id)
    svc.make_primary(db, clip.word, clip, user)
    db.commit()
    return svc.admin_word_out(clip.word)


@router.post("/clips/{clip_id}/archive", response_model=AdminWordOut)
def clip_archive(clip_id: int, user: Teacher, db: DB) -> AdminWordOut:
    clip = _clip(db, clip_id)
    if not clip.archived:
        svc.archive_clip(db, clip.word, clip, user)
        db.commit()
    return svc.admin_word_out(clip.word)


@router.post("/clips/{clip_id}/restore", response_model=AdminWordOut)
def clip_restore(clip_id: int, user: Teacher, db: DB) -> AdminWordOut:
    clip = _clip(db, clip_id)
    if clip.archived:
        svc.restore_clip(db, clip.word, clip, user)
        db.commit()
    return svc.admin_word_out(clip.word)
