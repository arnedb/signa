from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from vgt.config import get_settings
from vgt.db import get_db, utcnow
from vgt.models import AuthSession, Role, User
from vgt.security import hash_token

DB = Annotated[Session, Depends(get_db)]

CSRF_HEADER = "x-vgt-client"
_SAFE = {"GET", "HEAD", "OPTIONS"}


def _token_from_request(request: Request) -> tuple[str | None, bool]:
    """Return (token, from_cookie)."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip(), False
    return request.cookies.get(get_settings().cookie_name), True


def optional_user(request: Request, db: DB) -> User | None:
    token, from_cookie = _token_from_request(request)
    if not token:
        return None
    sess = db.get(AuthSession, hash_token(token))
    now = utcnow()
    if sess is None or sess.expires_at < now:
        return None
    # Cookies are sent by the browser automatically, so a state-changing request must also
    # carry a custom header. Other sites cannot set it without a CORS preflight.
    if from_cookie and request.method not in _SAFE and CSRF_HEADER not in request.headers:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing X-VGT-Client header")
    user = sess.user
    if user.last_active_at is None or now - user.last_active_at > timedelta(minutes=5):
        user.last_active_at = now
        db.commit()
    request.state.session_token_hash = sess.token_hash
    return user


def current_user(user: Annotated[User | None, Depends(optional_user)]) -> User:
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not logged in")
    return user


def teacher(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role not in (Role.teacher, Role.admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Teachers only")
    return user


def admin(user: Annotated[User, Depends(current_user)]) -> User:
    if user.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins only")
    return user


CurrentUser = Annotated[User, Depends(current_user)]
Teacher = Annotated[User, Depends(teacher)]
Admin = Annotated[User, Depends(admin)]
