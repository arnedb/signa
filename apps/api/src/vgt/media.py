"""ffmpeg helpers. Every clip gets the same encoding: H.264 MP4 with +faststart, no audio."""

import json
import re
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path

from vgt.config import get_settings


class MediaError(RuntimeError):
    pass


def media_path(rel: str) -> Path:
    root = get_settings().media_dir.resolve()
    path = (root / rel).resolve()
    if root not in path.parents:
        raise MediaError(f"Path outside media dir: {rel}")
    return path


def new_rel(folder: str, suffix: str) -> str:
    rel = f"{folder}/{uuid.uuid4().hex}{suffix}"
    media_path(rel).parent.mkdir(parents=True, exist_ok=True)
    return rel


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(args, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise MediaError(
            proc.stderr.strip().splitlines()[-1] if proc.stderr.strip() else "ffmpeg failed"
        )
    return proc


def probe_duration(path: Path) -> float:
    proc = _run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)]
    )
    try:
        return float(json.loads(proc.stdout)["format"]["duration"])
    except (KeyError, ValueError) as exc:
        raise MediaError("Could not read the video duration") from exc


def transcode(src: Path, dst: Path, start: float | None = None, end: float | None = None) -> None:
    s = get_settings()
    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]
    if start is not None:
        args += ["-ss", f"{start:.3f}"]
    if end is not None:
        args += ["-to", f"{end:.3f}"]
    args += [
        "-i", str(src),
        "-vf", f"scale=-2:'min({s.video_height},ih)',fps=30,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", str(s.video_crf),
        "-profile:v", "main", "-movflags", "+faststart", "-an",
        str(dst),
    ]  # fmt: skip
    dst.parent.mkdir(parents=True, exist_ok=True)
    _run(args)


def thumbnail(src: Path, dst: Path, duration: float) -> None:
    at = max(0.0, min(duration * 0.4, duration - 0.1))
    dst.parent.mkdir(parents=True, exist_ok=True)
    _run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{at:.3f}", "-i", str(src),
        "-frames:v", "1", "-vf", "scale=-2:240", "-q:v", "5", str(dst),
    ])  # fmt: skip


@dataclass
class ClipFiles:
    file: str
    thumb: str
    duration: float


def make_clip(src: Path, start: float | None = None, end: float | None = None) -> ClipFiles:
    """Encode ``src`` (or a part of it) as a standard clip with a thumbnail."""
    rel = new_rel("clips", ".mp4")
    dst = media_path(rel)
    transcode(src, dst, start, end)
    duration = probe_duration(dst)
    thumb = new_rel("thumbs", ".jpg")
    thumbnail(dst, media_path(thumb), duration)
    return ClipFiles(file=rel, thumb=thumb, duration=round(duration, 3))


_FREEZE = re.compile(r"lavfi\.freezedetect\.freeze_(start|end): ([\d.]+)")


def detect_segments(
    src: Path, duration: float, noise: float, min_freeze: float, min_clip: float
) -> list[tuple[float, float]]:
    """Split a long recording on still moments: the signer pauses between words.

    Returns the moving parts between freezes, longer than ``min_clip`` seconds.
    """
    proc = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-i", str(src),
            "-vf", f"scale=320:-2,freezedetect=n={noise}:d={min_freeze}",
            "-map", "0:v:0", "-f", "null", "-",
        ],
        capture_output=True, text=True, check=False,
    )  # fmt: skip
    if proc.returncode != 0:
        raise MediaError("freezedetect failed")
    freezes: list[tuple[float, float]] = []
    start: float | None = None
    for kind, value in _FREEZE.findall(proc.stderr):
        if kind == "start":
            start = float(value)
        elif start is not None:
            freezes.append((start, float(value)))
            start = None
    if start is not None:
        freezes.append((start, duration))

    segments: list[tuple[float, float]] = []
    cursor = 0.0
    for f_start, f_end in freezes:
        if f_start - cursor >= min_clip:
            segments.append((cursor, f_start))
        cursor = f_end
    if duration - cursor >= min_clip:
        segments.append((cursor, duration))
    # Keep a little of the still moment on each side, so the sign does not start abruptly.
    pad = min(0.15, min_freeze / 4)
    return [(round(max(0.0, a - pad), 2), round(min(duration, b + pad), 2)) for a, b in segments]
