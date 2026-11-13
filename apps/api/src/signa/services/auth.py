from datetime import timedelta

from fastapi import Response
from sqlalchemy import delete
from sqlalchemy.orm import Session

from signa.config import get_settings
from signa.db import utcnow
from signa.models import AuthSession, ClientKind, User
from signa.schemas import LoginOut
from signa.security import hash_token, new_token
from signa.services.context import me_out


def start_session(db: Session, user: User, client: ClientKind, response: Response) -> LoginOut:
    settings = get_settings()
    token = new_token()
    db.add(
        AuthSession(
            token_hash=hash_token(token),
            user_id=user.id,
            client=client,
            expires_at=utcnow() + timedelta(days=settings.session_days),
        )
    )
    user.last_active_at = utcnow()
    db.commit()
    db.refresh(user)
    me = me_out(db, user)
    if client == ClientKind.mobile:
        return LoginOut(user=me, token=token)
    response.set_cookie(
        settings.cookie_name,
        token,
        max_age=settings.session_days * 86400,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )
    return LoginOut(user=me)


def end_all_sessions(db: Session, user: User, keep: str | None = None) -> None:
    stmt = delete(AuthSession).where(AuthSession.user_id == user.id)
    if keep:
        stmt = stmt.where(AuthSession.token_hash != keep)
    db.execute(stmt)


def clear_cookie(response: Response) -> None:
    response.delete_cookie(get_settings().cookie_name, path="/")
