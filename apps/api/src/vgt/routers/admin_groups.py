from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import aliased

from vgt.deps import DB, Teacher
from vgt.models import Group, GroupEvent, Membership, Role, User
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

router = APIRouter(prefix="/admin", tags=["admin: groups"])


def default_label(year: int, weekday: str) -> str:
    return f"Jaar {year} · {weekday}"


def _group(db: DB, group_id: int) -> Group:
    group = db.get(Group, group_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Group not found")
    return group


def _out(group: Group, user: User) -> GroupOut:
    roles = [m.user.role for m in group.memberships]
    return GroupOut(
        id=group.id,
        year=group.year,
        weekday=group.weekday,
        label=group.label,
        active=group.active,
        invite_code=group.invite_code,
        student_count=sum(r == Role.student for r in roles),
        teacher_count=sum(r != Role.student for r in roles),
        teaching=any(m.user_id == user.id for m in group.memberships),
    )


@router.get("/groups", response_model=list[GroupOut])
def list_groups(user: Teacher, db: DB) -> list[GroupOut]:
    groups = db.scalars(select(Group).order_by(Group.active.desc(), Group.year, Group.id))
    return [_out(g, user) for g in groups]


@router.post("/groups", response_model=GroupOut, status_code=201)
def create_group(body: GroupCreate, user: Teacher, db: DB) -> GroupOut:
    group = Group(
        year=body.year,
        weekday=body.weekday,
        label=(body.label or "").strip() or default_label(body.year, body.weekday),
        invite_code=new_invite_code(),
    )
    db.add(group)
    db.flush()
    db.add(Membership(user_id=user.id, group_id=group.id))
    db.commit()
    db.refresh(group)
    return _out(group, user)


@router.patch("/groups/{group_id}", response_model=GroupOut)
def update_group(group_id: int, body: GroupUpdate, user: Teacher, db: DB) -> GroupOut:
    group = _group(db, group_id)
    changes = body.model_dump(exclude_unset=True)
    relabel = group.label == default_label(group.year, group.weekday) and "label" not in changes
    for field, value in changes.items():
        setattr(group, field, value)
    if relabel or not group.label.strip():
        group.label = default_label(group.year, group.weekday)
    db.commit()
    return _out(group, user)


@router.post("/groups/{group_id}/invite", response_model=GroupOut)
def rotate_invite(group_id: int, user: Teacher, db: DB) -> GroupOut:
    """Make a new invite link. The old link stops working."""
    group = _group(db, group_id)
    group.invite_code = new_invite_code()
    db.commit()
    return _out(group, user)


@router.put("/groups/{group_id}/teaching", response_model=GroupOut)
def start_teaching(group_id: int, user: Teacher, db: DB) -> GroupOut:
    group = _group(db, group_id)
    if not any(m.user_id == user.id for m in group.memberships):
        db.add(Membership(user_id=user.id, group_id=group.id))
        db.commit()
        db.refresh(group)
    return _out(group, user)


@router.delete("/groups/{group_id}/teaching", response_model=GroupOut)
def stop_teaching(group_id: int, user: Teacher, db: DB) -> GroupOut:
    group = _group(db, group_id)
    membership = db.get(Membership, (user.id, group.id))
    if membership:
        db.delete(membership)
        db.commit()
        db.refresh(group)
    return _out(group, user)


@router.get("/groups/{group_id}/members", response_model=list[MemberOut])
def members(group_id: int, _user: Teacher, db: DB) -> list[MemberOut]:
    group = _group(db, group_id)
    users = sorted(
        (m.user for m in group.memberships),
        key=lambda u: (u.role != Role.student, u.username.lower()),
    )
    return [MemberOut.model_validate(u) for u in users]


def _move(db: DB, student: User, to: Group, by: User) -> bool:
    current = student.memberships[0].group_id if student.memberships else None
    if current == to.id:
        return False
    student.memberships.clear()
    db.flush()
    db.add(Membership(user_id=student.id, group_id=to.id))
    db.add(
        GroupEvent(user_id=student.id, from_group_id=current, to_group_id=to.id, by_user_id=by.id)
    )
    return True


@router.post("/groups/move-students", response_model=MoveOut)
def move_students(body: MoveStudentsIn, user: Teacher, db: DB) -> MoveOut:
    to = _group(db, body.to_group_id)
    students = db.scalars(
        select(User).where(User.id.in_(body.user_ids), User.role == Role.student)
    ).all()
    if len(students) != len(set(body.user_ids)):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only students can be moved")
    moved = sum(_move(db, s, to, user) for s in students)
    db.commit()
    return MoveOut(moved=moved)


@router.post("/groups/{group_id}/move-all", response_model=MoveOut)
def move_group(group_id: int, body: MoveGroupIn, user: Teacher, db: DB) -> MoveOut:
    """Move every student of a group, e.g. 'Jaar 1 · dinsdag' → 'Jaar 2 · dinsdag'."""
    source = _group(db, group_id)
    to = _group(db, body.to_group_id)
    if source.id == to.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose another group")
    students = [m.user for m in source.memberships if m.user.role == Role.student]
    moved = sum(_move(db, s, to, user) for s in students)
    db.commit()
    return MoveOut(moved=moved)


@router.get("/group-events", response_model=list[GroupEventOut])
def group_events(_user: Teacher, db: DB, limit: int = 200) -> list[GroupEventOut]:
    student, by = aliased(User), aliased(User)
    src, dst = aliased(Group), aliased(Group)
    rows = db.execute(
        select(GroupEvent, student.username, src.label, dst.label, by.username)
        .outerjoin(student, student.id == GroupEvent.user_id)
        .outerjoin(src, src.id == GroupEvent.from_group_id)
        .outerjoin(dst, dst.id == GroupEvent.to_group_id)
        .outerjoin(by, by.id == GroupEvent.by_user_id)
        .order_by(GroupEvent.id.desc())
        .limit(min(limit, 1000))
    ).all()
    return [
        GroupEventOut(id=e.id, at=e.at, username=u, from_group=f, to_group=t, by_username=b)
        for e, u, f, t, b in rows
    ]


@router.post("/users/{user_id}/reset-password", response_model=TempPasswordOut)
def reset_password(user_id: int, actor: Teacher, db: DB) -> TempPasswordOut:
    """Give a user a temporary password. Teachers can reset students; admins anyone."""
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if target.role != Role.student and actor.role != Role.admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an admin can reset this user")
    temp = new_temp_password()
    target.password_hash = hash_secret(temp)
    end_all_sessions(db, target)
    db.commit()
    return TempPasswordOut(username=target.username, temporary_password=temp)
