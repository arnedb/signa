from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from tests.conftest import make_org
from vgt import jobs, media
from vgt.models import Clip, Direction, Organisation, Result, User, Word, WordEvent, WordStatus


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


def test_words_are_paged(teacher: TestClient) -> None:
    for i, gloss in enumerate(["a", "b", "c", "d", "e"]):
        _create(teacher, gloss=gloss, position=i, status="published")
    page = lambda q: [x["gloss"] for x in teacher.get(f"/api/v1/words?{q}").json()]  # noqa: E731
    assert page("limit=2") == ["a", "b"]
    assert page("limit=2&offset=2") == ["c", "d"]
    assert page("limit=2&offset=4") == ["e"]
    assert page("") == ["a", "b", "c", "d", "e"]
    assert teacher.get("/api/v1/words?limit=0").status_code == 422


def test_new_words_need_a_lesson(teacher: TestClient) -> None:
    r = teacher.post("/api/v1/admin/words", json={"gloss": "x", "year": 1, "list_number": "2.1"})
    assert r.status_code == 422
    # The lesson is its own field: it need not match the list number.
    assert _create(teacher, gloss="y", lesson=5, list_number="2.1")["lesson"] == 5


def test_bulk_update(teacher: TestClient, db: Session) -> None:
    a = _create(teacher, gloss="a")
    b = _create(teacher, gloss="b")
    c = _create(teacher, gloss="c")
    r = teacher.post(
        "/api/v1/admin/words/bulk",
        json={
            "ids": [a["id"], b["id"]],
            "changes": {"status": "published", "list_number": "3.1", "lesson": 3},
        },
    )
    assert r.status_code == 200, r.text
    assert [(w["gloss"], w["status"], w["lesson"], w["list_number"]) for w in r.json()] == [
        ("a", "published", 3, "3.1"),
        ("b", "published", 3, "3.1"),
    ]
    assert teacher.get(f"/api/v1/admin/words/{c['id']}").json()["status"] == "draft"
    # Every word gets its own history entry, so it can be undone on its own.
    events = teacher.get(f"/api/v1/admin/words/{a['id']}/events").json()
    assert events[0]["action"] == "update"
    assert events[0]["diff_json"]["status"] == ["draft", "published"]
    assert teacher.post(f"/api/v1/admin/events/{events[0]['id']}/undo").json()["status"] == "draft"
    assert teacher.get(f"/api/v1/admin/words/{b['id']}").json()["status"] == "published"


def test_bulk_update_is_all_or_nothing(teacher: TestClient, db: Session) -> None:
    a = _create(teacher, gloss="a")
    other = make_org(db, "other", "Other")
    foreign = Word(gloss="x", year=1, org_id=other.id, status=WordStatus.draft)
    db.add(foreign)
    db.commit()
    body = {"ids": [a["id"], foreign.id], "changes": {"status": "published"}}
    assert teacher.post("/api/v1/admin/words/bulk", json=body).status_code == 404
    assert teacher.get(f"/api/v1/admin/words/{a['id']}").json()["status"] == "draft"
    empty = {"ids": [a["id"]], "changes": {}}
    assert teacher.post("/api/v1/admin/words/bulk", json=empty).status_code == 422
    assert (
        teacher.post(
            "/api/v1/admin/words/bulk", json={"ids": [], "changes": {"year": 2}}
        ).status_code
        == 422
    )


def test_students_cannot_bulk_update(student: TestClient) -> None:
    r = student.post(
        "/api/v1/admin/words/bulk", json={"ids": [1], "changes": {"status": "published"}}
    )
    assert r.status_code == 403


def test_delete_word_removes_everything(
    teacher: TestClient, db: Session, sample_video: Path
) -> None:
    w = _create(teacher, status="published")
    keep = _create(teacher, gloss="blijft")
    with sample_video.open("rb") as f:
        r = teacher.post(
            f"/api/v1/admin/words/{w['id']}/clips",
            files={"file": ("a.mp4", f, "video/mp4")},
            data={"mode": "replace"},
        )
    assert r.status_code == 202 and jobs.run_pending() == 1
    clip = db.scalars(select(Clip).where(Clip.word_id == w["id"])).one()
    files = [media.media_path(clip.file), media.media_path(clip.thumb or "")]
    assert all(p.is_file() for p in files)
    user_id = db.scalars(select(User.id).where(User.username == "teacher1")).one()
    db.add(Result(user_id=user_id, word_id=w["id"], direction=Direction.w2s, correct=False))
    db.commit()

    assert teacher.delete(f"/api/v1/admin/words/{w['id']}").status_code == 204
    db.expire_all()
    assert teacher.get(f"/api/v1/admin/words/{w['id']}").status_code == 404
    assert db.scalars(select(Clip).where(Clip.word_id == w["id"])).all() == []
    assert db.scalars(select(WordEvent).where(WordEvent.word_id == w["id"])).all() == []
    assert db.scalars(select(Result).where(Result.word_id == w["id"])).all() == []
    assert not any(p.exists() for p in files)
    assert teacher.get(f"/api/v1/admin/words/{keep['id']}").status_code == 200
    assert teacher.delete(f"/api/v1/admin/words/{w['id']}").status_code == 404


def test_bulk_delete_is_all_or_nothing(teacher: TestClient, db: Session) -> None:
    a = _create(teacher, gloss="a")
    b = _create(teacher, gloss="b")
    other = make_org(db, "other2", "Other")
    foreign = Word(gloss="x", year=1, org_id=other.id, status=WordStatus.draft)
    db.add(foreign)
    db.commit()
    url = "/api/v1/admin/words/bulk-delete"
    assert teacher.post(url, json={"ids": [a["id"], foreign.id]}).status_code == 404
    assert teacher.get(f"/api/v1/admin/words/{a['id']}").status_code == 200
    assert teacher.post(url, json={"ids": [a["id"], b["id"]]}).status_code == 204
    assert teacher.get("/api/v1/admin/words").json() == []
    assert db.get(Word, foreign.id) is not None


def test_students_cannot_delete(student: TestClient) -> None:
    assert student.delete("/api/v1/admin/words/1").status_code == 403
    assert student.post("/api/v1/admin/words/bulk-delete", json={"ids": [1]}).status_code == 403


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


def test_trim_clip_and_undo(teacher: TestClient, sample_video: Path) -> None:
    w = _create(teacher)
    for mode in ("replace", "extra"):
        with sample_video.open("rb") as f:
            teacher.post(
                f"/api/v1/admin/words/{w['id']}/clips",
                files={"file": ("a.mp4", f, "video/mp4")},
                data={"mode": mode},
            )
        jobs.run_pending()
    primary, extra = teacher.get(f"/api/v1/admin/words/{w['id']}").json()["clips"]
    assert primary["is_primary"] and 7 < primary["duration"] < 8

    url = f"/api/v1/admin/clips/{primary['id']}/trim"
    assert teacher.post(url, json={"start": 2, "end": 99}).status_code == 400
    assert teacher.post(url, json={"start": 2, "end": 2.1}).status_code == 400
    r = teacher.post(url, json={"start": 2.5, "end": 3.5})
    assert r.status_code == 202, r.text
    assert jobs.run_pending() == 1
    assert teacher.get(f"/api/v1/admin/jobs/{r.json()['id']}").json()["status"] == "done"

    clips = teacher.get(f"/api/v1/admin/words/{w['id']}").json()["clips"]
    new = next(c for c in clips if c["id"] not in (primary["id"], extra["id"]))
    assert new["is_primary"] and not new["archived"] and 0.9 < new["duration"] < 1.2
    assert new["source"] == primary["source"]
    old = next(c for c in clips if c["id"] == primary["id"])
    assert old["archived"] and not old["is_primary"]
    assert next(c for c in clips if c["id"] == extra["id"])["archived"] is False

    # An archived clip cannot be trimmed; restore it first.
    assert teacher.post(url, json={"start": 0, "end": 1}).status_code == 409

    # Trimming an extra clip keeps the primary clip as it is.
    teacher.post(f"/api/v1/admin/clips/{extra['id']}/trim", json={"start": 0, "end": 1})
    jobs.run_pending()
    clips = teacher.get(f"/api/v1/admin/words/{w['id']}").json()["clips"]
    assert next(c for c in clips if c["is_primary"])["id"] == new["id"]

    # Undo the first trim: the full clip is back as the primary one.
    events = teacher.get(f"/api/v1/admin/words/{w['id']}/events").json()
    trims = [e for e in events if e["action"] == "clip_trim"]
    assert len(trims) == 2 and trims[-1]["diff_json"]["old_clip"] == primary["id"]
    word = teacher.post(f"/api/v1/admin/events/{trims[-1]['id']}/undo").json()
    by_id = {c["id"]: c for c in word["clips"]}
    assert by_id[primary["id"]]["is_primary"] and not by_id[primary["id"]]["archived"]
    assert by_id[new["id"]]["archived"]
