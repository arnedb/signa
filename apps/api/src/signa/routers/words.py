from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import selectinload

from signa.deps import DB, Member
from signa.models import Clip, Word, WordStatus
from signa.schemas import Catalog, CatalogList, CatalogYear, WordOut
from signa.services.words import word_out

router = APIRouter(tags=["words"])


def word_query(
    org_id: int,
    year: int | None = None,
    lesson: int | None = None,
    list_number: str | None = None,
    q: str | None = None,
    ids: list[int] | None = None,
) -> Select[Word]:
    stmt = select(Word).where(Word.org_id == org_id).options(selectinload(Word.clips))
    if year is not None:
        stmt = stmt.where(Word.year == year)
    if lesson is not None:
        stmt = stmt.where(Word.lesson == lesson)
    if list_number:
        stmt = stmt.where(Word.list_number == list_number)
    if ids:
        stmt = stmt.where(Word.id.in_(ids))
    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(func.lower(Word.gloss).like(term), func.lower(Word.notes).like(term)))
    return stmt.order_by(
        Word.year, Word.lesson, Word.list_number, Word.position, Word.gloss, Word.id
    )


@router.get("/words", response_model=list[WordOut])
def list_words(
    ctx: Member,
    db: DB,
    year: int | None = None,
    lesson: int | None = None,
    list_number: str | None = None,
    q: str | None = None,
    ids: Annotated[list[int] | None, Query()] = None,
    with_clip: bool = False,
    limit: Annotated[int | None, Query(ge=1, le=500)] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[WordOut]:
    """Published words of the current school, in course order.

    ``with_clip`` keeps only words that have a clip. ``limit`` and ``offset`` page through
    the result; without ``limit`` every matching word is returned.
    """
    stmt = word_query(ctx.org.id, year, lesson, list_number, q, ids).where(
        Word.status == WordStatus.published
    )
    if with_clip:
        stmt = stmt.where(Word.clips.any(Clip.archived.is_(False)))
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    return [word_out(w) for w in db.scalars(stmt)]


@router.get("/words/{word_id}", response_model=WordOut)
def get_word(word_id: int, ctx: Member, db: DB) -> WordOut:
    word = db.get(Word, word_id)
    if word is None or word.org_id != ctx.org.id or word.status != WordStatus.published:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Word not found")
    return word_out(word)


@router.get("/catalog", response_model=Catalog)
def catalog(ctx: Member, db: DB) -> Catalog:
    """Years, lessons and lists of the current school that have published words, with counts."""
    rows = db.execute(
        select(Word.year, Word.lesson, Word.list_number, func.count())
        .where(Word.status == WordStatus.published, Word.org_id == ctx.org.id)
        .group_by(Word.year, Word.lesson, Word.list_number)
        .order_by(Word.year, Word.lesson, Word.list_number)
    ).all()
    years: dict[int, CatalogYear] = {}
    for year, lesson, list_number, count in rows:
        y = years.setdefault(year, CatalogYear(year=year, count=0, lessons=[], lists=[]))
        y.count += count
        if lesson is not None and lesson not in y.lessons:
            y.lessons.append(lesson)
        y.lists.append(CatalogList(list_number=list_number, lesson=lesson, count=count))
    for y in years.values():
        y.lists.sort(key=lambda item: _list_key(item.list_number))
    return Catalog(years=list(years.values()))


def _list_key(value: str | None) -> tuple[int, ...]:
    if not value:
        return (10**6,)
    parts = []
    for p in value.replace("-", ".").split("."):
        parts.append(int(p) if p.isdigit() else 10**5)
    return tuple(parts)
