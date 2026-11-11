from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import PASSWORD, login, make_user
from vgt.models import Group, Role


def test_group_lifecycle_and_moves(teacher: TestClient, db: Session, group: Group) -> None:
    r = teacher.post("/api/v1/admin/groups", json={"year": 2, "weekday": "dinsdag"})
    assert r.status_code == 201
    year2 = r.json()
    assert year2["label"] == "Jaar 2 · dinsdag" and year2["teaching"]

    a = make_user(db, "anna", Role.student, group)
    b = make_user(db, "bert", Role.student, group)
    make_user(db, "carl", Role.student, group)

    groups = {g["id"]: g for g in teacher.get("/api/v1/admin/groups").json()}
    assert groups[group.id]["student_count"] == 3 and groups[group.id]["teacher_count"] == 1

    r = teacher.post(
        "/api/v1/admin/groups/move-students",
        json={"user_ids": [a.id], "from_group_id": group.id, "to_group_id": year2["id"]},
    )
    assert r.json() == {"moved": 1}
    r = teacher.post(f"/api/v1/admin/groups/{group.id}/move-all", json={"to_group_id": year2["id"]})
    assert r.json() == {"moved": 2}
    members = teacher.get(f"/api/v1/admin/groups/{year2['id']}/members").json()
    assert [m["username"] for m in members] == ["anna", "bert", "carl", "teacher1"]

    events = teacher.get("/api/v1/admin/group-events").json()
    assert len(events) == 3
    assert events[-1]["username"] == "anna" and events[-1]["to_group"] == "Jaar 2 · dinsdag"
    assert events[-1]["by_username"] == "teacher1"

    # Teachers cannot be moved like students.
    r = teacher.post(
        "/api/v1/admin/groups/move-students",
        json={"user_ids": [1], "from_group_id": year2["id"], "to_group_id": group.id},
    )
    assert r.status_code == 400
    _ = b


def test_rotate_invite(teacher: TestClient, group: Group) -> None:
    old = group.invite_code
    new = teacher.post(f"/api/v1/admin/groups/{group.id}/invite").json()["invite_code"]
    assert new != old
    assert teacher.get(f"/api/v1/auth/invites/{old}").status_code == 404
    assert teacher.get(f"/api/v1/auth/invites/{new}").status_code == 200


def test_inactive_group_has_no_invite(teacher: TestClient, group: Group) -> None:
    teacher.patch(f"/api/v1/admin/groups/{group.id}", json={"active": False})
    assert teacher.get(f"/api/v1/auth/invites/{group.invite_code}").status_code == 404


def test_reset_password(
    teacher: TestClient, db: Session, group: Group, app_client: TestClient
) -> None:
    s = make_user(db, "anna", Role.student, group)
    t = make_user(db, "other-teacher", Role.teacher, group)
    r = teacher.post(f"/api/v1/admin/users/{s.id}/reset-password")
    temp = r.json()["temporary_password"]
    assert teacher.post(f"/api/v1/admin/users/{t.id}/reset-password").status_code == 403
    teacher.post("/api/v1/auth/logout")
    r = app_client.post("/api/v1/auth/login", json={"username": "anna", "password": temp})
    assert r.status_code == 200


def test_admin_manages_roles(admin: TestClient, db: Session) -> None:
    r = admin.post("/api/v1/admin/users", json={"username": "juf", "role": "teacher"})
    assert r.status_code == 201
    users = admin.get("/api/v1/admin/users").json()
    juf = next(u for u in users if u["username"] == "juf")
    assert juf["role"] == "teacher"
    r = admin.put(f"/api/v1/admin/users/{juf['id']}/role", json={"role": "admin"})
    assert r.json()["role"] == "admin"
    me = admin.get("/api/v1/me").json()
    assert (
        admin.put(f"/api/v1/admin/users/{me['id']}/role", json={"role": "teacher"}).status_code
        == 400
    )


def test_teacher_cannot_manage_roles(teacher: TestClient) -> None:
    assert teacher.get("/api/v1/admin/users").status_code == 403


def test_last_admin_cannot_delete_self(admin: TestClient) -> None:
    assert admin.post("/api/v1/me/delete", json={"password": PASSWORD}).status_code == 400
    _ = login
