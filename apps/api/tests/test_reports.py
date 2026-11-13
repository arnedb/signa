from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from signa.models import Clip, ClipSource, Group, Organisation, Role, Word, WordStatus
from tests.conftest import login, make_org, make_user


def _word_with_clip(
    db: Session, org: Organisation, status: WordStatus = WordStatus.published
) -> tuple[Word, Clip]:
    word = Word(org_id=org.id, gloss="huis", year=1, status=status)
    db.add(word)
    db.flush()
    clip = Clip(word_id=word.id, file="clips/huis.mp4", duration=2.0, source=ClipSource.demo)
    db.add(clip)
    db.commit()
    return word, clip


def test_student_reports_and_teacher_resolves(
    app_client: TestClient, db: Session, org: Organisation, group: Group
) -> None:
    word, clip = _word_with_clip(db, org)
    make_user(db, "student1", Role.student, group)
    make_user(db, "teacher1", Role.teacher, group)
    login(app_client, "student1")

    r = app_client.post(
        f"/api/v1/clips/{clip.id}/reports",
        json={"reason": "cut_end", "comment": "  Het einde van het gebaar ontbreekt. "},
    )
    assert r.status_code == 201, r.text
    # Students cannot read the reports.
    assert app_client.get("/api/v1/admin/reports").status_code == 403
    export = app_client.get("/api/v1/me/export").json()
    assert export["clip_reports"][0]["comment"] == "Het einde van het gebaar ontbreekt."

    login(app_client, "teacher1")
    assert app_client.get("/api/v1/admin/reports/count").json() == 1
    reports = app_client.get("/api/v1/admin/reports").json()
    assert len(reports) == 1
    rep = reports[0]
    assert rep["gloss"] == "huis" and rep["reason"] == "cut_end"
    assert rep["clip"]["id"] == clip.id and rep["user"]["username"] == "student1"
    assert rep["resolved_at"] is None
    assert len(app_client.get(f"/api/v1/admin/reports?word_id={word.id}").json()) == 1
    assert app_client.get(f"/api/v1/admin/reports?word_id={word.id + 1}").json() == []

    r = app_client.post(f"/api/v1/admin/reports/{rep['id']}/resolve")
    assert r.status_code == 200
    assert r.json()["resolved_at"] and r.json()["resolver"]["username"] == "teacher1"
    assert app_client.get("/api/v1/admin/reports").json() == []
    assert app_client.get("/api/v1/admin/reports/count").json() == 0
    assert len(app_client.get("/api/v1/admin/reports?state=resolved").json()) == 1

    r = app_client.post(f"/api/v1/admin/reports/{rep['id']}/reopen")
    assert r.json()["resolved_at"] is None and r.json()["resolver"] is None
    assert len(app_client.get("/api/v1/admin/reports").json()) == 1


def test_report_needs_a_comment_for_other(
    student: TestClient, db: Session, org: Organisation
) -> None:
    _, clip = _word_with_clip(db, org)
    url = f"/api/v1/clips/{clip.id}/reports"
    r = student.post(url, json={"reason": "other", "comment": "   "})
    assert r.status_code == 400 and r.json()["detail"] == "Describe the problem"
    assert student.post(url, json={"reason": "wrong_sign"}).status_code == 201
    assert student.post(url, json={"reason": "nonsense"}).status_code == 422
    assert student.post(url, json={"reason": "other", "comment": "x" * 1001}).status_code == 422


def test_report_only_visible_clips(
    app_client: TestClient, db: Session, org: Organisation, group: Group
) -> None:
    make_user(db, "student1", Role.student, group)
    login(app_client, "student1")
    _, draft_clip = _word_with_clip(db, org, WordStatus.draft)
    _, archived = _word_with_clip(db, org)
    archived.archived = True
    other = make_org(db, "other", "Other school")
    _, foreign = _word_with_clip(db, other)
    db.commit()
    for clip in (draft_clip, archived, foreign):
        r = app_client.post(f"/api/v1/clips/{clip.id}/reports", json={"reason": "quality"})
        assert r.status_code == 404, clip.id
    assert (
        app_client.post("/api/v1/clips/9999/reports", json={"reason": "quality"}).status_code == 404
    )

    # Teachers may report a clip of a draft word, from the admin pages.
    make_user(db, "teacher1", Role.teacher, group)
    login(app_client, "teacher1")
    r = app_client.post(f"/api/v1/clips/{draft_clip.id}/reports", json={"reason": "quality"})
    assert r.status_code == 201


def test_reports_stay_in_their_school(
    app_client: TestClient, db: Session, org: Organisation, group: Group
) -> None:
    _, clip = _word_with_clip(db, org)
    make_user(db, "student1", Role.student, group)
    login(app_client, "student1")
    rid = app_client.post(f"/api/v1/clips/{clip.id}/reports", json={"reason": "quality"}).json()[
        "id"
    ]

    other = make_org(db, "other", "Other school")
    make_user(db, "teacher2", Role.teacher, org=other)
    login(app_client, "teacher2")
    assert app_client.get("/api/v1/admin/reports?state=all").json() == []
    assert app_client.post(f"/api/v1/admin/reports/{rid}/resolve").status_code == 404


def test_report_survives_deleted_clip(teacher: TestClient, db: Session, org: Organisation) -> None:
    word, clip = _word_with_clip(db, org)
    teacher.post(f"/api/v1/clips/{clip.id}/reports", json={"reason": "cut_start"})
    db.delete(clip)
    db.commit()
    reports = teacher.get("/api/v1/admin/reports").json()
    assert reports[0]["clip"] is None and reports[0]["word_id"] == word.id
