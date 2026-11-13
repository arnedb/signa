from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.conftest import PASSWORD
from vgt.models import User, Word, WordStatus


def _words(db: Session, n: int, org_id: int = 1) -> list[Word]:
    words = [
        Word(
            org_id=org_id,
            gloss=f"w{i}",
            year=1,
            lesson=1,
            list_number="1.1",
            position=i,
            status=WordStatus.published,
        )
        for i in range(n)
    ]
    db.add_all(words)
    db.commit()
    return words


def test_change_password(student: TestClient) -> None:
    r = student.post(
        "/api/v1/me/password", json={"current_password": "bad", "new_password": "something-new"}
    )
    assert r.status_code == 400
    r = student.post(
        "/api/v1/me/password", json={"current_password": PASSWORD, "new_password": "something-new"}
    )
    assert r.status_code == 204
    assert student.get("/api/v1/me").status_code == 200  # this session stays


def test_results_and_difficult_words(student: TestClient, db: Session) -> None:
    w = _words(db, 3)
    results = [
        {"word_id": w[0].id, "direction": "w2s", "correct": False},
        {"word_id": w[1].id, "direction": "s2w", "correct": False},
        {"word_id": w[1].id, "direction": "w2s", "correct": True},
        {"word_id": w[2].id, "direction": "w2s", "correct": True},
        {"word_id": 9999, "direction": "w2s", "correct": True},
    ]
    assert student.post("/api/v1/me/results", json={"results": results}).json() == {"saved": 4}
    difficult = student.get("/api/v1/me/difficult-words").json()
    assert [(d["gloss"], d["directions"]) for d in difficult] == [("w0", ["w2s"]), ("w1", ["s2w"])]


def test_difficult_words_per_direction(student: TestClient, db: Session) -> None:
    w = _words(db, 2)

    def answer(word: Word, direction: str, correct: bool) -> None:
        body = {"results": [{"word_id": word.id, "direction": direction, "correct": correct}]}
        assert student.post("/api/v1/me/results", json=body).status_code == 200

    def difficult() -> list[tuple[str, list[str]]]:
        words = student.get("/api/v1/me/difficult-words").json()
        return [(d["gloss"], d["directions"]) for d in words]

    answer(w[0], "s2w", False)
    answer(w[0], "w2s", False)
    answer(w[1], "w2s", False)
    assert difficult() == [("w0", ["w2s", "s2w"]), ("w1", ["w2s"])]
    # Knowing it in one direction leaves the other direction difficult.
    answer(w[0], "w2s", True)
    assert difficult() == [("w0", ["s2w"]), ("w1", ["w2s"])]
    answer(w[0], "s2w", True)
    answer(w[1], "w2s", True)
    assert difficult() == []


def test_export_and_delete(student: TestClient, db: Session) -> None:
    w = _words(db, 1)
    student.post(
        "/api/v1/me/results",
        json={"results": [{"word_id": w[0].id, "direction": "w2s", "correct": True}]},
    )
    data = student.get("/api/v1/me/export").json()
    assert data["user"]["username"] == "student1"
    assert data["user"]["groups"] == [{"organisation": "School", "group": "Jaar 1 · dinsdag"}]
    assert data["user"]["organisations"] == [{"name": "School", "role": "student"}]
    assert data["results"][0]["word"] == "w0"

    assert student.post("/api/v1/me/delete", json={"password": "wrong"}).status_code == 400
    assert student.post("/api/v1/me/delete", json={"password": PASSWORD}).status_code == 204
    db.expire_all()
    assert db.query(User).filter_by(username="student1").first() is None
    assert student.get("/api/v1/me").status_code == 401


def test_new_recovery_code(student: TestClient) -> None:
    r = student.post("/api/v1/me/recovery-code", json={"password": PASSWORD})
    assert r.status_code == 200
    assert len(r.json()["recovery_code"]) == 19
