"""Membership of organisations and groups."""

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from vgt.models import Group, Membership, Organisation, OrgMember, Role, User
from vgt.schemas import MemberAddOut
from vgt.security import hash_secret, new_temp_password


def ensure_org_member(db: Session, user: User, org_id: int, role: Role) -> OrgMember:
    """Add the user to the organisation with ``role``. An existing role is kept."""
    member = db.get(OrgMember, (user.id, org_id))
    if member is None:
        member = OrgMember(user_id=user.id, org_id=org_id, role=role)
        db.add(member)
        db.flush()
        db.refresh(user)
    return member


def join_group(db: Session, user: User, group: Group, role: Role = Role.student) -> bool:
    """Add the user to a group (and its organisation), and make it their current group.

    Returns False when the user was already in the group.
    """
    ensure_org_member(db, user, group.org_id, role)
    added = db.get(Membership, (user.id, group.id)) is None
    if added:
        db.add(Membership(user_id=user.id, group_id=group.id))
        db.flush()
        db.refresh(user)
    user.current_org_id = group.org_id
    user.current_group_id = group.id
    return added


def admin_count(db: Session, org_id: int) -> int:
    return (
        db.scalar(
            select(func.count())
            .select_from(OrgMember)
            .where(OrgMember.org_id == org_id, OrgMember.role == Role.admin)
        )
        or 0
    )


def sole_admin_of(db: Session, user: User) -> list[Organisation]:
    """Active organisations in which the user is the only admin."""
    return [
        m.org
        for m in user.org_memberships
        if m.role == Role.admin and m.org.active and admin_count(db, m.org_id) <= 1
    ]


def remove_from_org(db: Session, user: User, org_id: int) -> None:
    """Remove the user from the organisation and from all its groups."""
    for m in [m for m in user.memberships if m.group.org_id == org_id]:
        db.delete(m)
    member = db.get(OrgMember, (user.id, org_id))
    if member:
        db.delete(member)
    db.flush()
    db.refresh(user)


def find_user(db: Session, username: str) -> User | None:
    return db.scalars(
        select(User).where(func.lower(User.username) == username.strip().lower())
    ).first()


def add_member(db: Session, org_id: int, username: str, role: Role) -> MemberAddOut:
    """Add an existing account to the organisation, or create one with a temporary password."""
    user = find_user(db, username)
    if user is not None:
        if db.get(OrgMember, (user.id, org_id)) is not None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Already a member of this school")
        ensure_org_member(db, user, org_id, role)
        return MemberAddOut(username=user.username, created=False)
    temp = new_temp_password()
    user = User(username=username, password_hash=hash_secret(temp))
    db.add(user)
    db.flush()
    ensure_org_member(db, user, org_id, role)
    return MemberAddOut(username=username, created=True, temporary_password=temp)
