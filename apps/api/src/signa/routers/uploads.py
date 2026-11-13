from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from signa import media
from signa.config import get_settings

_VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi", ".3gp"}


def save_upload(upload: UploadFile) -> str:
    """Store an uploaded video under ``uploads/`` and return its media-relative path."""
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in _VIDEO_SUFFIXES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload a video file (mp4, mov, webm…)")
    rel = media.new_rel("uploads", suffix)
    dst = media.media_path(rel)
    limit = get_settings().max_upload_mb * 1024 * 1024
    written = 0
    with dst.open("wb") as out:
        while chunk := upload.file.read(1024 * 1024):
            written += len(chunk)
            if written > limit:
                out.close()
                dst.unlink(missing_ok=True)
                raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File too large")
            out.write(chunk)
    if written == 0:
        dst.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    return rel
