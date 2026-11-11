"""Which organisation and group a user is working in.

A user can belong to several organisations, and to several groups within one. The choice is
stored on the user (``current_org_id``, ``current_group_id``), so it is the same on web and
mobile. Every request checks it again: when the user lost access, a valid default is chosen.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from vgt.models import Group, Organisation, Role, User
from vgt.schemas import GroupBrief, Me, MyOrg, OrgBrief


@dataclass
class Context:
    user: User
    org: Organisation | None
    role: Role | None
    group: Group | None


def available_orgs(db: Session, user: User) -> list[tuple[Organisation, Role]]:
    """Active organisations the user can work in, with their role, sorted by name.

    A superadmin acts as admin in every organisation, also in ones they are not a member of.
    """
    if user.is_superadmin:
        orgs = db.scalars(select(Organisation).where(Organisation.active.is_(True))).all()
        return sorted(((o, Role.admin) for o in orgs), key=lambda p: p[0].name.lower())
    pairs = [(m.org, m.role) for m in user.org_memberships if m.org.active]
    return sorted(pairs, key=lambda p: p[0].name.lower())


def user_groups(user: User, org_id: int) -> list[Group]:
    """The user's groups in one organisation, active ones first."""
    groups = [g for g in user.groups if g.org_id == org_id]
    return sorted(groups, key=lambda g: (not g.active, g.year, g.label.lower(), g.id))


def resolve(db: Session, user: User) -> Context:
    """The user's current organisation and group, repaired when no longer valid."""
    orgs = available_orgs(db, user)
    pair = next((p for p in orgs if p[0].id == user.current_org_id), None)
    if pair is None and orgs:
        # Prefer an organisation the user has a group in (students always do).
        pair = next((p for p in orgs if user_groups(user, p[0].id)), orgs[0])
    org, role = pair if pair else (None, None)
    group = None
    if org is not None:
        groups = user_groups(user, org.id)
        group = next((g for g in groups if g.id == user.current_group_id), None)
        if group is None and groups:
            group = groups[0]
    org_id = org.id if org else None
    group_id = group.id if group else None
    if (user.current_org_id, user.current_group_id) != (org_id, group_id):
        user.current_org_id, user.current_group_id = org_id, group_id
        db.commit()
    return Context(user=user, org=org, role=role, group=group)


def select_context(db: Session, user: User, org_id: int, group_id: int | None) -> Context:
    """Switch to another organisation (and optionally a group in it). Raises ValueError."""
    if not any(o.id == org_id for o, _ in available_orgs(db, user)):
        raise ValueError("You are not a member of this organisation")
    if group_id is not None and group_id not in {g.id for g in user_groups(user, org_id)}:
        raise ValueError("You are not a member of this group")
    user.current_org_id = org_id
    user.current_group_id = group_id
    db.commit()
    return resolve(db, user)


def me_out(db: Session, user: User) -> Me:
    ctx = resolve(db, user)
    orgs = available_orgs(db, user)
    org_ids = {o.id for o, _ in orgs}
    groups = sorted(
        (g for g in user.groups if g.org_id in org_ids),
        key=lambda g: (g.org_id, not g.active, g.year, g.label.lower()),
    )
    return Me(
        id=user.id,
        username=user.username,
        is_superadmin=user.is_superadmin,
        created_at=user.created_at,
        org=OrgBrief.model_validate(ctx.org) if ctx.org else None,
        role=ctx.role,
        group=GroupBrief.model_validate(ctx.group) if ctx.group else None,
        organisations=[MyOrg(**OrgBrief.model_validate(o).model_dump(), role=r) for o, r in orgs],
        groups=[GroupBrief.model_validate(g) for g in groups],
    )
