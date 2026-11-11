import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from vgt import db as vgt_db
from vgt.config import get_settings
from vgt.db import Base, make_engine
from vgt.models import Group, Membership, Role, User
from vgt.security import hash_secret

PASSWORD = "correct horse"


@pytest.fixture(autouse=True)
def settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("VGT_DATABASE_URL", f"sqlite:///{tmp_path}/test.db")
    monkeypatch.setenv("VGT_MEDIA_DIR", str(tmp_path / "media"))
    monkeypatch.setenv("VGT_RUN_WORKER", "false")
    get_settings.cache_clear()
    engine = make_engine(get_settings().database_url)
    Base.metadata.create_all(engine)
    vgt_db.set_engine(engine)
    yield
    engine.dispose()
    get_settings.cache_clear()


@pytest.fixture
def db() -> Iterator[Session]:
    with vgt_db.session_factory()() as session:
        yield session


@pytest.fixture
def app_client() -> Iterator[TestClient]:
    from vgt.main import create_app

    with TestClient(create_app(run_worker=False), headers={"X-VGT-Client": "web"}) as client:
        yield client


@pytest.fixture
def group(db: Session) -> Group:
    g = Group(year=1, weekday="dinsdag", label="Jaar 1 · dinsdag", invite_code="invite-1")
    db.add(g)
    db.commit()
    return g


def make_user(db: Session, username: str, role: Role, group: Group | None = None) -> User:
    user = User(username=username, password_hash=hash_secret(PASSWORD), role=role)
    db.add(user)
    db.flush()
    if group:
        db.add(Membership(user_id=user.id, group_id=group.id))
    db.commit()
    return user


def login(client: TestClient, username: str) -> TestClient:
    r = client.post("/api/v1/auth/login", json={"username": username, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return client


@pytest.fixture
def student(app_client: TestClient, db: Session, group: Group) -> TestClient:
    make_user(db, "student1", Role.student, group)
    return login(app_client, "student1")


@pytest.fixture
def teacher(app_client: TestClient, db: Session, group: Group) -> TestClient:
    make_user(db, "teacher1", Role.teacher, group)
    return login(app_client, "teacher1")


@pytest.fixture
def admin(app_client: TestClient, db: Session) -> TestClient:
    make_user(db, "admin1", Role.admin)
    return login(app_client, "admin1")


@pytest.fixture(scope="session")
def sample_video(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Three moving parts separated by still frames: 1s move, 1.5s still, three times."""
    out = tmp_path_factory.mktemp("video") / "sample.mp4"
    filters = []
    for i in range(3):
        filters.append(f"[0]trim=start={i}:duration=1,setpts=PTS-STARTPTS[m{i}]")
        filters.append(f"[1]trim=duration=1.5,setpts=PTS-STARTPTS[s{i}]")
    filters.append("".join(f"[m{i}][s{i}]" for i in range(3)) + "concat=n=6:v=1:a=0[out]")
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=4",
            "-f", "lavfi", "-i", "color=c=gray:s=320x240:r=30:d=2",
            "-filter_complex", ";".join(filters), "-map", "[out]",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out),
        ],
        check=True,
    )  # fmt: skip
    return out


@pytest.fixture(scope="session")
def noisy_video(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Like a real class video: the signer rests (1.5 s) before, between and after three
    signs (1 s each), and camera noise means no frame is ever truly still."""
    out = tmp_path_factory.mktemp("video") / "noisy.mp4"
    filters = ["[1]trim=duration=1.5,setpts=PTS-STARTPTS,split=4[r0][r1][r2][r3]"]
    for i in range(3):
        filters.append(f"[0]trim=start={i}:duration=1,setpts=PTS-STARTPTS[m{i}]")
    filters.append("[r0][m0][r1][m1][r2][m2][r3]concat=n=7:v=1:a=0,noise=alls=25:allf=t[out]")
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=4",
            "-f", "lavfi", "-i", "color=c=gray:s=320x240:r=30:d=2",
            "-filter_complex", ";".join(filters), "-map", "[out]",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out),
        ],
        check=True,
    )  # fmt: skip
    return out
