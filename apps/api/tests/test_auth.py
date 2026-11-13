from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from signa.models import Group, Role
from tests.conftest import PASSWORD, make_user


def test_register_with_invite_then_login(app_client: TestClient, group: Group) -> None:
    r = app_client.get("/api/v1/auth/invites/invite-1")
    assert r.json()["group"]["label"] == "Jaar 1 · dinsdag"

    r = app_client.post(
        "/api/v1/auth/register",
        json={"invite_code": "invite-1", "username": "lies", "password": "geheim123"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["user"]["role"] == "student"
    assert body["user"]["groups"][0]["id"] == group.id
    assert len(body["recovery_code"]) == 19
    assert body["token"] is None
    assert "signa_session" in r.cookies

    assert app_client.get("/api/v1/me").json()["username"] == "lies"


def test_register_rejects_bad_invite_and_taken_name(app_client: TestClient, group: Group) -> None:
    data = {"invite_code": "nope", "username": "lies", "password": "geheim123"}
    assert app_client.post("/api/v1/auth/register", json=data).status_code == 404
    data["invite_code"] = "invite-1"
    assert app_client.post("/api/v1/auth/register", json=data).status_code == 201
    data["username"] = "LIES"
    assert app_client.post("/api/v1/auth/register", json=data).status_code == 409


def test_mobile_login_returns_bearer_token(app_client: TestClient, db: Session) -> None:
    make_user(db, "mo", Role.student)
    r = app_client.post(
        "/api/v1/auth/login", json={"username": "mo", "password": PASSWORD, "client": "mobile"}
    )
    token = r.json()["token"]
    assert token and "signa_session" not in r.cookies
    app_client.cookies.clear()
    r = app_client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.json()["username"] == "mo"


def test_wrong_password(app_client: TestClient, db: Session) -> None:
    make_user(db, "x", Role.student)
    r = app_client.post("/api/v1/auth/login", json={"username": "x", "password": "nope"})
    assert r.status_code == 401
    assert app_client.get("/api/v1/me").status_code == 401


def test_cookie_requests_need_csrf_header(student: TestClient) -> None:
    r = student.post("/api/v1/me/results", json={"results": []}, headers={"X-Signa-Client": ""})
    assert r.status_code == 200  # header present (empty) is fine
    del student.headers["X-Signa-Client"]
    assert student.post("/api/v1/me/results", json={"results": []}).status_code == 403
    assert student.get("/api/v1/me").status_code == 200


def test_recover_with_code(app_client: TestClient, group: Group) -> None:
    r = app_client.post(
        "/api/v1/auth/register",
        json={"invite_code": "invite-1", "username": "lies", "password": "geheim123"},
    )
    code = r.json()["recovery_code"]
    r = app_client.post(
        "/api/v1/auth/recover",
        json={
            "username": "lies",
            "recovery_code": code.lower().replace("-", " "),
            "new_password": "nieuw-wachtwoord",
        },
    )
    assert r.status_code == 200
    new_code = r.json()["recovery_code"]
    assert new_code != code
    # Old sessions end, the old code no longer works, the new password does.
    assert app_client.get("/api/v1/me").status_code == 401
    r = app_client.post(
        "/api/v1/auth/recover",
        json={"username": "lies", "recovery_code": code, "new_password": "nog-een-ander"},
    )
    assert r.status_code == 400
    r = app_client.post(
        "/api/v1/auth/login", json={"username": "lies", "password": "nieuw-wachtwoord"}
    )
    assert r.status_code == 200


def test_logout(student: TestClient) -> None:
    assert student.post("/api/v1/auth/logout").status_code == 204
    assert student.get("/api/v1/me").status_code == 401
