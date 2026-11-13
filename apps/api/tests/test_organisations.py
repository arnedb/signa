"""Schools are separate: words, groups, recordings, logs and members never cross over."""

from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from signa import db as signa_db
from signa.config import get_settings
from signa.models import Group, Membership, Organisation, OrgMember, Role, User, Word, WordStatus
from tests.conftest import PASSWORD, login, make_group, make_org, make_user


def _word(db: Session, org: Organisation, gloss: str) -> Word:
    word = Word(org_id=org.id, gloss=gloss, year=1, status=WordStatus.published)
    db.add(word)
    db.commit()
    return word


def _switch(client: TestClient, org_id: int, group_id: int | None = None) -> dict:
    r = client.put("/api/v1/me/context", json={"org_id": org_id, "group_id": group_id})
    assert r.status_code == 200, r.text
    return r.json()


def test_words_stay_in_their_school(
    student: TestClient, db: Session, org: Organisation, group: Group
) -> None:
    other = make_org(db, "other", "Other school")
    mine, theirs = _word(db, org, "huis"), _word(db, other, "kat")

    assert [w["gloss"] for w in student.get("/api/v1/words").json()] == ["huis"]
    assert student.get(f"/api/v1/words/{theirs.id}").status_code == 404
    assert [y["count"] for y in student.get("/api/v1/catalog").json()["years"]] == [1]

    # Answers for another school's words are ignored.
    results = [
        {"word_id": mine.id, "direction": "w2s", "correct": False},
        {"word_id": theirs.id, "direction": "w2s", "correct": False},
    ]
    assert student.post("/api/v1/me/results", json={"results": results}).json() == {"saved": 1}


def test_teacher_cannot_reach_other_school(
    teacher: TestClient, db: Session, org: Organisation
) -> None:
    other = make_org(db, "other", "Other school")
    their_word = _word(db, other, "kat")
    their_group = make_group(db, other, "their-group")
    their_student = make_user(db, "zoe", Role.student, their_group)

    assert [w["gloss"] for w in teacher.get("/api/v1/admin/words").json()] == []
    assert teacher.get(f"/api/v1/admin/words/{their_word.id}").status_code == 404
    r = teacher.patch(f"/api/v1/admin/words/{their_word.id}", json={"gloss": "hond"})
    assert r.status_code == 404
    assert [g["id"] for g in teacher.get("/api/v1/admin/groups").json()] != [their_group.id]
    assert teacher.get(f"/api/v1/admin/groups/{their_group.id}/members").status_code == 404
    r = teacher.post(f"/api/v1/admin/users/{their_student.id}/reset-password")
    assert r.status_code == 404
    r = teacher.post(
        f"/api/v1/admin/groups/{their_group.id}/move-all", json={"to_group_id": their_group.id}
    )
    assert r.status_code == 404
    # A new word belongs to the teacher's school.
    r = teacher.post("/api/v1/admin/words", json={"gloss": "auto", "year": 1, "lesson": 1})
    db.expire_all()
    assert db.get(Word, r.json()["id"]).org_id == org.id  # type: ignore[union-attr]


def test_one_account_in_two_schools(
    app_client: TestClient, db: Session, org: Organisation, group: Group
) -> None:
    other = make_org(db, "other", "Other school")
    other_group = make_group(db, other, "other-group")
    _word(db, org, "huis")
    _word(db, other, "kat")
    make_user(db, "anna", Role.student, group)
    client = login(app_client, "anna")

    # Joining with an invite link keeps the account and switches to the new group.
    me = client.post("/api/v1/me/join", json={"invite_code": "other-group"}).json()
    assert me["org"]["id"] == other.id and me["group"]["id"] == other_group.id
    assert me["role"] == "student"
    assert {o["name"] for o in me["organisations"]} == {"School", "Other school"}
    assert len(me["groups"]) == 2
    assert [w["gloss"] for w in client.get("/api/v1/words").json()] == ["kat"]

    me = _switch(client, org.id, group.id)
    assert me["org"]["id"] == org.id and me["group"]["id"] == group.id
    assert [w["gloss"] for w in client.get("/api/v1/words").json()] == ["huis"]

    # A group of another school, or a school the user is not in, cannot be chosen.
    r = client.put("/api/v1/me/context", json={"org_id": org.id, "group_id": other_group.id})
    assert r.status_code == 403
    third = make_org(db, "third", "Third school")
    assert client.put("/api/v1/me/context", json={"org_id": third.id}).status_code == 403


def test_last_used_school_is_chosen(
    app_client: TestClient, db: Session, org: Organisation, group: Group
) -> None:
    second = make_org(db, "second", "Z school")
    second_group = make_group(db, second, "second-group")
    third = make_org(db, "third", "C school")
    third_group = make_group(db, third, "third-group")
    make_user(db, "anna", Role.student, group)
    client = login(app_client, "anna")
    client.post("/api/v1/me/join", json={"invite_code": "second-group"})
    client.post("/api/v1/me/join", json={"invite_code": "third-group"})
    _switch(client, second.id, second_group.id)
    _switch(client, third.id, third_group.id)

    # The school chosen last stays chosen after logging in again.
    client.post("/api/v1/auth/logout")
    client = login(app_client, "anna")
    assert client.get("/api/v1/me").json()["org"]["id"] == third.id

    # When it closes, the school used before it is chosen, not the first by name.
    third.active = False
    db.commit()
    me = client.get("/api/v1/me").json()
    assert me["org"]["id"] == second.id and me["group"]["id"] == second_group.id


def test_only_school_is_always_chosen(student: TestClient, db: Session, org: Organisation) -> None:
    user = db.scalars(select(User).where(User.username == "student1")).one()
    user.current_org_id = None
    user.current_group_id = None
    db.commit()
    assert student.get("/api/v1/me").json()["org"]["id"] == org.id


def test_two_groups_in_one_school(student: TestClient, db: Session, group: Group) -> None:
    second = make_group(db, group.org, "second", year=2)
    me = student.post("/api/v1/me/join", json={"invite_code": "second"}).json()
    assert me["group"]["id"] == second.id
    assert [o["role"] for o in me["organisations"]] == ["student"]
    me = _switch(student, group.org_id, group.id)
    assert me["group"]["id"] == group.id


def test_roles_are_per_school(
    app_client: TestClient, db: Session, org: Organisation, group: Group
) -> None:
    other = make_org(db, "other", "Other school")
    other_group = make_group(db, other, "other-group")
    user = make_user(db, "juf", Role.teacher, group)
    client = login(app_client, "juf")
    client.post("/api/v1/me/join", json={"invite_code": other_group.invite_code})

    # A student in the other school: no admin there.
    assert client.get("/api/v1/me").json()["role"] == "student"
    assert client.get("/api/v1/admin/words").status_code == 403
    # A teacher in the first school.
    me = _switch(client, org.id)
    assert me["role"] == "teacher"
    assert client.get("/api/v1/admin/words").status_code == 200
    _ = user


def test_moves_keep_other_groups(teacher: TestClient, db: Session, group: Group) -> None:
    year2 = make_group(db, group.org, "year2", year=2)
    extra = make_group(db, group.org, "extra")
    anna = make_user(db, "anna", Role.student, group)
    db.add(Membership(user_id=anna.id, group_id=extra.id))
    db.commit()
    r = teacher.post(f"/api/v1/admin/groups/{group.id}/move-all", json={"to_group_id": year2.id})
    assert r.json() == {"moved": 1}
    db.expire_all()
    assert sorted(g.id for g in anna.groups) == sorted([year2.id, extra.id])


def test_admin_adds_existing_account_to_school(
    admin: TestClient, db: Session, org: Organisation
) -> None:
    other = make_org(db, "other", "Other school")
    make_user(db, "meester", Role.teacher, org=other)

    r = admin.post("/api/v1/admin/users", json={"username": "meester", "role": "teacher"})
    assert r.status_code == 201
    assert r.json() == {"username": "meester", "created": False, "temporary_password": None}
    r = admin.post("/api/v1/admin/users", json={"username": "meester", "role": "teacher"})
    assert r.status_code == 409

    r = admin.post("/api/v1/admin/users", json={"username": "nieuw", "role": "teacher"})
    assert r.json()["created"] and r.json()["temporary_password"]

    users = {u["username"]: u for u in admin.get("/api/v1/admin/users").json()}
    assert set(users) == {"admin1", "meester", "nieuw"}
    # meester is a teacher elsewhere, so this school's admin cannot reset the password.
    r = admin.post(f"/api/v1/admin/users/{users['meester']['id']}/reset-password")
    assert r.status_code == 403

    # Removing someone from the school keeps the account.
    assert admin.delete(f"/api/v1/admin/users/{users['meester']['id']}").status_code == 204
    names = {u["username"] for u in admin.get("/api/v1/admin/users").json()}
    assert names == {"admin1", "nieuw"}
    # The last admin cannot be removed or demoted.
    assert admin.delete(f"/api/v1/admin/users/{users['admin1']['id']}").status_code == 400


def test_superadmin_creates_schools(superadmin: TestClient, db: Session) -> None:
    langs = superadmin.get("/api/v1/languages").json()
    assert {x["code"] for x in langs} >= {"vgt", "lsfb", "ngt"}
    r = superadmin.post(
        "/api/v1/admin/organisations",
        json={"name": "CVO Gent", "language_code": "vgt", "admin_username": "directeur"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["org"]["slug"] == "cvo-gent" and body["admin"]["temporary_password"]
    r = superadmin.post("/api/v1/admin/organisations", json={"name": "CVO Gent"})
    assert r.status_code == 409
    r = superadmin.post(
        "/api/v1/admin/organisations", json={"name": "École", "language_code": "lsfb"}
    )
    assert r.json()["org"]["language"]["code"] == "lsfb"

    # The superadmin acts as admin in every active school.
    me = superadmin.get("/api/v1/me").json()
    assert {o["role"] for o in me["organisations"]} == {"admin"}
    assert superadmin.get("/api/v1/admin/users").status_code == 200

    org_id = body["org"]["id"]
    r = superadmin.patch(f"/api/v1/admin/organisations/{org_id}", json={"active": False})
    assert r.json()["active"] is False
    assert len(superadmin.get("/api/v1/me").json()["organisations"]) == 1


def test_only_superadmins_manage_schools(admin: TestClient) -> None:
    assert admin.get("/api/v1/admin/organisations").status_code == 403
    assert admin.post("/api/v1/admin/organisations", json={"name": "X"}).status_code == 403


def test_user_without_school(app_client: TestClient, db: Session, org: Organisation) -> None:
    make_user(db, "lost", Role.student, org=org)
    client = login(app_client, "lost")
    me = client.get("/api/v1/me").json()
    assert me["org"]["id"] == org.id and me["group"] is None
    db.query(OrgMember).delete()
    db.commit()
    me = client.get("/api/v1/me").json()
    assert me["org"] is None and me["organisations"] == []
    assert client.get("/api/v1/words").status_code == 403


def test_inactive_school_invite_is_invalid(
    superadmin: TestClient, db: Session, group: Group
) -> None:
    superadmin.patch(f"/api/v1/admin/organisations/{group.org_id}", json={"active": False})
    assert superadmin.get(f"/api/v1/auth/invites/{group.invite_code}").status_code == 404


def test_register_joins_school(app_client: TestClient, group: Group) -> None:
    info = app_client.get(f"/api/v1/auth/invites/{group.invite_code}").json()
    assert info["org"]["name"] == "School"
    r = app_client.post(
        "/api/v1/auth/register",
        json={"invite_code": group.invite_code, "username": "nieuw", "password": PASSWORD},
    )
    user = r.json()["user"]
    assert user["org"]["id"] == group.org_id and user["group"]["id"] == group.id
    assert user["role"] == "student"


def test_migration_moves_data_into_one_school(tmp_path: Path, monkeypatch) -> None:
    """Upgrading a database from before organisations keeps every row and role."""
    from alembic import command
    from alembic.config import Config

    url = f"sqlite:///{tmp_path}/old.db"
    monkeypatch.setenv("SIGNA_DATABASE_URL", url)
    get_settings.cache_clear()
    signa_db.set_engine(signa_db.make_engine(url))
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(cfg, "0001")
    engine = create_engine(url)
    with engine.begin() as con:
        con.execute(
            text(
                "INSERT INTO users (id, username, password_hash, role, created_at) VALUES "
                "(1, 'adm', 'x', 'admin', '2026-01-01'), (2, 'juf', 'x', 'teacher', '2026-01-01'),"
                " (3, 'stu', 'x', 'student', '2026-01-01')"
            )
        )
        con.execute(
            text(
                "INSERT INTO groups (id, year, weekday, label, invite_code, active) "
                "VALUES (1, 1, 'dinsdag', 'J1', 'abc', 1)"
            )
        )
        con.execute(text("INSERT INTO memberships VALUES (2, 1), (3, 1)"))
        con.execute(
            text(
                "INSERT INTO words (id, gloss, year, position, notes, status, created_at, "
                "updated_at) VALUES (1, 'huis', 1, 0, '', 'published', '2026-01-01', '2026-01-01')"
            )
        )
    command.upgrade(cfg, "head")
    with engine.connect() as con:
        assert con.execute(text("SELECT id, slug FROM organisations")).all() == [(1, "school")]
        roles = con.execute(text("SELECT user_id, role FROM org_members ORDER BY user_id")).all()
        assert roles == [(1, "admin"), (2, "teacher"), (3, "student")]
        assert con.execute(text("SELECT count(*) FROM memberships")).scalar() == 2
        assert con.execute(text("SELECT org_id FROM words")).scalar() == 1
        assert con.execute(text("SELECT org_id FROM groups")).scalar() == 1
        supers = con.execute(text("SELECT username FROM users WHERE is_superadmin")).all()
        assert supers == [("adm",)]
    command.downgrade(cfg, "0001")
    with engine.connect() as con:
        roles = con.execute(text("SELECT username, role FROM users ORDER BY id")).all()
        assert roles == [("adm", "admin"), ("juf", "teacher"), ("stu", "student")]
        assert con.execute(text("SELECT count(*) FROM memberships")).scalar() == 2


def test_recordings_stay_in_their_school(teacher: TestClient, db: Session) -> None:
    from signa.models import Job, JobKind, JobStatus

    other = make_org(db, "other", "Other school")
    job = Job(
        kind=JobKind.split,
        status=JobStatus.done,
        org_id=other.id,
        payload={"filename": "x.mp4"},
        result={"source": "sources/x.mp4", "duration": 5, "segments": [], "applied": []},
    )
    db.add(job)
    db.commit()
    assert teacher.get("/api/v1/admin/recordings").json() == []
    assert teacher.get(f"/api/v1/admin/recordings/{job.id}").status_code == 404
    assert teacher.get(f"/api/v1/admin/jobs/{job.id}").status_code == 404
    assert teacher.get(f"/api/v1/media/recordings/{job.id}").status_code == 404
    assert teacher.post(f"/api/v1/admin/recordings/{job.id}/split", json={}).status_code == 404
