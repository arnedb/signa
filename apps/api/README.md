# vgt API

FastAPI + SQLAlchemy 2.0 + SQLite. See the root README for setup.

```
src/vgt/
  main.py          app factory; serves /api/v1, the docs at /api/docs and the built web app
  config.py        settings from VGT_* environment variables
  models.py        database tables
  schemas.py       request and response models (these become the TypeScript client)
  deps.py          sessions (cookie or Bearer), CSRF header check, role checks
  routers/         one module per area: auth, me, words, media, admin_*
  services/        word changes + audit log + undo, sessions
  jobs.py          database job queue + worker thread (clip uploads, recording sessions)
  media.py         ffmpeg: standard encoding, thumbnails, auto-split (rest detection or freezedetect)
  legacy.py        import of the old app's lexicon.db and videos
  demo.py          demo users, group and words
  cli.py           the `vgt` command
migrations/        Alembic
tests/             pytest (needs ffmpeg on PATH)
```

## Commands

```bash
uv run vgt serve                          # migrate (+ demo data if VGT_SEED_DEMO), then serve
uv run vgt migrate                        # create / upgrade the database
uv run vgt backup [--label x] [--keep n]  # consistent copy of the database
uv run vgt create-admin <username>        # the first admin (asks for a password)
uv run vgt import-legacy lexicon.db videos/ --dry-run
uv run vgt import-legacy lexicon.db videos/ --report import-report.md
uv run vgt demo [--clips folder]          # demo data
uv run vgt openapi > openapi.json
```

## Settings

| Variable | Default | |
|---|---|---|
| `VGT_ENVIRONMENT` | `local` | `dev` or `pro` in the deployments; shown by `/api/v1/health` |
| `VGT_RELEASE` | `local` | git commit, set by the Docker build |
| `VGT_SEED_DEMO` | `false` | demo data into an empty database at startup (refused in `pro`) |
| `VGT_DATABASE_URL` | `sqlite:///./data/vgt.db` | |
| `VGT_BACKUP_DIR`, `VGT_BACKUP_KEEP` | `./data/backups`, `14` | `vgt backup` |
| `VGT_MEDIA_DIR` | `./data/media` | clips, thumbnails, recordings. Never in git |
| `VGT_WEB_DIST` | — | folder with the built web app to serve |
| `VGT_COOKIE_SECURE` | `false` | `true` behind HTTPS |
| `VGT_SESSION_DAYS` | `30` | |
| `VGT_RUN_WORKER` | `true` | run the job worker in the web process |
| `VGT_MAX_UPLOAD_MB` | `2048` | |
| `VGT_VIDEO_HEIGHT`, `VGT_VIDEO_CRF` | `480`, `26` | clip encoding |
| `VGT_SPLIT_METHOD` | `motion` | auto-split: `motion` (rests between signs) or `freeze` (truly still frames) |
| `VGT_SPLIT_REST_PERCENTILE` | `30` | `motion`: the quietest share of the video (%) that sets the rest level |
| `VGT_SPLIT_NOISE`, `VGT_SPLIT_MIN_FREEZE` | `0.003`, `0.6` | `freeze`: noise tolerance, shortest still moment (s) |
| `VGT_SPLIT_MIN_CLIP` | `0.6` | both: shorter parts (s) are dropped |

## Notes

- **Sessions**: login with `client: "web"` sets an httpOnly cookie; `client: "mobile"` returns
  a token for a `Bearer` header. Only a SHA-256 of the token is stored.
- **CSRF**: cookie-authenticated requests that change data must send `X-VGT-Client`. Other
  sites cannot add that header without a CORS preflight, which the API does not allow.
- **Undo**: every word change and clip change is a `word_events` row. Undo applies the reverse
  and marks the event as undone. A field change cannot be undone after a later change to the
  same field (409), so nothing is silently overwritten.
- **Clips are never deleted**: replacing archives the old clip, so a replacement can be undone.
  Trimming (`POST /admin/clips/{id}/trim`) works the same way: a shortened copy takes the
  clip's place (and its primary status) and the original is archived (`clip_trim` event).
- **Auto-split**: `motion` measures the picture change 10 times per second with ffmpeg
  (`tblend` difference + `signalstats`), smooths it over 0.5 s and finds the rests. The threshold
  is the `VGT_SPLIT_REST_PERCENTILE` level plus 20 % of the way to the busy (90th percentile)
  level. Boundaries are the middles of the rests between signs; segments run from one boundary
  to the next. `POST /admin/recordings/{id}/split` splits again (with either method) and keeps
  what was already applied. If that fails, the old segments stay and the error is shown.
- **New words from a recording**: an apply item has `word_id` (existing word) or `gloss` (new
  word on the request's `year` and `list_number`, lesson from the list number, appended after the
  list's last position, draft unless `publish`). A gloss already on that list gives 409.
- **Legacy import**: one word per `(word, year, list_number)`; more rows for the same word add
  extra clips. Lesson = the number before the dot in the list number (`3.2` → lesson 3).
