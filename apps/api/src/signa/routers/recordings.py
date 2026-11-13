from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import select

from signa.deps import DB, Teacher
from signa.jobs import enqueue, wake
from signa.legacy import lesson_of
from signa.models import Job, JobKind, JobStatus, Word, WordStatus
from signa.routers.uploads import save_upload
from signa.schemas import JobOut, RecordingApplyIn, RecordingOut, Segment, SegmentsIn, SplitIn
from signa.services import words as word_service

router = APIRouter(prefix="/admin", tags=["admin: recordings"])


def _recording_out(job: Job) -> RecordingOut:
    result = job.result or {}
    return RecordingOut(
        id=job.id,
        status=job.status,
        filename=job.payload.get("filename", ""),
        created_at=job.created_at,
        error=job.error,
        source_url=f"/api/v1/media/recordings/{job.id}" if result.get("source") else None,
        duration=result.get("duration"),
        method=result.get("method"),
        segments=[Segment(**s) for s in result.get("segments", [])],
        applied=result.get("applied", []),
    )


def _recording(db: DB, ctx: Teacher, job_id: int) -> Job:
    job = db.get(Job, job_id)
    if job is None or job.kind != JobKind.split or job.org_id != ctx.org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recording not found")
    return job


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: int, ctx: Teacher, db: DB) -> JobOut:
    job = db.get(Job, job_id)
    if job is None or job.org_id != ctx.org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    return JobOut.model_validate(job)


@router.get("/recordings", response_model=list[RecordingOut])
def list_recordings(ctx: Teacher, db: DB) -> list[RecordingOut]:
    jobs = db.scalars(
        select(Job)
        .where(Job.kind == JobKind.split, Job.org_id == ctx.org.id)
        .order_by(Job.id.desc())
    )
    return [_recording_out(j) for j in jobs]


@router.post("/recordings", response_model=RecordingOut, status_code=202)
def upload_recording(ctx: Teacher, db: DB, file: Annotated[UploadFile, File()]) -> RecordingOut:
    """Upload a long video. It is converted and split on the pauses in the background."""
    rel = save_upload(file)
    payload = {"upload": rel, "filename": file.filename or "video"}
    job = enqueue(db, JobKind.split, payload, ctx.user, ctx.org.id)
    return _recording_out(job)


@router.get("/recordings/{job_id}", response_model=RecordingOut)
def get_recording(job_id: int, ctx: Teacher, db: DB) -> RecordingOut:
    return _recording_out(_recording(db, ctx, job_id))


def _check_segments(job: Job, segments: list[Segment]) -> None:
    duration = (job.result or {}).get("duration") or 0
    for s in segments:
        if s.end <= s.start or s.end > duration + 0.5:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A cut point is outside the video")


@router.put("/recordings/{job_id}/segments", response_model=RecordingOut)
def save_segments(job_id: int, body: SegmentsIn, ctx: Teacher, db: DB) -> RecordingOut:
    """Save adjusted cut points."""
    job = _recording(db, ctx, job_id)
    if job.status != JobStatus.done:
        raise HTTPException(status.HTTP_409_CONFLICT, "The recording is not ready yet")
    _check_segments(job, body.segments)
    segments = sorted(body.segments, key=lambda s: s.start)
    job.result = {**(job.result or {}), "segments": [s.model_dump() for s in segments]}
    db.commit()
    return _recording_out(job)


@router.post("/recordings/{job_id}/split", response_model=RecordingOut, status_code=202)
def split_again(job_id: int, body: SplitIn, ctx: Teacher, db: DB) -> RecordingOut:
    """Detect the cut points again, for example with the other method. Replaces the segments."""
    job = _recording(db, ctx, job_id)
    if job.status != JobStatus.done or not (job.result or {}).get("source"):
        raise HTTPException(status.HTTP_409_CONFLICT, "The recording is not ready yet")
    job.payload = {**job.payload, "method": body.method}
    job.status = JobStatus.queued
    job.error = None
    db.commit()
    wake()
    return _recording_out(job)


def _key(gloss: str) -> str:
    return " ".join(gloss.split()).casefold()


def _create_words(db: DB, body: RecordingApplyIn, ctx: Teacher) -> dict[int, Word]:
    """Create the new words of an apply request, in segment order. Returns {item index: word}."""
    user = ctx.user
    new = [(i, item.gloss) for i, item in enumerate(body.items) if item.gloss is not None]
    if not new:
        return {}
    if body.year is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a year for the new words")
    list_number = body.list_number or None
    lesson = body.lesson if body.lesson is not None else lesson_of(list_number)
    if lesson is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a lesson for the new words")
    seen: set[str] = set()
    for _i, gloss in new:
        if _key(gloss) in seen:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"'{gloss}' is in the list twice")
        seen.add(_key(gloss))
    on_list = list(
        db.scalars(
            select(Word).where(
                Word.org_id == ctx.org.id,
                Word.year == body.year,
                Word.list_number == list_number,
            )
        )
    )
    taken = sorted(w.gloss for w in on_list if _key(w.gloss) in seen)
    if taken:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Already on this list: {', '.join(taken)}. Choose the existing word instead.",
        )
    position = max((w.position for w in on_list), default=0)
    created: dict[int, Word] = {}
    for i, gloss in new:
        position += 1
        word = Word(
            org_id=ctx.org.id,
            gloss=gloss,
            year=body.year,
            lesson=lesson,
            list_number=list_number,
            position=position,
            status=WordStatus.published if body.publish else WordStatus.draft,
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(word)
        db.flush()
        word_service.log(db, word, user, "create", word_service.snapshot(word))
        created[i] = word
    return created


@router.post("/recordings/{job_id}/apply", response_model=list[JobOut], status_code=202)
def apply_recording(job_id: int, body: RecordingApplyIn, ctx: Teacher, db: DB) -> list[JobOut]:
    """Cut each segment into a clip: for an existing word (replace or add as extra), or for
    a new word on the chosen year and list (created as a draft unless ``publish``)."""
    job = _recording(db, ctx, job_id)
    if job.status != JobStatus.done or not job.result:
        raise HTTPException(status.HTTP_409_CONFLICT, "The recording is not ready yet")
    _check_segments(job, list(body.items))
    ids = {i.word_id for i in body.items if i.word_id is not None}
    missing = ids - set(
        db.scalars(select(Word.id).where(Word.id.in_(ids), Word.org_id == ctx.org.id))
    )
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown words: {sorted(missing)}")
    created = _create_words(db, body, ctx)
    jobs: list[Job] = []
    applied = list(job.result.get("applied", []))
    for i, item in enumerate(body.items):
        word_id = created[i].id if i in created else item.word_id
        child = enqueue(
            db,
            JobKind.transcode,
            {
                "src": job.result["source"],
                "word_id": word_id,
                "mode": item.mode,
                "start": item.start,
                "end": item.end,
                "source": "recording",
                "recording_id": job.id,
            },
            ctx.user,
            ctx.org.id,
        )
        jobs.append(child)
        applied.append(
            {**item.model_dump(), "word_id": word_id, "new": i in created, "job_id": child.id}
        )
    job.result = {**job.result, "applied": applied}
    db.commit()
    return [JobOut.model_validate(j) for j in jobs]
