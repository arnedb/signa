"""Fill a database with demo data: about 20 words, demo users and one group.

Clips come from a folder of MP4s named after the gloss (``huis.mp4``), as in the demo release
asset. Without a folder, simple generated test clips are used, which is enough for development.
"""

import subprocess
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from vgt import media
from vgt.models import Clip, ClipSource, Group, Membership, Role, User, Word, WordStatus
from vgt.security import hash_secret, new_recovery_code
from vgt.services import words as word_service

DEMO_WORDS: dict[str, list[str]] = {
    "1.1": ["hallo", "goedemorgen", "dank je", "ja", "nee", "naam"],
    "1.2": ["doof", "horend", "gebarentaal", "leren", "begrijpen", "herhalen", "langzaam"],
    "2.1": ["maandag", "dinsdag", "vandaag", "morgen", "gisteren", "week", "huis"],
}

DEMO_USERS = [
    ("admin", "demo-admin", Role.admin),
    ("docent", "demo-docent", Role.teacher),
    ("student", "demo-student", Role.student),
]

_COLOURS = ["0x2f6f6a", "0x7a4a8c", "0x8c5a2b", "0x2b5a8c", "0x6b7a2b"]


def _synthetic_clip(gloss: str, index: int, out: Path) -> None:
    """A two-second clip with a moving pattern, standing in for a real recording."""
    colour = _COLOURS[index % len(_COLOURS)]
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", f"color=c={colour}:s=640x480:d=2:r=30",
            "-f", "lavfi", "-i", "testsrc2=s=160x160:d=2:r=30",
            "-filter_complex", "[0][1]overlay=x='(W-w)/2+120*sin(2*PI*t/2)':y=(H-h)/2",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", str(out),
        ],
        check=True,
    )  # fmt: skip
    _ = gloss


def seed_demo(db: Session, clips_dir: Path | None = None) -> dict[str, int]:
    counts = {"words": 0, "clips": 0, "users": 0}
    group = db.scalars(select(Group).where(Group.invite_code == "demo")).first()
    if group is None:
        group = Group(year=1, weekday="dinsdag", label="Jaar 1 · dinsdag", invite_code="demo")
        db.add(group)
        db.flush()

    for username, password, role in DEMO_USERS:
        if db.scalars(select(User).where(User.username == username)).first():
            continue
        user = User(
            username=username,
            password_hash=hash_secret(password),
            recovery_hash=hash_secret(new_recovery_code()),
            role=role,
        )
        db.add(user)
        db.flush()
        if role != Role.admin:
            db.add(Membership(user_id=user.id, group_id=group.id))
        counts["users"] += 1

    tmp = media.media_path("tmp")
    tmp.mkdir(parents=True, exist_ok=True)
    index = 0
    for list_number, glosses in DEMO_WORDS.items():
        lesson = int(list_number.split(".")[0])
        for pos, gloss in enumerate(glosses, start=1):
            index += 1
            if db.scalars(select(Word).where(Word.gloss == gloss, Word.year == 1)).first():
                continue
            word = Word(
                gloss=gloss,
                year=1,
                lesson=lesson,
                list_number=list_number,
                position=pos,
                status=WordStatus.published,
            )
            db.add(word)
            db.flush()
            word_service.log(db, word, None, "create", word_service.snapshot(word))
            counts["words"] += 1

            src = clips_dir / f"{gloss}.mp4" if clips_dir else None
            if src is None or not src.is_file():
                src = tmp / f"demo-{index}.mp4"
                _synthetic_clip(gloss, index, src)
            files = media.make_clip(src)
            clip = Clip(
                file=files.file, thumb=files.thumb, duration=files.duration, source=ClipSource.demo
            )
            word_service.attach_clip(db, word, clip, "extra", None)
            counts["clips"] += 1
            if src.parent == tmp:
                src.unlink(missing_ok=True)
    db.commit()
    return counts
