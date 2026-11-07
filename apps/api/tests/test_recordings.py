from pathlib import Path

from fastapi.testclient import TestClient

from vgt import jobs


def test_recording_session(teacher: TestClient, sample_video: Path) -> None:
    words = [
        teacher.post(
            "/api/v1/admin/words", json={"gloss": g, "year": 1, "list_number": "1.1", "position": i}
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
