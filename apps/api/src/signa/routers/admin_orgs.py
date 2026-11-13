"""Organisations (schools) and languages. Creating and changing schools is for superadmins."""

import re
import unicodedata

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from signa.deps import DB, CurrentUser, Superadmin
from signa.models import Group, Language, Organisation, OrgMember, Role, Word
from signa.schemas import LanguageOut, OrgCreate, OrgCreateOut, OrgOut, OrgUpdate
from signa.services.members import add_member

router = APIRouter(tags=["admin: organisations"])


def slugify(name: str) -> str:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")[:64] or "school"


def _count(db: DB, model: type[Group] | type[Word] | type[OrgMember], org_id: int) -> int:
    return db.scalar(select(func.count()).select_from(model).where(model.org_id == org_id)) or 0


def _out(db: DB, org: Organisation) -> OrgOut:
    return OrgOut(
        id=org.id,
        name=org.name,
        slug=org.slug,
        language=LanguageOut.model_validate(org.language),
        active=org.active,
        created_at=org.created_at,
        member_count=_count(db, OrgMember, org.id),
        group_count=_count(db, Group, org.id),
        word_count=_count(db, Word, org.id),
    )


def _language(db: DB, code: str) -> Language:
    language = db.get(Language, code)
    if language is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown language '{code}'")
    return language


@router.get("/languages", response_model=list[LanguageOut], tags=["meta"])
def list_languages(_user: CurrentUser, db: DB) -> list[LanguageOut]:
    return [LanguageOut.model_validate(x) for x in db.scalars(select(Language).order_by("name"))]


@router.get("/admin/organisations", response_model=list[OrgOut])
def list_orgs(_user: Superadmin, db: DB) -> list[OrgOut]:
    orgs = db.scalars(select(Organisation).order_by(func.lower(Organisation.name)))
    return [_out(db, o) for o in orgs]


@router.post("/admin/organisations", response_model=OrgCreateOut, status_code=201)
def create_org(body: OrgCreate, _user: Superadmin, db: DB) -> OrgCreateOut:
    """Create a school, optionally with its first admin (an existing or a new account)."""
    slug = body.slug or slugify(body.name)
    if db.scalars(select(Organisation).where(Organisation.slug == slug)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "This short name is taken")
    org = Organisation(name=body.name, slug=slug, language=_language(db, body.language_code))
    db.add(org)
    db.flush()
    admin = add_member(db, org.id, body.admin_username, Role.admin) if body.admin_username else None
    db.commit()
    return OrgCreateOut(org=_out(db, org), admin=admin)


@router.patch("/admin/organisations/{org_id}", response_model=OrgOut)
def update_org(org_id: int, body: OrgUpdate, _user: Superadmin, db: DB) -> OrgOut:
    org = db.get(Organisation, org_id)
    if org is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Organisation not found")
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    if "language_code" in changes:
        org.language = _language(db, changes.pop("language_code"))
    for field, value in changes.items():
        setattr(org, field, value)
    db.commit()
    return _out(db, org)
