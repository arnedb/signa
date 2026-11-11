from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from sqlalchemy import select

from vgt.deps import DB, Teacher
from vgt.jobs import enqueue
from vgt.models import Job, JobKind, JobStatus, Word
from vgt.routers.uploads import save_upload
from vgt.schemas import JobOut, RecordingApplyIn, RecordingOut, Segment, SegmentsIn

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


@router.post("/recordings/{job_id}/apply", response_model=list[JobOut], status_code=202)
def apply_recording(job_id: int, body: RecordingApplyIn, ctx: Teacher, db: DB) -> list[JobOut]:
    """Cut each matched segment into a clip for its word (replace or add as extra)."""
    job = _recording(db, ctx, job_id)
    if job.status != JobStatus.done or not job.result:
        raise HTTPException(status.HTTP_409_CONFLICT, "The recording is not ready yet")
    _check_segments(job, list(body.items))
    ids = [i.word_id for i in body.items]
    missing = set(ids) - set(
        db.scalars(select(Word.id).where(Word.id.in_(ids), Word.org_id == ctx.org.id))
    )
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown words: {sorted(missing)}")
    jobs: list[Job] = []
    applied = list(job.result.get("applied", []))
    for item in body.items:
        child = enqueue(
            db,
            JobKind.transcode,
            {
                "src": job.result["source"],
                "word_id": item.word_id,
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
        applied.append({**item.model_dump(), "job_id": child.id})
    job.result = {**job.result, "applied": applied}
    db.commit()
    return [JobOut.model_validate(j) for j in jobs]
