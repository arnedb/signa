from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from vgt.db import utcnow
from vgt.deps import DB, CurrentUser, Member
from vgt.models import Direction, GroupEvent, OrgMember, Result, User, Word, WordStatus
from vgt.routers.auth import active_group
from vgt.schemas import (
    ContextIn,
    DifficultWordOut,
    JoinIn,
    LocaleIn,
    Me,
    PasswordChangeIn,
    PasswordConfirmIn,
    RecoveryCodeOut,
    ResultsIn,
    ResultsOut,
)
from vgt.security import hash_secret, new_recovery_code, verify_secret
from vgt.services.auth import clear_cookie, end_all_sessions
from vgt.services.context import me_out, select_context
from vgt.services.members import join_group, sole_admin_of
from vgt.services.words import word_out

router = APIRouter(prefix="/me", tags=["me"])


def _check_password(user: User, password: str) -> None:
    if not verify_secret(user.password_hash, password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password is wrong")


@router.get("", response_model=Me)
def me(user: CurrentUser, db: DB) -> Me:
    return me_out(db, user)


@router.put("/locale", response_model=Me)
def set_locale(body: LocaleIn, user: CurrentUser, db: DB) -> Me:
    """Choose the interface language. ``null`` follows the language of the current school."""
    user.locale = body.locale
    db.commit()
    return me_out(db, user)


@router.put("/context", response_model=Me)
def set_context(body: ContextIn, user: CurrentUser, db: DB) -> Me:
    """Choose the school (and group) to work in. Words, practice and /admin follow it."""
    try:
        select_context(db, user, body.org_id, body.group_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(exc)) from exc
    return me_out(db, user)


@router.post("/join", response_model=Me)
def join(body: JoinIn, user: CurrentUser, db: DB) -> Me:
    """Join another group with an invite link, keeping the same account."""
    group = active_group(db, body.invite_code)
    join_group(db, user, group)
    db.commit()
    return me_out(db, user)


@router.post("/password", status_code=204)
def change_password(body: PasswordChangeIn, request: Request, user: CurrentUser, db: DB) -> None:
    _check_password(user, body.current_password)
    user.password_hash = hash_secret(body.new_password)
    end_all_sessions(db, user, keep=getattr(request.state, "session_token_hash", None))
    db.commit()


@router.post("/recovery-code", response_model=RecoveryCodeOut)
def new_code(body: PasswordConfirmIn, user: CurrentUser, db: DB) -> RecoveryCodeOut:
    _check_password(user, body.password)
    code = new_recovery_code()
    user.recovery_hash = hash_secret(code)
    db.commit()
    return RecoveryCodeOut(recovery_code=code)


@router.get("/export")
def export(user: CurrentUser, db: DB) -> dict[str, Any]:
    """Everything stored about the user, as JSON."""
    results = db.execute(
        select(Result, Word.gloss)
        .join(Word, Word.id == Result.word_id)
        .where(Result.user_id == user.id)
        .order_by(Result.at)
    ).all()
    moves = db.scalars(select(GroupEvent).where(GroupEvent.user_id == user.id)).all()
    return {
        "exported_at": utcnow().isoformat(),
        "user": {
            "username": user.username,
            "locale": user.locale,
            "created_at": user.created_at.isoformat(),
            "last_active_at": user.last_active_at.isoformat() if user.last_active_at else None,
            "organisations": [
                {"name": m.org.name, "role": m.role.value} for m in user.org_memberships
            ],
            "groups": [{"organisation": g.org.name, "group": g.label} for g in user.groups],
        },
        "group_moves": [
            {"from_group_id": m.from_group_id, "to_group_id": m.to_group_id, "at": m.at.isoformat()}
            for m in moves
        ],
        "results": [
            {
                "word_id": r.word_id,
                "word": gloss,
                "direction": r.direction.value,
                "correct": r.correct,
                "at": r.at.isoformat(),
            }
            for r, gloss in results
        ],
    }


@router.post("/delete", status_code=204)
def delete_account(body: PasswordConfirmIn, response: Response, user: CurrentUser, db: DB) -> None:
    _check_password(user, body.password)
    if sole_admin_of(db, user):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The last admin cannot be deleted")
    if user.is_superadmin:
        others = db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.is_superadmin.is_(True), User.id != user.id)
        )
        if not others:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "The last admin cannot be deleted")
    db.delete(user)
    db.commit()
    clear_cookie(response)


@router.post("/results", response_model=ResultsOut)
def save_results(body: ResultsIn, user: CurrentUser, db: DB) -> ResultsOut:
    """Save answers. Words outside the user's schools are ignored."""
    ids = {r.word_id for r in body.results}
    orgs = select(OrgMember.org_id).where(OrgMember.user_id == user.id)
    stmt = select(Word.id).where(Word.id.in_(ids))
    if not user.is_superadmin:
        stmt = stmt.where(Word.org_id.in_(orgs))
    known = set(db.scalars(stmt))
    now = utcnow()
    saved = 0
    for r in body.results:
        if r.word_id not in known:
            continue
        at = now
        if isinstance(r.at, datetime):
            at = r.at.astimezone(UTC).replace(tzinfo=None) if r.at.tzinfo else r.at
        db.add(
            Result(
                user_id=user.id,
                word_id=r.word_id,
                direction=r.direction,
                correct=r.correct,
                at=min(at, now),
            )
        )
        saved += 1
    db.commit()
    return ResultsOut(saved=saved)


@router.get("/difficult-words", response_model=list[DifficultWordOut])
def difficult_words(ctx: Member, db: DB) -> list[DifficultWordOut]:
    """Published words of the current school whose most recent answer was wrong.

    Each direction counts on its own: a word is difficult in a direction when the latest
    answer in that direction was wrong. `directions` lists those directions.
    """
    latest = (
        select(Result.word_id, Result.direction, func.max(Result.id).label("last_id"))
        .where(Result.user_id == ctx.user.id)
        .group_by(Result.word_id, Result.direction)
        .subquery()
    )
    rows = db.execute(
        select(Word, Result.direction)
        .join(latest, latest.c.word_id == Word.id)
        .join(Result, Result.id == latest.c.last_id)
        .where(
            Result.correct.is_(False),
            Word.status == WordStatus.published,
            Word.org_id == ctx.org.id,
        )
        .options(selectinload(Word.clips))
        .order_by(Word.year, Word.lesson, Word.list_number, Word.position, Word.id)
    ).all()
    directions: dict[int, list[Direction]] = {}
    words: dict[int, Word] = {}
    for word, direction in rows:
        words.setdefault(word.id, word)
        directions.setdefault(word.id, []).append(direction)
    order = list(Direction)
    return [
        DifficultWordOut(
            **word_out(w).model_dump(),
            directions=sorted(directions[w.id], key=order.index),
        )
        for w in words.values()
    ]
