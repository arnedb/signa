"""Members of the current school: list, add, change role, remove. Admins only."""

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from vgt.deps import DB, Admin
from vgt.models import OrgMember, Role, User
from vgt.schemas import GroupBrief, MemberAddOut, RoleIn, UserCreate, UserOut
from vgt.services.members import add_member, admin_count, remove_from_org

router = APIRouter(prefix="/admin/users", tags=["admin: users"])


def _user_out(user: User, role: Role, org_id: int) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        role=role,
        created_at=user.created_at,
        last_active_at=user.last_active_at,
        groups=[GroupBrief.model_validate(g) for g in user.groups if g.org_id == org_id],
    )


def _member(db: DB, ctx: Admin, user_id: int) -> OrgMember:
    member = db.get(OrgMember, (user_id, ctx.org.id))
    if member is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return member


@router.get("", response_model=list[UserOut])
def list_users(ctx: Admin, db: DB, role: Role | None = None, q: str | None = None) -> list[UserOut]:
    stmt = (
        select(User, OrgMember.role)
        .join(OrgMember, OrgMember.user_id == User.id)
        .where(OrgMember.org_id == ctx.org.id)
        .order_by(OrgMember.role, func.lower(User.username))
    )
    if role:
        stmt = stmt.where(OrgMember.role == role)
    if q:
        stmt = stmt.where(func.lower(User.username).like(f"%{q.lower()}%"))
    return [_user_out(u, r, ctx.org.id) for u, r in db.execute(stmt.limit(500))]


@router.post("", response_model=MemberAddOut, status_code=201)
def create_user(body: UserCreate, ctx: Admin, db: DB) -> MemberAddOut:
    """Add someone to the school: an existing account, or a new one with a temporary password."""
    out = add_member(db, ctx.org.id, body.username, body.role)
    db.commit()
    return out


@router.put("/{user_id}/role", response_model=UserOut)
def set_role(user_id: int, body: RoleIn, ctx: Admin, db: DB) -> UserOut:
    member = _member(db, ctx, user_id)
    if member.role == Role.admin and body.role != Role.admin:
        if user_id == ctx.user.id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "You cannot remove your own admin role"
            )
        if admin_count(db, ctx.org.id) <= 1:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "A school needs at least one admin")
    member.role = body.role
    db.commit()
    return _user_out(member.user, member.role, ctx.org.id)


@router.delete("/{user_id}", status_code=204)
def remove_user(user_id: int, ctx: Admin, db: DB) -> None:
    """Remove someone from the school and its groups. The account itself stays."""
    member = _member(db, ctx, user_id)
    if member.role == Role.admin and admin_count(db, ctx.org.id) <= 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A school needs at least one admin")
    remove_from_org(db, member.user, ctx.org.id)
    db.commit()
