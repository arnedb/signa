from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from vgt.deps import DB, Admin
from vgt.models import Role, User
from vgt.schemas import RoleIn, TempPasswordOut, UserCreate, UserOut
from vgt.security import hash_secret, new_temp_password

router = APIRouter(prefix="/admin/users", tags=["admin: users"])


@router.get("", response_model=list[UserOut])
def list_users(
    _user: Admin, db: DB, role: Role | None = None, q: str | None = None
) -> list[UserOut]:
    stmt = select(User).order_by(User.role, func.lower(User.username))
    if role:
        stmt = stmt.where(User.role == role)
    if q:
        stmt = stmt.where(func.lower(User.username).like(f"%{q.lower()}%"))
    return [UserOut.model_validate(u) for u in db.scalars(stmt.limit(500))]


@router.post("", response_model=TempPasswordOut, status_code=201)
def create_user(body: UserCreate, _user: Admin, db: DB) -> TempPasswordOut:
    """Create a teacher (or admin) account with a temporary password."""
    if db.scalars(select(User).where(func.lower(User.username) == body.username.lower())).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "Username is taken")
    temp = new_temp_password()
    db.add(User(username=body.username, password_hash=hash_secret(temp), role=body.role))
    db.commit()
    return TempPasswordOut(username=body.username, temporary_password=temp)


@router.put("/{user_id}/role", response_model=UserOut)
def set_role(user_id: int, body: RoleIn, actor: Admin, db: DB) -> UserOut:
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if target.id == actor.id and body.role != Role.admin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot remove your own admin role")
    if body.role == Role.student and len(target.memberships) > 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A student can be in one group only")
    target.role = body.role
    db.commit()
    return UserOut.model_validate(target)
