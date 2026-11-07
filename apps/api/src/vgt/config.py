from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings, read from environment variables prefixed with ``VGT_``."""

    model_config = SettingsConfigDict(env_prefix="VGT_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./data/vgt.db"
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
    # Auto-split settings for recording sessions (ffmpeg freezedetect).
    split_noise: float = 0.003
    split_min_freeze: float = 0.6
    split_min_clip: float = 0.6


@lru_cache
def get_settings() -> Settings:
    return Settings()
