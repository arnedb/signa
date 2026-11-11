from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from vgt.db import utcnow
from vgt.deps import DB, CurrentUser
from vgt.models import GroupEvent, Result, Role, User, Word, WordStatus
from vgt.schemas import (
    Me,
    PasswordChangeIn,
    PasswordConfirmIn,
    RecoveryCodeOut,
    ResultsIn,
    ResultsOut,
    WordOut,
)
from vgt.security import hash_secret, new_recovery_code, verify_secret
from vgt.services.auth import clear_cookie, end_all_sessions
from vgt.services.words import word_out

router = APIRouter(prefix="/me", tags=["me"])


def _check_password(user: User, password: str) -> None:
    if not verify_secret(user.password_hash, password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password is wrong")


@router.get("", response_model=Me)
def me(user: CurrentUser) -> Me:
    return Me.model_validate(user)


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
            "role": user.role.value,
            "created_at": user.created_at.isoformat(),
            "last_active_at": user.last_active_at.isoformat() if user.last_active_at else None,
            "groups": [g.label for g in user.groups],
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
    if user.role == Role.admin:
        admins = db.scalar(select(func.count()).select_from(User).where(User.role == Role.admin))
        if (admins or 0) <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "The last admin cannot be deleted")
    db.delete(user)
    db.commit()
    clear_cookie(response)


@router.post("/results", response_model=ResultsOut)
def save_results(body: ResultsIn, user: CurrentUser, db: DB) -> ResultsOut:
    ids = {r.word_id for r in body.results}
    known = set(db.scalars(select(Word.id).where(Word.id.in_(ids))))
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


@router.get("/difficult-words", response_model=list[WordOut])
def difficult_words(user: CurrentUser, db: DB) -> list[WordOut]:
    """Published words whose most recent answer was wrong."""
    latest = (
        select(Result.word_id, func.max(Result.id).label("last_id"))
        .where(Result.user_id == user.id)
        .group_by(Result.word_id)
        .subquery()
    )
    words = db.scalars(
        select(Word)
        .join(latest, latest.c.word_id == Word.id)
        .join(Result, Result.id == latest.c.last_id)
        .where(Result.correct.is_(False), Word.status == WordStatus.published)
        .options(selectinload(Word.clips))
        .order_by(Word.year, Word.lesson, Word.list_number, Word.position, Word.id)
    ).all()
    return [word_out(w) for w in words]
