from typing import cast

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import aliased

from vgt.deps import DB, Teacher, org_group
from vgt.i18n import Weekday, group_label
from vgt.models import Group, GroupEvent, Membership, OrgMember, Role, User
from vgt.schemas import (
    GroupCreate,
    GroupEventOut,
    GroupOut,
    GroupUpdate,
    MemberOut,
    MoveGroupIn,
    MoveOut,
    MoveStudentsIn,
    TempPasswordOut,
)
from vgt.security import hash_secret, new_invite_code, new_temp_password
from vgt.services.auth import end_all_sessions
from vgt.services.members import ensure_org_member

router = APIRouter(prefix="/admin", tags=["admin: groups"])


def _roles(db: DB, org_id: int) -> dict[int, Role]:
    rows = db.execute(select(OrgMember.user_id, OrgMember.role).where(OrgMember.org_id == org_id))
    return {user_id: role for user_id, role in rows}


def _out(group: Group, ctx: Teacher, roles: dict[int, Role]) -> GroupOut:
    member_roles = [roles.get(m.user_id, Role.student) for m in group.memberships]
    return GroupOut(
        id=group.id,
        org_id=group.org_id,
        year=group.year,
        weekday=cast(Weekday, group.weekday),
        label=group.label,
        active=group.active,
        invite_code=group.invite_code,
        student_count=sum(r == Role.student for r in member_roles),
        teacher_count=sum(r != Role.student for r in member_roles),
        teaching=any(m.user_id == ctx.user.id for m in group.memberships),
    )


def _one(db: DB, group: Group, ctx: Teacher) -> GroupOut:
    db.refresh(group)
    return _out(group, ctx, _roles(db, ctx.org.id))


@router.get("/groups", response_model=list[GroupOut])
def list_groups(ctx: Teacher, db: DB) -> list[GroupOut]:
    groups = db.scalars(
        select(Group)
        .where(Group.org_id == ctx.org.id)
        .order_by(Group.active.desc(), Group.year, Group.id)
    )
    roles = _roles(db, ctx.org.id)
    return [_out(g, ctx, roles) for g in groups]


@router.post("/groups", response_model=GroupOut, status_code=201)
def create_group(body: GroupCreate, ctx: Teacher, db: DB) -> GroupOut:
    group = Group(
        org_id=ctx.org.id,
        year=body.year,
        weekday=body.weekday,
        label=(body.label or "").strip()
        or group_label(body.year, body.weekday, ctx.org.language.locale),
        invite_code=new_invite_code(),
    )
    db.add(group)
    db.flush()
    db.add(Membership(user_id=ctx.user.id, group_id=group.id))
    db.commit()
    return _one(db, group, ctx)


@router.patch("/groups/{group_id}", response_model=GroupOut)
def update_group(group_id: int, body: GroupUpdate, ctx: Teacher, db: DB) -> GroupOut:
    group = org_group(db, ctx, group_id)
    changes = body.model_dump(exclude_unset=True)
    locale = ctx.org.language.locale
    default = group_label(group.year, group.weekday, locale)
    relabel = group.label == default and "label" not in changes
    for field, value in changes.items():
        setattr(group, field, value)
    if relabel or not group.label.strip():
        group.label = group_label(group.year, group.weekday, locale)
    db.commit()
    return _one(db, group, ctx)


@router.post("/groups/{group_id}/invite", response_model=GroupOut)
def rotate_invite(group_id: int, ctx: Teacher, db: DB) -> GroupOut:
    """Make a new invite link. The old link stops working."""
    group = org_group(db, ctx, group_id)
    group.invite_code = new_invite_code()
    db.commit()
    return _one(db, group, ctx)


@router.put("/groups/{group_id}/teaching", response_model=GroupOut)
def start_teaching(group_id: int, ctx: Teacher, db: DB) -> GroupOut:
    group = org_group(db, ctx, group_id)
    if db.get(Membership, (ctx.user.id, group.id)) is None:
        # A superadmin may not be a member of the school yet.
        ensure_org_member(db, ctx.user, ctx.org.id, Role.admin)
        db.add(Membership(user_id=ctx.user.id, group_id=group.id))
        db.commit()
    return _one(db, group, ctx)


@router.delete("/groups/{group_id}/teaching", response_model=GroupOut)
def stop_teaching(group_id: int, ctx: Teacher, db: DB) -> GroupOut:
    group = org_group(db, ctx, group_id)
    membership = db.get(Membership, (ctx.user.id, group.id))
    if membership:
        db.delete(membership)
        db.commit()
    return _one(db, group, ctx)


@router.get("/groups/{group_id}/members", response_model=list[MemberOut])
def members(group_id: int, ctx: Teacher, db: DB) -> list[MemberOut]:
    group = org_group(db, ctx, group_id)
    roles = _roles(db, ctx.org.id)
    out = [
        MemberOut(
            id=m.user.id,
            username=m.user.username,
            role=roles.get(m.user_id, Role.student),
            created_at=m.user.created_at,
            last_active_at=m.user.last_active_at,
        )
        for m in group.memberships
    ]
    return sorted(out, key=lambda u: (u.role != Role.student, u.username.lower()))


def _move(db: DB, ctx: Teacher, student: User, src: Group, to: Group) -> bool:
    """Move a student from one group to another. Their other groups are kept."""
    old = db.get(Membership, (student.id, src.id))
    if old is None or src.id == to.id:
        return False
    db.delete(old)
    if db.get(Membership, (student.id, to.id)) is None:
        db.add(Membership(user_id=student.id, group_id=to.id))
    if student.current_group_id == src.id:
        student.current_group_id = to.id
    db.add(
        GroupEvent(
            org_id=ctx.org.id,
            user_id=student.id,
            from_group_id=src.id,
            to_group_id=to.id,
            by_user_id=ctx.user.id,
        )
    )
    db.flush()
    return True


def _students(db: DB, ctx: Teacher, user_ids: list[int]) -> list[User]:
    """Users that are students in the current school."""
    return list(
        db.scalars(
            select(User)
            .join(OrgMember, OrgMember.user_id == User.id)
            .where(
                User.id.in_(user_ids),
                OrgMember.org_id == ctx.org.id,
                OrgMember.role == Role.student,
            )
        )
    )


@router.post("/groups/move-students", response_model=MoveOut)
def move_students(body: MoveStudentsIn, ctx: Teacher, db: DB) -> MoveOut:
    src = org_group(db, ctx, body.from_group_id)
    to = org_group(db, ctx, body.to_group_id)
    students = _students(db, ctx, body.user_ids)
    if len(students) != len(set(body.user_ids)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only students can be moved")
    moved = sum(_move(db, ctx, s, src, to) for s in students)
    db.commit()
    return MoveOut(moved=moved)


@router.post("/groups/{group_id}/move-all", response_model=MoveOut)
def move_group(group_id: int, body: MoveGroupIn, ctx: Teacher, db: DB) -> MoveOut:
    """Move every student of a group, e.g. 'Jaar 1 · dinsdag' → 'Jaar 2 · dinsdag'."""
    src = org_group(db, ctx, group_id)
    to = org_group(db, ctx, body.to_group_id)
    if src.id == to.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose another group")
    students = _students(db, ctx, [m.user_id for m in src.memberships])
    moved = sum(_move(db, ctx, s, src, to) for s in students)
    db.commit()
    return MoveOut(moved=moved)


@router.get("/group-events", response_model=list[GroupEventOut])
def group_events(ctx: Teacher, db: DB, limit: int = 200) -> list[GroupEventOut]:
    student, by = aliased(User), aliased(User)
    src, dst = aliased(Group), aliased(Group)
    rows = db.execute(
        select(GroupEvent, student.username, src.label, dst.label, by.username)
        .outerjoin(student, student.id == GroupEvent.user_id)
        .outerjoin(src, src.id == GroupEvent.from_group_id)
        .outerjoin(dst, dst.id == GroupEvent.to_group_id)
        .outerjoin(by, by.id == GroupEvent.by_user_id)
        .where(GroupEvent.org_id == ctx.org.id)
        .order_by(GroupEvent.id.desc())
        .limit(min(limit, 1000))
    ).all()
    return [
        GroupEventOut(id=e.id, at=e.at, username=u, from_group=f, to_group=t, by_username=b)
        for e, u, f, t, b in rows
    ]


@router.post("/users/{user_id}/reset-password", response_model=TempPasswordOut)
def reset_password(user_id: int, ctx: Teacher, db: DB) -> TempPasswordOut:
    """Give a member of the school a temporary password.

    Teachers can reset students; admins anyone in the school except a superadmin.
    """
    target = db.get(User, user_id)
    role = target.role_in(ctx.org.id) if target else None
    if target is None or role is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if target.is_superadmin and not ctx.user.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only a superadmin can reset this user")
    if role != Role.student and ctx.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin can reset this user")
    # One account can be staff in another school; that school decides about its staff.
    staff_elsewhere = any(
        m.role != Role.student for m in target.org_memberships if m.org_id != ctx.org.id
    )
    if staff_elsewhere and not ctx.user.is_superadmin:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "This user is also a teacher in another school"
        )
    temp = new_temp_password()
    target.password_hash = hash_secret(temp)
    end_all_sessions(db, target)
    db.commit()
    return TempPasswordOut(username=target.username, temporary_password=temp)
