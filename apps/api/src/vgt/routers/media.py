from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from vgt import media
from vgt.deps import DB, CurrentUser, Teacher
from vgt.models import Clip, Job, JobKind, Role, WordStatus

router = APIRouter(prefix="/media", tags=["media"])

# Clips are only for logged-in users, so caches must not share them.
_CACHE = {"Cache-Control": "private, max-age=604800"}


def _visible_clip(db: DB, clip_id: int, user: CurrentUser) -> Clip:
    clip = db.get(Clip, clip_id)
    if clip is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    if user.role == Role.student and (clip.archived or clip.word.status != WordStatus.published):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    return clip


def _file(rel: str, media_type: str) -> FileResponse:
    path = media.media_path(rel)
    if not path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "File missing")
    # FileResponse answers Range requests, which video players need to seek.
    return FileResponse(path, media_type=media_type, headers=_CACHE)


@router.get("/clips/{clip_id}", response_class=FileResponse)
def clip_video(clip_id: int, user: CurrentUser, db: DB) -> FileResponse:
    return _file(_visible_clip(db, clip_id, user).file, "video/mp4")


@router.get("/thumbs/{clip_id}", response_class=FileResponse)
def clip_thumb(clip_id: int, user: CurrentUser, db: DB) -> FileResponse:
    clip = _visible_clip(db, clip_id, user)
    if not clip.thumb:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No thumbnail")
    return _file(clip.thumb, "image/jpeg")


@router.get("/recordings/{job_id}", response_class=FileResponse)
def recording_source(job_id: int, _user: Teacher, db: DB) -> FileResponse:
    job = db.get(Job, job_id)
    if job is None or job.kind != JobKind.split or not job.result:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Recording not found")
    return _file(job.result["source"], "video/mp4")
