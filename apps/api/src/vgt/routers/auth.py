from fastapi import APIRouter, HTTPException, Request, Response, status
from sqlalchemy import select

from vgt.config import get_settings
from vgt.deps import DB
from vgt.models import AuthSession, Group, Role, User
from vgt.schemas import (
    GroupBrief,
    InviteOut,
    LoginIn,
    LoginOut,
    OrgBrief,
    RecoverIn,
    RecoveryCodeOut,
    RegisterIn,
    RegisterOut,
)
from vgt.security import (
    hash_secret,
    hash_token,
    needs_rehash,
    new_recovery_code,
    normalize_recovery_code,
    verify_secret,
)
from vgt.services.auth import clear_cookie, end_all_sessions, start_session
from vgt.services.members import find_user, join_group

router = APIRouter(prefix="/auth", tags=["auth"])

# Verified against when the user does not exist, so both cases take the same time.
_DUMMY_HASH = hash_secret("not-a-real-password")


def active_group(db: DB, code: str) -> Group:
    """The group an invite code belongs to, if both the group and its school are active."""
    group = db.scalars(select(Group).where(Group.invite_code == code.strip())).first()
    if group is None or not group.active or not group.org.active:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invite link is not valid")
    return group


@router.post("/login", response_model=LoginOut)
def login(body: LoginIn, response: Response, db: DB) -> LoginOut:
    user = find_user(db, body.username)
    if not verify_secret(user.password_hash if user else _DUMMY_HASH, body.password) or not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Wrong username or password")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_secret(body.password)
    return start_session(db, user, body.client, response)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: DB) -> None:
    token = request.cookies.get(get_settings().cookie_name)
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if token:
        sess = db.get(AuthSession, hash_token(token))
        if sess:
            db.delete(sess)
            db.commit()
    clear_cookie(response)


@router.get("/invites/{code}", response_model=InviteOut)
def invite(code: str, db: DB) -> InviteOut:
    group = active_group(db, code)
    return InviteOut(group=GroupBrief.model_validate(group), org=OrgBrief.model_validate(group.org))


@router.post("/register", response_model=RegisterOut, status_code=201)
def register(body: RegisterIn, response: Response, db: DB) -> RegisterOut:
    group = active_group(db, body.invite_code)
    if find_user(db, body.username):
        raise HTTPException(status.HTTP_409_CONFLICT, "Username is taken")
    code = new_recovery_code()
    user = User(
        username=body.username,
        password_hash=hash_secret(body.password),
        recovery_hash=hash_secret(code),
    )
    db.add(user)
    db.flush()
    join_group(db, user, group, Role.student)
    db.commit()
    db.refresh(user)
    out = start_session(db, user, body.client, response)
    return RegisterOut(user=out.user, token=out.token, recovery_code=code)


@router.post("/recover", response_model=RecoveryCodeOut)
def recover(body: RecoverIn, db: DB) -> RecoveryCodeOut:
    """Set a new password with the one-time recovery code. Returns a fresh recovery code."""
    user = find_user(db, body.username)
    code = normalize_recovery_code(body.recovery_code)
    if not verify_secret(user.recovery_hash if user else _DUMMY_HASH, code) or not user:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Username or recovery code is wrong")
    new_code = new_recovery_code()
    user.password_hash = hash_secret(body.new_password)
    user.recovery_hash = hash_secret(new_code)
    end_all_sessions(db, user)
    db.commit()
    return RecoveryCodeOut(recovery_code=new_code)
