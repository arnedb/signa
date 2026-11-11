"""Fill a database with demo data: two schools, about 20 words, demo users and groups.

The demo student is in both schools, so the school and group switcher can be tried out.

Clips come from a folder of MP4s named after the gloss (``huis.mp4``), as in the demo release
asset. Without a folder, simple generated test clips are used, which is enough for development.
"""

import subprocess
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from vgt import media
from vgt.i18n import group_label
from vgt.languages import ensure_languages
from vgt.models import (
    Clip,
    ClipSource,
    Group,
    Membership,
    Organisation,
    Role,
    User,
    Word,
    WordStatus,
)
from vgt.security import hash_secret, new_recovery_code
from vgt.services import words as word_service
from vgt.services.members import ensure_org_member

DEMO_WORDS: dict[str, list[str]] = {
    "1.1": ["hallo", "goedemorgen", "dank je", "ja", "nee", "naam"],
    "1.2": ["doof", "horend", "gebarentaal", "leren", "begrijpen", "herhalen", "langzaam"],
    "2.1": ["maandag", "dinsdag", "vandaag", "morgen", "gisteren", "week", "huis"],
}

# The second school has its own, smaller word list.
SECOND_WORDS: dict[str, list[str]] = {"1.1": ["hallo", "welkom", "school", "les"]}

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


def _org(db: Session, slug: str, name: str) -> Organisation:
    org = db.scalars(select(Organisation).where(Organisation.slug == slug)).first()
    if org is None:
        org = Organisation(name=name, slug=slug, language_code="vgt")
        db.add(org)
        db.flush()
    return org


def _group(db: Session, org: Organisation, code: str, year: int, weekday: str) -> Group:
    group = db.scalars(select(Group).where(Group.invite_code == code)).first()
    if group is None:
        label = group_label(year, weekday, org.language.locale)
        group = Group(org_id=org.id, year=year, weekday=weekday, label=label, invite_code=code)
        db.add(group)
        db.flush()
    return group


def _words(
    db: Session,
    org: Organisation,
    words: dict[str, list[str]],
    clips_dir: Path | None,
    counts: dict[str, int],
    start: int,
) -> None:
    tmp = media.media_path("tmp")
    tmp.mkdir(parents=True, exist_ok=True)
    index = start
    for list_number, glosses in words.items():
        lesson = int(list_number.split(".")[0])
        for pos, gloss in enumerate(glosses, start=1):
            index += 1
            existing = select(Word).where(Word.org_id == org.id, Word.gloss == gloss)
            if db.scalars(existing).first():
                continue
            word = Word(
                org_id=org.id,
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


def seed_demo(db: Session, clips_dir: Path | None = None) -> dict[str, int]:
    counts = {"words": 0, "clips": 0, "users": 0}
    ensure_languages(db)
    org = _org(db, "demo", "Demoschool")
    second = _org(db, "demo-2", "Tweede school")
    group = _group(db, org, "demo", 1, "tue")
    second_group = _group(db, second, "demo-2", 1, "sat")

    for username, password, role in DEMO_USERS:
        user = db.scalars(select(User).where(User.username == username)).first()
        if user is None:
            user = User(
                username=username,
                password_hash=hash_secret(password),
                recovery_hash=hash_secret(new_recovery_code()),
                is_superadmin=role == Role.admin,
            )
            db.add(user)
            db.flush()
            counts["users"] += 1
        ensure_org_member(db, user, org.id, role)
        if role != Role.admin and db.get(Membership, (user.id, group.id)) is None:
            db.add(Membership(user_id=user.id, group_id=group.id))
        if role == Role.student:
            ensure_org_member(db, user, second.id, role)
            if db.get(Membership, (user.id, second_group.id)) is None:
                db.add(Membership(user_id=user.id, group_id=second_group.id))
    db.flush()

    _words(db, org, DEMO_WORDS, clips_dir, counts, 0)
    _words(db, second, SECOND_WORDS, clips_dir, counts, 100)
    db.commit()
    return counts
