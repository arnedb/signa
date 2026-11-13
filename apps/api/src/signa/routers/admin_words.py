from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from signa.deps import DB, Teacher
from signa.jobs import enqueue
from signa.models import Clip, JobKind, Word, WordEvent, WordStatus
from signa.routers.uploads import save_upload
from signa.routers.words import word_query
from signa.schemas import (
    AdminWordOut,
    JobOut,
    TrimIn,
    WordBulkUpdate,
    WordCreate,
    WordEventOut,
    WordIds,
    WordUpdate,
)
from signa.services import words as svc

router = APIRouter(prefix="/admin", tags=["admin: words"])


def _word(db: DB, ctx: Teacher, word_id: int) -> Word:
    word = db.get(Word, word_id)
    if word is None or word.org_id != ctx.org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Word not found")
    return word


def _clip(db: DB, ctx: Teacher, clip_id: int) -> Clip:
    clip = db.get(Clip, clip_id)
    if clip is None or clip.word.org_id != ctx.org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    return clip


@router.get("/words", response_model=list[AdminWordOut])
def list_words(
    ctx: Teacher,
    db: DB,
    year: int | None = None,
    lesson: int | None = None,
    list_number: str | None = None,
    q: str | None = None,
    status_: Annotated[WordStatus | None, Query(alias="status")] = None,
    missing_clip: bool = False,
) -> list[AdminWordOut]:
    stmt = word_query(ctx.org.id, year, lesson, list_number, q)
    if status_ is not None:
        stmt = stmt.where(Word.status == status_)
    words = [svc.admin_word_out(w) for w in db.scalars(stmt)]
    if missing_clip:
        words = [w for w in words if not any(not c.archived for c in w.clips)]
    return words


@router.post("/words", response_model=AdminWordOut, status_code=201)
def create_word(body: WordCreate, ctx: Teacher, db: DB) -> AdminWordOut:
    user = ctx.user
    word = Word(**body.model_dump(), org_id=ctx.org.id, created_by=user.id, updated_by=user.id)
    db.add(word)
    db.flush()
    svc.log(db, word, user, "create", svc.snapshot(word))
    db.commit()
    return svc.admin_word_out(word)


@router.post("/words/bulk", response_model=list[AdminWordOut])
def bulk_update_words(body: WordBulkUpdate, ctx: Teacher, db: DB) -> list[AdminWordOut]:
    """Apply the same changes to many words: all of them, or none.

    Each word gets its own history event, so a change can still be undone word by word.
    """
    changes = body.changes.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Nothing to change")
    ids = set(body.ids)
    words = list(
        db.scalars(
            select(Word)
            .where(Word.org_id == ctx.org.id, Word.id.in_(ids))
            .options(selectinload(Word.clips))
        )
    )
    if len(words) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Word not found")
    for word in words:
        svc.apply_changes(db, word, changes, ctx.user)
    db.commit()
    return [svc.admin_word_out(w) for w in sorted(words, key=lambda w: w.id)]


@router.post("/words/bulk-delete", status_code=204)
def bulk_delete_words(body: WordIds, ctx: Teacher, db: DB) -> None:
    """Delete many words for good: all of them, or none (when one is not in this school)."""
    ids = set(body.ids)
    words = list(
        db.scalars(
            select(Word)
            .where(Word.org_id == ctx.org.id, Word.id.in_(ids))
            .options(selectinload(Word.clips))
        )
    )
    if len(words) != len(ids):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Word not found")
    svc.delete_words(db, words)


@router.delete("/words/{word_id}", status_code=204)
def delete_word(word_id: int, ctx: Teacher, db: DB) -> None:
    """Delete a word for good, with its videos, history and practice results."""
    svc.delete_words(db, [_word(db, ctx, word_id)])


@router.get("/words/{word_id}", response_model=AdminWordOut)
def get_word(word_id: int, ctx: Teacher, db: DB) -> AdminWordOut:
    return svc.admin_word_out(_word(db, ctx, word_id))


@router.patch("/words/{word_id}", response_model=AdminWordOut)
def update_word(word_id: int, body: WordUpdate, ctx: Teacher, db: DB) -> AdminWordOut:
    word = _word(db, ctx, word_id)
    svc.apply_changes(db, word, body.model_dump(exclude_unset=True), ctx.user)
    db.commit()
    return svc.admin_word_out(word)


@router.get("/words/{word_id}/events", response_model=list[WordEventOut])
def word_events(word_id: int, ctx: Teacher, db: DB) -> list[WordEventOut]:
    _word(db, ctx, word_id)
    events = db.scalars(
        select(WordEvent)
        .where(WordEvent.word_id == word_id)
        .options(selectinload(WordEvent.user))
        .order_by(WordEvent.id.desc())
    )
    return [WordEventOut.model_validate(e) for e in events]


@router.post("/events/{event_id}/undo", response_model=AdminWordOut)
def undo_event(event_id: int, ctx: Teacher, db: DB) -> AdminWordOut:
    event = db.get(WordEvent, event_id)
    word = db.get(Word, event.word_id) if event else None
    if event is None or word is None or word.org_id != ctx.org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    svc.undo(db, event, ctx.user)
    db.commit()
    return svc.admin_word_out(word)


@router.post("/words/{word_id}/clips", response_model=JobOut, status_code=202)
def upload_clip(
    word_id: int,
    ctx: Teacher,
    db: DB,
    file: Annotated[UploadFile, File()],
    mode: Annotated[Literal["replace", "extra"], Form()] = "replace",
) -> JobOut:
    """Upload one clip for a word. It is converted in the background; poll the job."""
    _word(db, ctx, word_id)
    rel = save_upload(file)
    job = enqueue(
        db,
        JobKind.transcode,
        {"src": rel, "word_id": word_id, "mode": mode, "source": "recording", "delete_src": True},
        ctx.user,
        ctx.org.id,
    )
    return JobOut.model_validate(job)


@router.post("/clips/{clip_id}/trim", response_model=JobOut, status_code=202)
def trim_clip(clip_id: int, body: TrimIn, ctx: Teacher, db: DB) -> JobOut:
    """Cut the start and/or end off a clip. The shortened copy takes the clip's place in the
    background and the original is archived, so the trim can be undone. Poll the job."""
    clip = _clip(db, ctx, clip_id)
    if clip.archived:
        raise HTTPException(status.HTTP_409_CONFLICT, "Restore the clip before trimming it")
    if body.end <= body.start or body.end > clip.duration + 0.05:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The cut points are outside the clip")
    if body.end - body.start < 0.2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The clip would be too short")
    job = enqueue(
        db,
        JobKind.transcode,
        {
            "src": clip.file,
            "word_id": clip.word_id,
            "trim": clip.id,
            "start": body.start,
            "end": min(body.end, clip.duration),
            "source": clip.source.value,
        },
        ctx.user,
        ctx.org.id,
    )
    return JobOut.model_validate(job)


@router.post("/clips/{clip_id}/primary", response_model=AdminWordOut)
def clip_primary(clip_id: int, ctx: Teacher, db: DB) -> AdminWordOut:
    clip = _clip(db, ctx, clip_id)
    user = ctx.user
    svc.make_primary(db, clip.word, clip, user)
    db.commit()
    return svc.admin_word_out(clip.word)


@router.post("/clips/{clip_id}/archive", response_model=AdminWordOut)
def clip_archive(clip_id: int, ctx: Teacher, db: DB) -> AdminWordOut:
    clip = _clip(db, ctx, clip_id)
    user = ctx.user
    if not clip.archived:
        svc.archive_clip(db, clip.word, clip, user)
        db.commit()
    return svc.admin_word_out(clip.word)


@router.post("/clips/{clip_id}/restore", response_model=AdminWordOut)
def clip_restore(clip_id: int, ctx: Teacher, db: DB) -> AdminWordOut:
    clip = _clip(db, ctx, clip_id)
    user = ctx.user
    if clip.archived:
        svc.restore_clip(db, clip.word, clip, user)
        db.commit()
    return svc.admin_word_out(clip.word)
