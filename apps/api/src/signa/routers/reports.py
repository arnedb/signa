from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from signa.db import utcnow
from signa.deps import DB, Member, Teacher
from signa.models import Clip, ClipReport, ReportReason, Role, WordStatus
from signa.schemas import AdminReportOut, EventUser, ReportIn, ReportOut
from signa.services.words import clip_out

router = APIRouter(tags=["reports"])


@router.post("/clips/{clip_id}/reports", response_model=ReportOut, status_code=201)
def report_clip(clip_id: int, body: ReportIn, ctx: Member, db: DB) -> ReportOut:
    """Report a problem with a clip of the current school: the wrong sign, a bad start or
    end… The teachers see it in /admin/reports."""
    clip = db.get(Clip, clip_id)
    word = clip.word if clip else None
    visible = word is not None and (
        word.status == WordStatus.published or ctx.role in (Role.teacher, Role.admin)
    )
    if clip is None or word is None or word.org_id != ctx.org.id or clip.archived or not visible:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Clip not found")
    if body.reason == ReportReason.other and not body.comment:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Describe the problem")
    report = ClipReport(
        org_id=ctx.org.id,
        word_id=word.id,
        clip_id=clip.id,
        user_id=ctx.user.id,
        reason=body.reason,
        comment=body.comment,
    )
    db.add(report)
    db.commit()
    return ReportOut(id=report.id, created_at=report.created_at)


def _out(r: ClipReport) -> AdminReportOut:
    return AdminReportOut(
        id=r.id,
        word_id=r.word_id,
        gloss=r.word.gloss,
        clip=clip_out(r.clip) if r.clip else None,
        reason=r.reason,
        comment=r.comment,
        user=EventUser.model_validate(r.user) if r.user else None,
        created_at=r.created_at,
        resolved_at=r.resolved_at,
        resolver=EventUser.model_validate(r.resolver) if r.resolver else None,
    )


@router.get("/admin/reports", response_model=list[AdminReportOut])
def list_reports(
    ctx: Teacher,
    db: DB,
    state: Annotated[Literal["open", "resolved", "all"], Query()] = "open",
    word_id: int | None = None,
) -> list[AdminReportOut]:
    """Reported problems with clips of the current school, newest first."""
    stmt = (
        select(ClipReport)
        .where(ClipReport.org_id == ctx.org.id)
        .options(
            selectinload(ClipReport.word),
            selectinload(ClipReport.clip),
            selectinload(ClipReport.user),
            selectinload(ClipReport.resolver),
        )
        .order_by(ClipReport.id.desc())
    )
    if state == "open":
        stmt = stmt.where(ClipReport.resolved_at.is_(None))
    elif state == "resolved":
        stmt = stmt.where(ClipReport.resolved_at.is_not(None))
    if word_id is not None:
        stmt = stmt.where(ClipReport.word_id == word_id)
    return [_out(r) for r in db.scalars(stmt)]


@router.get("/admin/reports/count", response_model=int)
def count_open_reports(ctx: Teacher, db: DB) -> int:
    """The number of open reports, for the menu."""
    return (
        db.scalar(
            select(func.count())
            .select_from(ClipReport)
            .where(ClipReport.org_id == ctx.org.id, ClipReport.resolved_at.is_(None))
        )
        or 0
    )


def _report(db: DB, ctx: Teacher, report_id: int) -> ClipReport:
    report = db.get(ClipReport, report_id)
    if report is None or report.org_id != ctx.org.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    return report


@router.post("/admin/reports/{report_id}/resolve", response_model=AdminReportOut)
def resolve_report(report_id: int, ctx: Teacher, db: DB) -> AdminReportOut:
    report = _report(db, ctx, report_id)
    if report.resolved_at is None:
        report.resolved_at = utcnow()
        report.resolved_by = ctx.user.id
        db.commit()
        db.refresh(report)
    return _out(report)


@router.post("/admin/reports/{report_id}/reopen", response_model=AdminReportOut)
def reopen_report(report_id: int, ctx: Teacher, db: DB) -> AdminReportOut:
    report = _report(db, ctx, report_id)
    if report.resolved_at is not None:
        report.resolved_at = None
        report.resolved_by = None
        db.commit()
        db.refresh(report)
    return _out(report)
