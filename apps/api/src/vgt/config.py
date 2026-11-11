from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings, read from environment variables prefixed with ``VGT_``."""

    model_config = SettingsConfigDict(env_prefix="VGT_", env_file=".env", extra="ignore")

    # "dev" and "pro" are the two deployments; "local" is a developer machine.
    environment: Literal["local", "dev", "pro"] = "local"
    # The git commit the image was built from (set by the Docker build).
    release: str = "local"
    # Fill an empty database with demo users and words at startup (dev only).
    seed_demo: bool = False
    database_url: str = "sqlite:///./data/vgt.db"
    backup_dir: Path = Path("./data/backups")
    backup_keep: int = 14
    media_dir: Path = Path("./data/media")
    web_dist: Path | None = None
    session_days: int = 30
    cookie_secure: bool = False
    cookie_name: str = "vgt_session"
    run_worker: bool = True
    public_url: str = "http://localhost:5173"
    max_upload_mb: int = 2048
    # Encoding settings for every clip. Fixed so all clips play the same everywhere.
    video_height: int = 480
    video_crf: int = 26
    # Auto-split for recording sessions. "motion" finds the rests between signs, with a
    # threshold that adapts to each video; "freeze" uses ffmpeg freezedetect (truly still frames).
    split_method: Literal["motion", "freeze"] = "motion"
    # motion: the quietest share of the video (in %) that counts as rest.
    split_rest_percentile: float = 30
    # freeze: noise tolerance and the shortest still moment (s).
    split_noise: float = 0.003
    split_min_freeze: float = 0.6
    # Both: parts shorter than this (s) are dropped.
    split_min_clip: float = 0.6


@lru_cache
def get_settings() -> Settings:
    return Settings()
