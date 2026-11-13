from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from vgt import jobs
from vgt.config import get_settings
from vgt.media import rest_boundaries


def upload(client: TestClient, video: Path, name: str = "les1.mov") -> int:
    with video.open("rb") as f:
        r = client.post("/api/v1/admin/recordings", files={"file": (name, f, "video/quicktime")})
    assert r.status_code == 202, r.text
    jobs.run_pending()
    return r.json()["id"]


def test_recording_session(
    teacher: TestClient, sample_video: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The sample has truly still frames between the signs: freezedetect cuts tightly.
    monkeypatch.setenv("VGT_SPLIT_METHOD", "freeze")
    get_settings.cache_clear()
    words = [
        teacher.post(
            "/api/v1/admin/words",
            json={"gloss": g, "year": 1, "lesson": 1, "list_number": "1.1", "position": i},
        ).json()
        for i, g in enumerate(["een", "twee", "drie"])
    ]
    with sample_video.open("rb") as f:
        r = teacher.post(
            "/api/v1/admin/recordings", files={"file": ("les1.mov", f, "video/quicktime")}
        )
    assert r.status_code == 202, r.text
    rec_id = r.json()["id"]
    assert r.json()["status"] == "queued"
    jobs.run_pending()

    rec = teacher.get(f"/api/v1/admin/recordings/{rec_id}").json()
    assert rec["status"] == "done", rec["error"]
    assert rec["filename"] == "les1.mov"
    assert rec["method"] == "freeze"
    assert 7 < rec["duration"] < 8
    segs = rec["segments"]
    assert len(segs) == 3, segs
    for i, s in enumerate(segs):
        assert abs(s["start"] - i * 2.5) < 0.4 and abs(s["end"] - (i * 2.5 + 1)) < 0.4

    assert teacher.get(rec["source_url"]).status_code == 200

    # Adjust a cut point, then match each segment to a word.
    segs[0]["end"] = 1.2
    r = teacher.put(f"/api/v1/admin/recordings/{rec_id}/segments", json={"segments": segs})
    assert r.json()["segments"][0]["end"] == 1.2
    bad = [{"start": 5, "end": 99}]
    assert (
        teacher.put(
            f"/api/v1/admin/recordings/{rec_id}/segments", json={"segments": bad}
        ).status_code
        == 400
    )

    items = [{**s, "word_id": w["id"], "mode": "replace"} for s, w in zip(segs, words, strict=True)]
    r = teacher.post(f"/api/v1/admin/recordings/{rec_id}/apply", json={"items": items})
    assert r.status_code == 202 and len(r.json()) == 3
    assert jobs.run_pending() == 3

    for w in words:
        clips = teacher.get(f"/api/v1/admin/words/{w['id']}").json()["clips"]
        assert len(clips) == 1 and clips[0]["source"] == "recording"
        assert 0.8 < clips[0]["duration"] < 1.6
    rec = teacher.get(f"/api/v1/admin/recordings/{rec_id}").json()
    assert len(rec["applied"]) == 3
    assert len(teacher.get("/api/v1/admin/recordings").json()) == 1


def test_failed_split_reports_error(teacher: TestClient, tmp_path: Path) -> None:
    r = teacher.post(
        "/api/v1/admin/recordings", files={"file": ("x.mp4", b"not a video", "video/mp4")}
    )
    jobs.run_pending()
    rec = teacher.get(f"/api/v1/admin/recordings/{r.json()['id']}").json()
    assert rec["status"] == "failed" and rec["error"]


def _contains_signs(segments: list[dict], signs: list[tuple[float, float]]) -> bool:
    return len(segments) == len(signs) and all(
        s["start"] <= a + 0.2 and b - 0.2 <= s["end"]
        for s, (a, b) in zip(segments, signs, strict=True)
    )


def test_motion_split_handles_camera_noise(teacher: TestClient, noisy_video: Path) -> None:
    """Camera noise hides the pauses from freezedetect; the motion method still finds them."""
    signs = [(1.5, 2.5), (4.0, 5.0), (6.5, 7.5)]
    rec_id = upload(teacher, noisy_video)
    rec = teacher.get(f"/api/v1/admin/recordings/{rec_id}").json()
    assert rec["status"] == "done" and rec["method"] == "motion"
    assert _contains_signs(rec["segments"], signs), rec["segments"]

    words = [
        teacher.post("/api/v1/admin/words", json={"gloss": g, "year": 1, "lesson": 1}).json()
        for g in ("een", "twee")
    ]
    items = [{**s, "word_id": w["id"]} for s, w in zip(rec["segments"][:2], words, strict=True)]
    teacher.post(f"/api/v1/admin/recordings/{rec_id}/apply", json={"items": items})
    jobs.run_pending()

    # Split again with freezedetect: it finds no pauses, so the whole video is one part.
    r = teacher.post(f"/api/v1/admin/recordings/{rec_id}/split", json={"method": "freeze"})
    assert r.status_code == 202 and r.json()["status"] == "queued"
    jobs.run_pending()
    rec = teacher.get(f"/api/v1/admin/recordings/{rec_id}").json()
    assert rec["status"] == "done" and rec["method"] == "freeze"
    assert len(rec["segments"]) == 1 and rec["segments"][0]["end"] - rec["segments"][0]["start"] > 8
    assert len(rec["applied"]) == 2, "splitting again keeps what was already applied"

    teacher.post(f"/api/v1/admin/recordings/{rec_id}/split", json={"method": "motion"})
    jobs.run_pending()
    rec = teacher.get(f"/api/v1/admin/recordings/{rec_id}").json()
    assert _contains_signs(rec["segments"], signs)


def test_split_again_needs_a_ready_recording(teacher: TestClient, tmp_path: Path) -> None:
    r = teacher.post(
        "/api/v1/admin/recordings", files={"file": ("x.mp4", b"not a video", "video/mp4")}
    )
    rec_id = r.json()["id"]
    assert teacher.post(f"/api/v1/admin/recordings/{rec_id}/split", json={}).status_code == 409


def _profile(pattern: str) -> tuple[list[float], list[float]]:
    """'r' = rest (little motion), 'm' = moving; one letter = 0.5 s, sampled 10 times/s."""
    motion = [{"r": 3.0, "m": 20.0}[c] for c in pattern for _ in range(5)]
    return [round((i + 1) / 10, 1) for i in range(len(motion))], motion


def test_rest_boundaries() -> None:
    # Rest before, between and after two signs: inner edges outside, middle in between.
    times, motion = _profile("rrrmmrrrrmmrrr")
    bounds = rest_boundaries(times, motion, 30)
    assert len(bounds) == 3
    assert 1.0 <= bounds[0] <= 1.6 and 3.0 <= bounds[1] <= 3.6 and 5.0 <= bounds[2] <= 5.8
    # The video starts and ends mid-sign: its first and last moments are boundaries.
    times, motion = _profile("mmrrrrmmrrrrmm")
    bounds = rest_boundaries(times, motion, 30)
    assert bounds[0] == 0.0 and bounds[-1] == times[-1] and len(bounds) == 4
    # Too short to analyse, or no rest at all.
    assert rest_boundaries([0.1, 0.2], [1.0, 2.0], 30) == []


def test_apply_creates_new_words(teacher: TestClient, sample_video: Path) -> None:
    existing = teacher.post(
        "/api/v1/admin/words",
        json={"gloss": "Huis", "year": 2, "lesson": 3, "list_number": "3.1", "position": 4},
    ).json()
    rec_id = upload(teacher, sample_video)
    segs = teacher.get(f"/api/v1/admin/recordings/{rec_id}").json()["segments"]
    url = f"/api/v1/admin/recordings/{rec_id}/apply"
    seg = {"start": segs[0]["start"], "end": segs[0]["end"]}

    # Each item names an existing word or a new gloss, not both and not neither.
    assert teacher.post(url, json={"items": [seg]}).status_code == 422
    both = {**seg, "word_id": existing["id"], "gloss": "x"}
    assert teacher.post(url, json={"items": [both]}).status_code == 422
    # New words need a year; a gloss already on the list is refused (case-insensitive).
    assert teacher.post(url, json={"items": [{**seg, "gloss": "auto"}]}).status_code == 400
    r = teacher.post(
        url, json={"year": 2, "list_number": "3.1", "items": [{**seg, "gloss": " huis "}]}
    )
    assert r.status_code == 409 and "Huis" in r.json()["detail"]
    dup = [{**seg, "gloss": "auto"}, {**seg, "gloss": "Auto"}]
    assert teacher.post(url, json={"year": 2, "lesson": 1, "items": dup}).status_code == 400
    # New words need a lesson: given, or from a list number like "3.1".
    r = teacher.post(
        url, json={"year": 2, "list_number": "extra", "items": [{**seg, "gloss": "x"}]}
    )
    assert r.status_code == 400 and "lesson" in r.json()["detail"]

    items = [
        {**segs[0], "gloss": "auto"},
        {**segs[1], "word_id": existing["id"], "mode": "extra"},
        {**segs[2], "gloss": "fiets"},
    ]
    r = teacher.post(url, json={"year": 2, "list_number": "3.1", "items": items})
    assert r.status_code == 202, r.text
    assert jobs.run_pending() == 3

    words = teacher.get("/api/v1/admin/words", params={"year": 2, "list_number": "3.1"}).json()
    by_gloss = {w["gloss"]: w for w in words}
    assert set(by_gloss) == {"Huis", "auto", "fiets"}
    for gloss, position in (("auto", 5), ("fiets", 6)):
        w = by_gloss[gloss]
        assert w["status"] == "draft" and w["lesson"] == 3 and w["position"] == position
        assert len(w["clips"]) == 1 and w["clips"][0]["is_primary"]
    assert len(by_gloss["Huis"]["clips"]) == 1
    applied = teacher.get(f"/api/v1/admin/recordings/{rec_id}").json()["applied"]
    assert [a["new"] for a in applied] == [True, False, True]
    assert applied[0]["word_id"] == by_gloss["auto"]["id"]
    events = teacher.get(f"/api/v1/admin/words/{by_gloss['auto']['id']}/events").json()
    assert [e["action"] for e in events] == ["clip_add", "create"]

    # Published straight away when asked; no list number is fine. The given lesson wins.
    r = teacher.post(
        url, json={"year": 1, "lesson": 7, "publish": True, "items": [{**seg, "gloss": "boom"}]}
    )
    jobs.run_pending()
    boom = teacher.get("/api/v1/admin/words", params={"q": "boom"}).json()[0]
    assert boom["status"] == "published" and boom["list_number"] is None and boom["lesson"] == 7
