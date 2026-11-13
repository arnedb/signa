"""Words limited to groups: same list number, another video or another set of words."""

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from signa import jobs
from signa.models import Group, Membership, Organisation, Role, User
from tests.conftest import login, make_group, make_org, make_user
from tests.test_recordings import upload


def _create(client: TestClient, gloss: str, **kw) -> dict:
    body = {"gloss": gloss, "year": 1, "lesson": 1, "list_number": "1.1", "status": "published"}
    r = client.post("/api/v1/admin/words", json={**body, **kw})
    assert r.status_code == 201, r.text
    return r.json()


def _glosses(client: TestClient, path: str = "/api/v1/words?list_number=1.1") -> list[str]:
    return [w["gloss"] for w in client.get(path).json()]


def test_each_group_gets_its_own_version_of_a_list(
    teacher: TestClient, db: Session, org: Organisation, group: Group
) -> None:
    thursday = make_group(db, org, "thu")
    # List 1.1: two shared words; "kat" only on Tuesday, "hond" only on Thursday; and
    # Thursday signs "huis" differently, so it gets its own "huis" with another video.
    huis = _create(teacher, "huis", position=1)
    _create(teacher, "boom", position=2)
    kat = _create(teacher, "kat", position=3, group_ids=[group.id])
    _create(teacher, "hond", position=3, group_ids=[thursday.id])
    huis_thu = _create(teacher, "Huis", position=1, group_ids=[thursday.id])
    assert kat["group_ids"] == [group.id] and huis["group_ids"] == []

    make_user(db, "tue", Role.student, group)
    make_user(db, "thu", Role.student, thursday)
    tue = login(TestClient(teacher.app, headers={"X-Signa-Client": "web"}), "tue")
    thu = login(TestClient(teacher.app, headers={"X-Signa-Client": "web"}), "thu")

    assert _glosses(tue) == ["huis", "boom", "kat"]
    assert _glosses(thu) == ["Huis", "boom", "hond"]
    assert [w["id"] for w in thu.get("/api/v1/words?q=huis").json()] == [huis_thu["id"]]
    # A word of another group is not found, and the catalog counts the group's own list.
    assert tue.get(f"/api/v1/words/{huis_thu['id']}").status_code == 404
    assert thu.get(f"/api/v1/words/{huis['id']}").status_code == 404
    assert thu.get(f"/api/v1/words/{huis_thu['id']}").status_code == 200
    lists = thu.get("/api/v1/catalog").json()["years"][0]["lists"]
    assert [(x["list_number"], x["count"]) for x in lists] == [("1.1", 3)]

    # Difficult words follow the group too.
    for client, word in ((tue, kat), (thu, huis_thu)):
        r = client.post(
            "/api/v1/me/results",
            json={"results": [{"word_id": word["id"], "direction": "w2s", "correct": False}]},
        )
        assert r.status_code == 200, r.text
    assert [w["gloss"] for w in tue.get("/api/v1/me/difficult-words").json()] == ["kat"]

    # Admins see every word; filtered on a group, the shared words and that group's own.
    every = [w["gloss"] for w in teacher.get("/api/v1/admin/words").json()]
    assert sorted(every) == ["Huis", "boom", "hond", "huis", "kat"]
    r = teacher.get("/api/v1/admin/words", params={"group_id": thursday.id})
    assert sorted(w["gloss"] for w in r.json()) == ["Huis", "boom", "hond", "huis"]


def test_a_draft_variant_does_not_replace_the_shared_word(
    student: TestClient, teacher: TestClient, group: Group
) -> None:
    _create(teacher, "huis")
    variant = _create(teacher, "huis", status="draft", group_ids=[group.id])
    assert _glosses(student) == ["huis"]
    teacher.patch(f"/api/v1/admin/words/{variant['id']}", json={"status": "published"})
    assert [w["id"] for w in student.get("/api/v1/words").json()] == [variant["id"]]


def test_without_a_group_only_shared_words(
    app_client: TestClient, db: Session, org: Organisation, group: Group
) -> None:
    make_user(db, "admin1", Role.admin, org=org)
    admin = login(app_client, "admin1")
    _create(admin, "huis")
    _create(admin, "kat", group_ids=[group.id])
    assert _glosses(admin) == ["huis"]
    # In the group, its words too.
    user = db.query(User).filter_by(username="admin1").one()
    db.add(Membership(user_id=user.id, group_id=group.id))
    db.commit()
    assert _glosses(admin) == ["huis", "kat"]


def test_assign_groups_with_history_and_undo(
    teacher: TestClient, db: Session, org: Organisation, group: Group
) -> None:
    other = make_group(db, org, "thu")
    a = _create(teacher, "a")
    b = _create(teacher, "b")
    # Assign a whole list to groups at once.
    r = teacher.post(
        "/api/v1/admin/words/bulk",
        json={"ids": [a["id"], b["id"]], "changes": {"group_ids": [other.id, group.id]}},
    )
    assert r.status_code == 200, r.text
    assert [w["group_ids"] for w in r.json()] == [sorted([group.id, other.id])] * 2
    events = teacher.get(f"/api/v1/admin/words/{a['id']}/events").json()
    assert events[0]["diff_json"] == {"group_ids": [[], sorted([group.id, other.id])]}
    r = teacher.post(f"/api/v1/admin/events/{events[0]['id']}/undo")
    assert r.status_code == 200 and r.json()["group_ids"] == []

    r = teacher.patch(f"/api/v1/admin/words/{b['id']}", json={"group_ids": []})
    assert r.json()["group_ids"] == []
    # null leaves the groups as they are.
    r = teacher.patch(f"/api/v1/admin/words/{a['id']}", json={"group_ids": None, "notes": "x"})
    assert r.status_code == 200 and r.json()["group_ids"] == []


def test_groups_of_another_school_are_refused(teacher: TestClient, db: Session) -> None:
    elsewhere = make_group(db, make_org(db, "other", "Other"), "other")
    body = {"gloss": "x", "year": 1, "lesson": 1, "group_ids": [elsewhere.id]}
    assert teacher.post("/api/v1/admin/words", json=body).status_code == 400
    word = _create(teacher, "y")
    r = teacher.patch(f"/api/v1/admin/words/{word['id']}", json={"group_ids": [elsewhere.id]})
    assert r.status_code == 400
    r = teacher.post(
        "/api/v1/admin/words/bulk",
        json={"ids": [word["id"]], "changes": {"group_ids": [elsewhere.id]}},
    )
    assert r.status_code == 400
    assert teacher.get(f"/api/v1/admin/words/{word['id']}").json()["group_ids"] == []
    assert teacher.get(f"/api/v1/admin/words?group_id={elsewhere.id}").status_code == 404


def test_recording_makes_a_variant_for_a_group(
    teacher: TestClient, db: Session, org: Organisation, group: Group, sample_video: Path
) -> None:
    other = make_group(db, org, "thu")
    _create(teacher, "huis")
    rec_id = upload(teacher, sample_video)
    segs = teacher.get(f"/api/v1/admin/recordings/{rec_id}").json()["segments"]
    url = f"/api/v1/admin/recordings/{rec_id}/apply"
    item = {"start": segs[0]["start"], "end": segs[0]["end"], "gloss": "huis"}
    body = {"year": 1, "list_number": "1.1", "items": [item]}

    # A shared "huis" is already on the list: refused for everyone, fine for one group.
    assert teacher.post(url, json=body).status_code == 409
    r = teacher.post(url, json={**body, "group_ids": [other.id]})
    assert r.status_code == 202, r.text
    jobs.run_pending()
    # That group has its own "huis" now; another for it (or with it) is refused.
    assert teacher.post(url, json={**body, "group_ids": [other.id]}).status_code == 409
    both = [other.id, group.id]
    assert teacher.post(url, json={**body, "group_ids": both}).status_code == 409
    assert teacher.post(url, json={**body, "group_ids": [group.id]}).status_code == 202
    assert teacher.post(url, json={**body, "group_ids": [999]}).status_code == 400

    words = teacher.get("/api/v1/admin/words", params={"q": "huis"}).json()
    assert sorted(tuple(w["group_ids"]) for w in words) == sorted([(), (other.id,), (group.id,)])


def test_admin_catalog_has_every_list(teacher: TestClient, db: Session, org: Organisation) -> None:
    other = make_group(db, org, "thu")
    _create(teacher, "a")
    _create(teacher, "b", list_number="1.2", group_ids=[other.id])
    _create(teacher, "c", list_number="1.3", status="draft")
    lists = lambda path: [x["list_number"] for x in teacher.get(path).json()["years"][0]["lists"]]  # noqa: E731
    assert lists("/api/v1/catalog") == ["1.1"]
    assert lists("/api/v1/admin/catalog") == ["1.1", "1.2", "1.3"]
