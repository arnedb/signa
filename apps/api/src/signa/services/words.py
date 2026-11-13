from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement, and_, exists, func, not_, or_, select
from sqlalchemy.orm import Session, aliased

from signa import media
from signa.models import Clip, Group, User, Word, WordEvent, WordStatus
from signa.schemas import AdminWordOut, ClipOut, WordOut

WORD_FIELDS = (
    "gloss",
    "year",
    "lesson",
    "list_number",
    "position",
    "notes",
    "status",
    "group_ids",
)


def visible_to(group_id: int | None) -> ColumnElement[bool]:
    """Which words a group practises: the shared words (no groups), and the words limited to
    this group. A published word for this group replaces a shared word with the same gloss
    on the same list, so the group gets its own video or its own version of the list.

    Without a group, only the shared words.
    """
    shared = not_(Word.groups.any())
    if group_id is None:
        return shared
    variant = aliased(Word)
    replaced = exists(
        select(variant.id).where(
            variant.id != Word.id,
            variant.org_id == Word.org_id,
            variant.year == Word.year,
            variant.list_number.is_not_distinct_from(Word.list_number),
            func.lower(variant.gloss) == func.lower(Word.gloss),
            variant.status == WordStatus.published,
            variant.groups.any(Group.id == group_id),
        )
    )
    return or_(Word.groups.any(Group.id == group_id), and_(shared, not_(replaced)))


def org_groups(db: Session, org_id: int, ids: list[int]) -> list[Group]:
    """The groups with these ids, all of this school, in id order; 400 for any other id."""
    wanted = set(ids)
    groups = list(
        db.scalars(
            select(Group).where(Group.org_id == org_id, Group.id.in_(wanted)).order_by(Group.id)
        )
    )
    if len(groups) != len(wanted):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown group")
    return groups


def clip_out(clip: Clip) -> ClipOut:
    v = int(clip.updated_at.timestamp())
    return ClipOut(
        id=clip.id,
        duration=clip.duration,
        source=clip.source,
        is_primary=clip.is_primary,
        archived=clip.archived,
        recorded_at=clip.recorded_at,
        updated_at=clip.updated_at,
        url=f"/api/v1/media/clips/{clip.id}?v={v}",
        thumb_url=f"/api/v1/media/thumbs/{clip.id}?v={v}" if clip.thumb else None,
    )


def _ordered_clips(word: Word, include_archived: bool) -> list[ClipOut]:
    clips = [c for c in word.clips if include_archived or not c.archived]
    clips.sort(key=lambda c: (c.archived, not c.is_primary, c.id))
    return [clip_out(c) for c in clips]


def word_out(word: Word) -> WordOut:
    return WordOut(
        id=word.id,
        gloss=word.gloss,
        year=word.year,
        lesson=word.lesson,
        list_number=word.list_number,
        position=word.position,
        notes=word.notes,
        group_ids=word.group_ids,
        clips=_ordered_clips(word, include_archived=False),
    )


def admin_word_out(word: Word) -> AdminWordOut:
    base = word_out(word).model_dump(exclude={"clips"})
    return AdminWordOut(
        **base,
        clips=_ordered_clips(word, include_archived=True),
        status=word.status,
        legacy_id=word.legacy_id,
        created_at=word.created_at,
        updated_at=word.updated_at,
    )


def _plain(value: Any) -> Any:
    return value.value if hasattr(value, "value") else value


def snapshot(word: Word) -> dict[str, Any]:
    return {f: _plain(getattr(word, f)) for f in WORD_FIELDS}


def log(db: Session, word: Word, user: User | None, action: str, diff: dict[str, Any]) -> WordEvent:
    event = WordEvent(
        word_id=word.id, user_id=user.id if user else None, action=action, diff_json=diff
    )
    db.add(event)
    return event


def apply_changes(db: Session, word: Word, changes: dict[str, Any], user: User | None) -> dict:
    """Set fields on a word and log a single ``update`` event with ``{field: [old, new]}``.

    ``group_ids`` must be groups of the word's school (see ``org_groups``).
    """
    diff: dict[str, list[Any]] = {}
    for field, new in changes.items():
        if field not in WORD_FIELDS or (field == "group_ids" and new is None):
            continue
        old = _plain(getattr(word, field))
        new = sorted(set(new)) if field == "group_ids" else _plain(new)
        if old != new:
            diff[field] = [old, new]
            if field == "group_ids":
                word.groups = org_groups(db, word.org_id, new)
            else:
                setattr(word, field, new)
    if diff:
        word.updated_by = user.id if user else None
        log(db, word, user, "update", diff)
    return diff


def delete_words(db: Session, words: list[Word]) -> None:
    """Delete words for good: their clips, history and practice results go with them (the
    database cascades), and their video files are removed after the commit."""
    files = [f for w in words for c in w.clips for f in (c.file, c.thumb) if f]
    for word in words:
        db.delete(word)
    db.commit()
    for rel in files:
        media.media_path(rel).unlink(missing_ok=True)


def set_primary(word: Word, clip: Clip) -> None:
    for c in word.clips:
        c.is_primary = c.id == clip.id


def _current_primary(word: Word) -> Clip | None:
    return next((c for c in word.clips if c.is_primary and not c.archived), None)


def _ensure_primary(word: Word) -> None:
    if _current_primary(word) is None:
        live = [c for c in word.clips if not c.archived]
        if live:
            set_primary(word, live[-1])


def attach_clip(db: Session, word: Word, clip: Clip, mode: str, user: User | None) -> None:
    """Add a new clip. ``replace`` archives the current primary clip; ``extra`` keeps it."""
    clip.word = word
    db.add(clip)
    db.flush()
    old = _current_primary(word)
    if mode == "replace" or old is None:
        if old is not None and mode == "replace":
            old.archived = True
        set_primary(word, clip)
        if old is not None and mode == "replace":
            log(db, word, user, "clip_replace", {"clip": clip.id, "old_clip": old.id})
            return
    log(db, word, user, "clip_add", {"clip": clip.id})


def trim_clip(
    db: Session, word: Word, clip: Clip, old: Clip, user: User | None, start: float, end: float
) -> None:
    """``clip`` is a shortened copy of ``old``: it takes its place, and ``old`` is archived."""
    clip.word = word
    db.add(clip)
    db.flush()
    was_primary = old.is_primary and not old.archived
    old.archived = True
    old.is_primary = False
    if was_primary:
        set_primary(word, clip)
    _ensure_primary(word)
    log(
        db,
        word,
        user,
        "clip_trim",
        {
            "clip": clip.id,
            "old_clip": old.id,
            "was_primary": was_primary,
            "start": round(start, 3),
            "end": round(end, 3),
        },
    )


def archive_clip(db: Session, word: Word, clip: Clip, user: User | None) -> None:
    was_primary = clip.is_primary
    clip.archived = True
    clip.is_primary = False
    _ensure_primary(word)
    log(db, word, user, "clip_archive", {"clip": clip.id, "was_primary": was_primary})


def restore_clip(db: Session, word: Word, clip: Clip, user: User | None) -> None:
    clip.archived = False
    _ensure_primary(word)
    log(db, word, user, "clip_restore", {"clip": clip.id})


def make_primary(db: Session, word: Word, clip: Clip, user: User | None) -> None:
    old = _current_primary(word)
    clip.archived = False
    set_primary(word, clip)
    log(db, word, user, "clip_primary", {"clip": clip.id, "old_clip": old.id if old else None})


def _clip(word: Word, clip_id: int | None) -> Clip | None:
    return next((c for c in word.clips if c.id == clip_id), None)


def undo(db: Session, event: WordEvent, user: User | None) -> WordEvent:
    if event.undone:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already undone")
    word = db.get(Word, event.word_id)
    assert word is not None
    diff = event.diff_json
    match event.action:
        case "update":
            for field, (_old, new) in diff.items():
                if _plain(getattr(word, field)) != new:
                    raise HTTPException(
                        status.HTTP_409_CONFLICT,
                        f"'{field}' was changed again later; undo the later change first",
                    )
            apply_changes(db, word, {f: old for f, (old, _new) in diff.items()}, user)
        case "clip_add":
            clip = _clip(word, diff["clip"])
            if clip and not clip.archived:
                archive_clip(db, word, clip, user)
        case "clip_replace":
            new, old = _clip(word, diff["clip"]), _clip(word, diff["old_clip"])
            if new:
                new.archived = True
                new.is_primary = False
            if old:
                old.archived = False
                set_primary(word, old)
            _ensure_primary(word)
            log(
                db, word, user, "clip_replace", {"clip": diff["old_clip"], "old_clip": diff["clip"]}
            )
        case "clip_trim":
            new, old = _clip(word, diff["clip"]), _clip(word, diff["old_clip"])
            if new:
                new.archived = True
                new.is_primary = False
            if old:
                old.archived = False
                if diff.get("was_primary"):
                    set_primary(word, old)
            _ensure_primary(word)
        case "clip_archive":
            clip = _clip(word, diff["clip"])
            if clip:
                restore_clip(db, word, clip, user)
                if diff.get("was_primary"):
                    set_primary(word, clip)
        case "clip_restore":
            clip = _clip(word, diff["clip"])
            if clip and not clip.archived:
                archive_clip(db, word, clip, user)
        case "clip_primary":
            old = _clip(word, diff.get("old_clip"))
            if old:
                make_primary(db, word, old, user)
        case _:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"'{event.action}' cannot be undone")
    event.undone = True
    marker = log(db, word, user, "undo", {"event": event.id, "action": event.action})
    return marker
