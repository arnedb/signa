from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from vgt.config import get_settings
from vgt.db import get_db, utcnow
from vgt.models import AuthSession, Group, Organisation, Role, User
from vgt.security import hash_token
from vgt.services.context import Context, resolve

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


def superadmin(user: Annotated[User, Depends(current_user)]) -> User:
    if not user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Superadmins only")
    return user


@dataclass
class OrgContext:
    """The user, working in an organisation: what a request inside a school needs."""

    user: User
    org: Organisation
    role: Role
    group: Group | None


def context(user: Annotated[User, Depends(current_user)], db: DB) -> Context:
    return resolve(db, user)


def member(ctx: Annotated[Context, Depends(context)]) -> OrgContext:
    if ctx.org is None or ctx.role is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not a member of a school")
    return OrgContext(user=ctx.user, org=ctx.org, role=ctx.role, group=ctx.group)


def teacher(ctx: Annotated[OrgContext, Depends(member)]) -> OrgContext:
    if ctx.role not in (Role.teacher, Role.admin):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Teachers only")
    return ctx


def admin(ctx: Annotated[OrgContext, Depends(member)]) -> OrgContext:
    if ctx.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admins only")
    return ctx


def org_group(db: Session, ctx: OrgContext, group_id: int) -> Group:
    """A group of the current organisation, or 404."""
    group = db.get(Group, group_id)
    if group is None or group.org_id != ctx.org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return group


CurrentUser = Annotated[User, Depends(current_user)]
CurrentContext = Annotated[Context, Depends(context)]
Member = Annotated[OrgContext, Depends(member)]
Teacher = Annotated[OrgContext, Depends(teacher)]
Admin = Annotated[OrgContext, Depends(admin)]
Superadmin = Annotated[User, Depends(superadmin)]
