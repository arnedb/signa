"""A small job queue in the database, worked off by one background thread."""

import logging
import threading
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from signa import media
from signa.config import get_settings
from signa.db import session_factory, utcnow
from signa.models import Clip, ClipSource, Job, JobKind, JobStatus, User, Word
from signa.services import words as word_service

log = logging.getLogger("signa.jobs")
_wake = threading.Event()


def enqueue(
    db: Session, kind: JobKind, payload: dict[str, Any], user: User | None, org_id: int | None
) -> Job:
    job = Job(kind=kind, payload=payload, created_by=user.id if user else None, org_id=org_id)
    db.add(job)
    db.commit()
    _wake.set()
    return job


def wake() -> None:
    """Tell the worker that a job was queued (or queued again)."""
    _wake.set()


def _run_transcode(db: Session, job: Job) -> dict[str, Any]:
    p = job.payload
    word = db.get(Word, p["word_id"])
    if word is None:
        raise media.MediaError("Word no longer exists")
    trimmed = db.get(Clip, p["trim"]) if p.get("trim") else None
    if p.get("trim") and (trimmed is None or trimmed.word_id != word.id):
        raise media.MediaError("Clip no longer exists")
    files = media.make_clip(media.media_path(p["src"]), p.get("start"), p.get("end"))
    clip = Clip(
        file=files.file,
        thumb=files.thumb,
        duration=files.duration,
        source=ClipSource(p.get("source", "recording")),
        recorded_at=trimmed.recorded_at if trimmed else utcnow(),
    )
    user = db.get(User, job.created_by) if job.created_by else None
    if trimmed is not None:
        word_service.trim_clip(db, word, clip, trimmed, user, p["start"], p["end"])
    else:
        word_service.attach_clip(db, word, clip, p.get("mode", "replace"), user)
    if p.get("delete_src"):
        media.media_path(p["src"]).unlink(missing_ok=True)
    return {"clip_id": clip.id, "word_id": word.id}


def _run_split(db: Session, job: Job) -> dict[str, Any]:
    previous = job.result or {}
    method = job.payload.get("method") or get_settings().split_method
    if previous.get("source"):
        # Split again (another method): the converted copy is already there.
        source_rel = previous["source"]
        source = media.media_path(source_rel)
    else:
        upload = media.media_path(job.payload["upload"])
        # A browser-friendly copy of the whole recording, used to preview and cut.
        source_rel = media.new_rel("sources", ".mp4")
        source = media.media_path(source_rel)
        media.transcode(upload, source)
        upload.unlink(missing_ok=True)
    duration = media.probe_duration(source)
    segments = media.detect_segments(source, duration, method)
    return {
        **previous,
        "source": source_rel,
        "duration": round(duration, 3),
        "method": method,
        "segments": [{"start": a, "end": b} for a, b in segments],
        "applied": previous.get("applied", []),
    }


def run_job(db: Session, job: Job) -> None:
    job.status = JobStatus.running
    db.commit()
    try:
        result = _run_transcode(db, job) if job.kind == JobKind.transcode else _run_split(db, job)
    except Exception as exc:
        db.rollback()
        log.exception("Job %s failed", job.id)
        job.error = str(exc) or exc.__class__.__name__
        # A recording that was split before stays usable when splitting it again fails.
        resplit = job.kind == JobKind.split and (job.result or {}).get("source")
        job.status = JobStatus.done if resplit else JobStatus.failed
    else:
        job.status = JobStatus.done
        job.error = None
        job.result = result
    db.commit()


def run_pending() -> int:
    """Run all queued jobs. Returns how many ran."""
    count = 0
    factory = session_factory()
    while True:
        with factory() as db:
            job = db.scalars(
                select(Job).where(Job.status == JobStatus.queued).order_by(Job.id).limit(1)
            ).first()
            if job is None:
                return count
            run_job(db, job)
            count += 1


def reset_stale() -> None:
    """Jobs left 'running' by a crash are queued again at startup."""
    with session_factory()() as db:
        for job in db.scalars(select(Job).where(Job.status == JobStatus.running)):
            job.status = JobStatus.queued
        db.commit()


class Worker(threading.Thread):
    def __init__(self) -> None:
        super().__init__(name="signa-worker", daemon=True)
        self._stop_event = threading.Event()

    def run(self) -> None:
        reset_stale()
        while not self._stop_event.is_set():
            try:
                run_pending()
            except Exception:
                log.exception("Worker loop failed")
            _wake.wait(timeout=5)
            _wake.clear()

    def stop(self) -> None:
        self._stop_event.set()
        _wake.set()
