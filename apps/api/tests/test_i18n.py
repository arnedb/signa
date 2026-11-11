from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from tests.conftest import login, make_org, make_user
from vgt import db as vgt_db
from vgt.config import get_settings
from vgt.i18n import group_label, weekday_name
from vgt.models import Role


def test_user_chooses_interface_language(student: TestClient) -> None:
    me = student.get("/api/v1/me").json()
    assert me["locale"] is None and me["org"]["language"]["locale"] == "nl"
    assert student.put("/api/v1/me/locale", json={"locale": "fr"}).json()["locale"] == "fr"
    assert student.get("/api/v1/me").json()["locale"] == "fr"
    assert student.put("/api/v1/me/locale", json={"locale": "de"}).status_code == 422
    assert student.put("/api/v1/me/locale", json={"locale": None}).json()["locale"] is None


def test_group_names_follow_the_school_language(app_client: TestClient, db: Session) -> None:
    org = make_org(db, "ecole", "École")
    org.language_code = "lsfb"
    db.commit()
    make_user(db, "prof", Role.teacher, org=org)
    client = login(app_client, "prof")
    r = client.post("/api/v1/admin/groups", json={"year": 1, "weekday": "tue"})
    assert r.json()["label"] == "Année 1 · mardi" and r.json()["weekday"] == "tue"
    # A default name follows a change of year or weekday; a chosen name stays.
    r = client.patch(f"/api/v1/admin/groups/{r.json()['id']}", json={"weekday": "sat"})
    assert r.json()["label"] == "Année 1 · samedi"
    assert (
        client.post("/api/v1/admin/groups", json={"year": 1, "weekday": "dinsdag"}).status_code
        == 422
    )


def test_labels() -> None:
    assert group_label(2, "wed", "nl") == "Jaar 2 · woensdag"
    assert group_label(2, "wed", "en") == "Year 2 · Wednesday"
    assert group_label(2, "wed", None) == "Jaar 2 · woensdag"
    assert weekday_name("xyz", "fr") == "xyz"


def test_languages_have_a_locale(superadmin: TestClient) -> None:
    langs = {x["code"]: x["locale"] for x in superadmin.get("/api/v1/languages").json()}
    assert langs["vgt"] == "nl" and langs["lsfb"] == "fr"


def test_migration_turns_weekdays_into_codes(tmp_path: Path, monkeypatch) -> None:
    from alembic import command
    from alembic.config import Config

    url = f"sqlite:///{tmp_path}/old.db"
    monkeypatch.setenv("VGT_DATABASE_URL", url)
    get_settings.cache_clear()
    vgt_db.set_engine(vgt_db.make_engine(url))
    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(cfg, "0002")
    engine = create_engine(url)
    with engine.begin() as con:
        con.execute(
            text(
                "INSERT INTO organisations (id, name, slug, language_code, active, created_at) "
                "VALUES (1, 'S', 's', 'lsfb', 1, '2026-01-01')"
            )
        )
        con.execute(
            text(
                "INSERT INTO groups (id, org_id, year, weekday, label, invite_code, active) "
                "VALUES (1, 1, 1, 'zaterdag', 'Jaar 1 · zaterdag', 'abc', 1)"
            )
        )
    command.upgrade(cfg, "head")
    with engine.connect() as con:
        assert con.execute(text("SELECT weekday, label FROM groups")).one() == (
            "sat",
            "Jaar 1 · zaterdag",
        )
        assert con.execute(text("SELECT locale FROM languages WHERE code='lsfb'")).scalar() == "fr"
    command.downgrade(cfg, "0002")
    with engine.connect() as con:
        assert con.execute(text("SELECT weekday FROM groups")).scalar() == "zaterdag"
