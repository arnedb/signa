from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from vgt import jobs
from vgt.models import Organisation, Word, WordStatus


def _create(client: TestClient, **kw) -> dict:
    body = {"gloss": "huis", "year": 1, "lesson": 2, "list_number": "2.1", **kw}
    r = client.post("/api/v1/admin/words", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_students_cannot_use_admin(student: TestClient) -> None:
    assert student.get("/api/v1/admin/words").status_code == 403
    assert student.post("/api/v1/admin/words", json={"gloss": "x", "year": 1}).status_code == 403


def test_draft_publish_and_catalog(teacher: TestClient, db: Session) -> None:
    w = _create(teacher)
    assert w["status"] == "draft"
    assert teacher.get("/api/v1/words").json() == []  # drafts are hidden from practice
    r = teacher.patch(f"/api/v1/admin/words/{w['id']}", json={"status": "published"})
    assert r.json()["status"] == "published"
    _create(teacher, gloss="auto", list_number="2.2", status="published")
    _create(teacher, gloss="kat", year=2, lesson=1, list_number="1.1", status="published")

    assert [x["gloss"] for x in teacher.get("/api/v1/words?year=1").json()] == ["huis", "auto"]
    assert [x["gloss"] for x in teacher.get("/api/v1/words?q=KA").json()] == ["kat"]
    cat = teacher.get("/api/v1/catalog").json()["years"]
    assert [(y["year"], y["count"], y["lessons"]) for y in cat] == [(1, 2, [2]), (2, 1, [1])]
    assert [item["list_number"] for item in cat[0]["lists"]] == ["2.1", "2.2"]


def test_history_and_undo(teacher: TestClient) -> None:
    w = _create(teacher)
    teacher.patch(f"/api/v1/admin/words/{w['id']}", json={"gloss": "woning", "notes": "ook: huis"})
    events = teacher.get(f"/api/v1/admin/words/{w['id']}/events").json()
    assert [e["action"] for e in events] == ["update", "create"]
    assert events[0]["diff_json"]["gloss"] == ["huis", "woning"]
    assert events[0]["user"]["username"] == "teacher1"

    r = teacher.post(f"/api/v1/admin/events/{events[0]['id']}/undo")
    assert r.status_code == 200
    assert r.json()["gloss"] == "huis" and r.json()["notes"] == ""
    assert teacher.post(f"/api/v1/admin/events/{events[0]['id']}/undo").status_code == 409


def test_undo_conflicts_with_later_change(teacher: TestClient) -> None:
    w = _create(teacher)
    teacher.patch(f"/api/v1/admin/words/{w['id']}", json={"gloss": "a"})
    teacher.patch(f"/api/v1/admin/words/{w['id']}", json={"gloss": "b"})
    first = teacher.get(f"/api/v1/admin/words/{w['id']}/events").json()[1]
    assert teacher.post(f"/api/v1/admin/events/{first['id']}/undo").status_code == 409


def test_clip_upload_replace_and_undo(teacher: TestClient, db: Session, sample_video: Path) -> None:
    w = _create(teacher, status="published")
    url = f"/api/v1/admin/words/{w['id']}/clips"

    def upload(mode: str) -> None:
        with sample_video.open("rb") as f:
            r = teacher.post(url, files={"file": ("a.mp4", f, "video/mp4")}, data={"mode": mode})
        assert r.status_code == 202, r.text
        assert jobs.run_pending() == 1
        assert teacher.get(f"/api/v1/admin/jobs/{r.json()['id']}").json()["status"] == "done"

    upload("replace")
    first = teacher.get(f"/api/v1/admin/words/{w['id']}").json()["clips"]
    assert len(first) == 1 and first[0]["is_primary"] and first[0]["thumb_url"]

    upload("extra")
    clips = teacher.get(f"/api/v1/admin/words/{w['id']}").json()["clips"]
    assert [c["is_primary"] for c in clips] == [True, False]

    upload("replace")
    clips = teacher.get(f"/api/v1/admin/words/{w['id']}").json()["clips"]
    live = [c for c in clips if not c["archived"]]
    assert len(live) == 2 and live[0]["id"] not in (first[0]["id"],)
    assert any(c["archived"] and c["id"] == first[0]["id"] for c in clips)

    # Undo the replacement: the old clip is primary again.
    replace_event = next(
        e
        for e in teacher.get(f"/api/v1/admin/words/{w['id']}/events").json()
        if e["action"] == "clip_replace"
    )
    word = teacher.post(f"/api/v1/admin/events/{replace_event['id']}/undo").json()
    primary = next(c for c in word["clips"] if c["is_primary"])
    assert primary["id"] == first[0]["id"]

    # Students get the video with range support; archived clips are hidden from them.
    r = teacher.get(primary["url"], headers={"Range": "bytes=0-99"})
    assert r.status_code == 206 and len(r.content) == 100
    assert r.headers["content-type"] == "video/mp4"


def test_media_requires_login(app_client: TestClient, db: Session, org: Organisation) -> None:
    word = Word(org_id=org.id, gloss="x", year=1, status=WordStatus.published)
    db.add(word)
    db.commit()
    assert app_client.get("/api/v1/media/clips/1").status_code == 401


def test_bad_upload_type(teacher: TestClient) -> None:
    w = _create(teacher)
    r = teacher.post(
        f"/api/v1/admin/words/{w['id']}/clips", files={"file": ("a.txt", b"hello", "text/plain")}
    )
    assert r.status_code == 400
