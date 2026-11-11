"""ffmpeg helpers. Every clip gets the same encoding: H.264 MP4 with +faststart, no audio."""

import itertools
import json
import re
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

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
_MOTION = re.compile(r"pts_time:([\d.]+)\s+lavfi\.signalstats\.YAVG=([\d.]+)")

SplitMethod = Literal["motion", "freeze"]


def detect_segments(
    src: Path, duration: float, method: SplitMethod | None = None
) -> list[tuple[float, float]]:
    """Split a long recording into one part per sign, with the configured method."""
    s = get_settings()
    if (method or s.split_method) == "freeze":
        return detect_freezes(src, duration, s.split_noise, s.split_min_freeze, s.split_min_clip)
    return detect_motion(src, duration, s.split_rest_percentile, s.split_min_clip)


def detect_freezes(
    src: Path, duration: float, noise: float, min_freeze: float, min_clip: float
) -> list[tuple[float, float]]:
    """Split on frames that stand completely still (ffmpeg freezedetect).

    Works well on screen recordings or a very still camera. Camera noise or a signer who
    sways a little hides the pauses; ``detect_motion`` handles those videos.
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


def motion_profile(src: Path) -> tuple[list[float], list[float]]:
    """How much the picture changes, 10 times per second: the mean absolute difference
    between two small grey frames (0-255). Returns ``(times, motion)``."""
    proc = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-i", str(src), "-map", "0:v:0", "-an",
            "-vf", "fps=10,scale=160:90,format=gray,tblend=all_mode=difference,"
                   "signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-",
            "-f", "null", "-",
        ],
        capture_output=True, text=True, check=False,
    )  # fmt: skip
    if proc.returncode != 0:
        raise MediaError("Motion analysis failed")
    pairs = [(float(t), float(v)) for t, v in _MOTION.findall(" ".join(proc.stdout.split()))]
    return [t for t, _ in pairs], [v for _, v in pairs]


def _moving_average(values: list[float], window: int) -> list[float]:
    """Centred moving average; the edges count as zero (like numpy ``convolve(mode="same")``)."""
    half = (window - 1) // 2
    prefix = [0.0]
    for v in values:
        prefix.append(prefix[-1] + v)
    n = len(values)
    out = []
    for i in range(n):
        lo, hi = max(0, i - half), min(n, i - half + window)
        out.append((prefix[hi] - prefix[lo]) / window)
    return out


def _percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    k = (len(ordered) - 1) * pct / 100
    lo = int(k)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (k - lo)


def rest_boundaries(times: list[float], motion: list[float], rest_percentile: float) -> list[float]:
    """Find the moments between signs, from a motion profile.

    The signer rests (hands down) before, between and after the signs. The threshold adapts to
    each video's lighting and camera noise: it starts from the level of the quietest
    ``rest_percentile`` % of the smoothed motion, plus a fifth of the way up to the busy level
    (90th percentile), so small wobbles during a rest do not break it in two.

    A boundary is the middle of each rest between two signs; a rest at the very start or end
    gives its inner edge instead. When the video starts or ends while signing, its first or
    last moment is a boundary too.
    """
    if len(motion) < 10 or times[-1] <= 0:
        return []
    rate = len(motion) / times[-1]
    smooth = _moving_average(motion, max(3, round(rate * 0.5)))
    base = _percentile(smooth, rest_percentile)
    threshold = base + 0.2 * (_percentile(smooth, 90) - base)
    min_len = max(2, round(rate * 0.2))
    n = len(smooth)
    rests: list[tuple[int, int]] = []
    start: int | None = None
    for i, value in enumerate([*smooth, threshold + 1]):
        if value <= threshold and start is None:
            start = i
        elif value > threshold and start is not None:
            if i - start >= min_len:
                rests.append((start, i))
            start = None
    if not rests:
        return []
    bounds: list[float] = []
    if rests[0][0] > 0:
        bounds.append(0.0)
    for a, b in rests:
        frame = b if a == 0 else a if b == n else (a + b) // 2
        bounds.append(round(times[min(frame, n - 1)], 2))
    if rests[-1][1] < n:
        bounds.append(round(times[-1], 2))
    return sorted(set(bounds))


def detect_motion(
    src: Path, duration: float, rest_percentile: float, min_clip: float
) -> list[tuple[float, float]]:
    """Split on the rests between signs (the method of the old app's labelling tool).

    Returns one part per pair of neighbouring boundaries, longer than ``min_clip`` seconds.
    """
    times, motion = motion_profile(src)
    bounds = rest_boundaries(times, motion, rest_percentile)
    bounds = [min(b, duration) for b in bounds]
    return [(a, b) for a, b in itertools.pairwise(bounds) if b - a >= min_clip]
