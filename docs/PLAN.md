# vgt-practice: project plan

A practice tool for students of Flemish Sign Language (VGT) in evening classes.
It replaces the earlier `vgt` app, and is rebuilt from scratch.

## Goals

- One app and one deployment, used by students, teachers and admins.
- Simple practice: no streaks, no points, no scheduling algorithm. Modern, but plain.
- Reuse the videos that are already labelled, and replace them gradually with the
  teacher's new recordings.
- Accounts linked to groups. A group is a course year plus a weekday, for example
  "Jaar 1 · dinsdag". There are no cohorts.
- Several schools in one deployment. Each school (organisation) has its own words, groups,
  recordings and members, and teaches one sign language. Nothing is ever shared between
  schools. A school can later move to its own deployment for a hard boundary.
- Several teachers can manage the word list, and every change is recorded.
- Web first. Android and iOS apps come later, but the design supports them from day 1.
- The code is open source. The class videos are never in the repository.
- Polished enough to serve as a portfolio project.

## Status (2026-11-11)

Milestones 1 to 6 are built and merged, and so are schools (organisations), languages and
the school and group switcher. What is left is launching the real app (milestone 7),
the portfolio work (milestone 8) and the mobile app (milestone 9). See [Milestones](#milestones).

## Stack

| Part | Choice |
|---|---|
| API | FastAPI, Pydantic v2, SQLAlchemy 2.0 + Alembic, SQLite, argon2-cffi, ffmpeg for video. Tooling: `uv`, ruff, pyright, pytest |
| Web | React 19, Vite, TypeScript, TanStack Router, TanStack Query, Tailwind CSS v4 + shadcn/ui (accessible Radix components). Tests: Vitest, Playwright |
| API client | Generated from the FastAPI OpenAPI schema (`openapi-typescript` + `openapi-fetch`), so web and mobile share the same types |
| Mobile (later) | Expo (React Native) with Expo Router, reusing the API client and the shared logic |
| Deploy | One container. FastAPI serves `/api/v1`, the protected videos (with range requests) and the built React app, `/admin` included. A worker thread in the same process runs the video jobs. Traefik sits in front. Two environments, DEV and PRO, run the same image (see `docs/DEPLOY.md`) |

## Built with mobile in mind from day 1

Monorepo layout:

```
apps/api              FastAPI
apps/web              React (students + /admin)
apps/mobile           Expo, placeholder until the mobile milestone
packages/api-client   generated TypeScript client
packages/core         shared TypeScript logic: deck building, practice session state, UI text (nl)
```

- **Auth for both clients.** The web app gets an httpOnly session cookie. The mobile app
  gets the same session token in a `Bearer` header. Login returns one or the other,
  depending on the client.
- **Versioned API** (`/api/v1`) from the start, so older app versions keep working after updates.
- **Practice logic lives in `packages/core`**, not in React components, so the mobile app
  reuses it unchanged.
- **Video** is progressive MP4 (H.264, `+faststart`) with fixed encoding settings. It plays
  on web, iOS and Android without a streaming server. `clips.updated_at` lets the mobile app
  cache clips offline later.

## Data model

```
languages    code (vgt | lsfb | ngt | …), name
organisations id, name, slug, language_code, active, created_at   -- a school
users        id, username, password_hash, recovery_hash, is_superadmin,
             current_org_id, current_group_id, created_at, last_active_at
org_members  user_id, org_id, role (student | teacher | admin)    -- role per school
groups       id, org_id, year, weekday, label, invite_code, active
memberships  user_id, group_id          -- any number, in any of the user's schools
words        id, org_id, gloss, year, lesson, list_number, position, notes,
             status (draft | published), legacy_id, created_by, updated_by, timestamps
clips        id, word_id, file, duration, thumb, source (legacy | recording | demo),
             recorded_at, is_primary, archived, created_at, updated_at
word_events  id, word_id, user_id, action, diff_json, undone, at   -- audit log for words
group_events id, org_id, user_id, from_group_id, to_group_id, by_user_id, at
results      id, user_id, word_id, direction (w2s | s2w), correct, at
sessions     token_hash, user_id, client (web | mobile), expires_at
jobs         id, org_id, kind (transcode | split), status (queued | running | done | failed),
             payload, result, error, created_by, timestamps
```

- **Schools are separate.** Every request runs in the user's current school
  (`current_org_id`), checked again on each request. Words, groups, recordings, jobs and
  group moves of another school are not found (404), and answers for another school's words
  are ignored. Clips are served to members of the clip's school only.
- **One account, several schools and groups.** A role is per school (`org_members`): someone
  can be a teacher in one school and a student in another. The current school and group are
  stored on the user, so web and mobile agree; `PUT /me/context` changes them, and a
  switcher in the header shows when there is a choice. When the user loses access, a valid
  default is chosen. Logged-in users join another group, of any school, with its invite link
  (`POST /me/join`).
- **Superadmins** (`vgt create-admin`) create and deactivate schools and act as admin in each.
  School admins manage their own members: add an existing account or a new one, change
  roles, remove someone from the school (the account stays). A school always keeps an admin.
  A teacher can reset a student's password, an admin anyone's in the school, except for
  someone who is staff in another school.
- **Languages:** each school teaches one sign language. A school teaching two languages is
  two schools. UI text is still Dutch only.
- `words.position` is the order of a word within its list. `words.legacy_id` keeps the
  `guid` from the old app.
- A student can be in several groups. Moving a student moves them out of one group into
  another; their other groups stay.
- A teacher's memberships are the groups they teach. A teacher who creates a group teaches it,
  and can mark or unmark other groups as taught.

- Words and clips are separate. A new recording becomes the primary clip and the old one
  is archived, so nothing is lost and a replacement can be undone.
- `(year, list_number)` identifies a list, because year 2 reuses numbers like "1.1".
- Progress is a plain log of results. "Mijn moeilijke woorden" means the words whose last
  answer was wrong.
- Privacy: no email and no real name. A username, a password and a one-time recovery code.

## Features

### Students

- Join through a group invite link, then log in. Recovery is by a one-time code. A logged-in
  user can make a new recovery code in the profile (the old one stops working).
- Practise by year, lesson or list, in one direction (word → sign, sign → word) or mixed,
  optionally with a limited number of words. Answer "Kende ik" / "Kende ik niet", with undo
  for the last answer. At the end, repeat the words you missed.
- Browse and search the dictionary, with all clips of a word.
- "Mijn moeilijke woorden": practise only the words you got wrong.
- Profile: change your password, download your data, delete your account.
- Students cannot leave or change their group; only a teacher moves them. With another
  invite link they join one more group, also of another school, with the same account.

### Teachers (`/admin`)

- **Words:** edit, draft and publish, history with undo, several clips per word.
- **Recording sessions:**
  1. Upload a long video.
  2. The app splits it automatically with ffmpeg `freezedetect`. The teacher can adjust the cut points.
  3. Match each clip to an existing word, with suggestions in lesson order and the old and
     new clip side by side.
  4. Choose whether the new clip replaces the old one or is added as an extra clip.

  The teacher's new year 1 recordings come in this way.
- **Groups:** create a group, mark which groups you teach, rotate its invite link, list its
  members, reset a password.
- **Moving students (teachers and admins):** move selected students to another group, or move a
  whole group at the start of the school year, for example "Jaar 1 · dinsdag → Jaar 2 · dinsdag".
  Every move is recorded.
- No view of individual students' results.

### Admins

- School admins manage the school's members and their roles: add an existing account, or
  create one with a temporary password.
- Superadmins manage the schools (create, rename, deactivate) and are admin in each. The
  first superadmin is created from the command line (`vgt create-admin`), the first school
  with `vgt create-org` or in the web app.

## Data and media

- **Legacy import** (`vgt import-legacy`, with `--dry-run`, `--draft` and `--report`;
  `apps/api/scripts/import_legacy.py` is a wrapper around it): reads the old `lexicon.db`
  (`guid, word, year, list_number, video_file`) and its MP4 files. It creates one word per
  `(word, year, list_number)`, converts the videos to the standard encoding, makes thumbnails,
  keeps each old `guid` as `legacy_id`, and writes a report of anything that did not import
  cleanly. Try it in DEV or on a copy before running it in PRO. Old progress (stored only in each student's browser) is not carried over.
- **Class videos** live in a volume on the server, outside the repository. They are only
  served to logged-in users.
- **Demo media:** about 20 words recorded by the project author, published as a GitHub
  release asset rather than committed, so the repository stays small. `make demo` downloads
  them and fills a demo database. Without the release asset, `make demo` uses generated test
  clips. The public demo instance uses only the real demo videos.
- **Backups:** `vgt backup` makes a safe copy of the database while the app runs. Every deploy
  makes one first. A daily cron entry on the server adds more (see `docs/DEPLOY.md`).

## Licensing

- **Code:** AGPL-3.0 (see `LICENSE`). Anyone may use and change it. Anyone who runs a changed
  version, also as a hosted website, must publish their source under the same license.
- **Demo videos:** CC BY-NC-ND 4.0, noted with the release asset.
- **Class videos:** not included and not licensed. They belong to the teacher or school.

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Monorepo setup: uv + pnpm workspaces, FastAPI and React skeletons, client generated from OpenAPI, Docker image, CI (lint, types, tests, e2e, image smoke test), automatic deploy to DEV | Done |
| 2 | Accounts, groups, roles, invite links, recovery codes, admin CLI, profile with export and delete | Done |
| 3 | Words and clips, legacy import, browse and search, protected video streaming | Done in code. Still to do: try the import on a copy of the real data |
| 4 | Practice (`packages/core` + web UI), results, "Mijn moeilijke woorden" | Done |
| 5 | Admin: word editing, audit log with undo, single clip upload, group management including moving students | Done |
| 6 | Admin: recording sessions (jobs, auto-split, matching to words, replacing clips) | Done in code. The new year 1 videos come in after launch |
| 7 | Launch on `vgt.arnedb.be` (PRO): legacy import into PRO, first admin, first release, daily backup cron on the server, announce to the groups | To do. Deploy with backup and rollback is already in place |
| 8 | Portfolio: demo videos as the `demo-media-v1` release asset, public demo, screenshots in the README (the architecture diagram is there), `docs/case-study.md`, accessibility and Lighthouse pass | To do |
| 9 | Mobile (later): Expo app with login, practice and browse, offline clip caching. Publish via EAS to TestFlight and Play internal testing first | To do. API, auth, client and `packages/core` are ready for it (see `apps/mobile/README.md`) |

Milestones 1 to 4 give a usable product. Milestone 6 was the largest.

## Ground rules

- UI text is in Dutch, code and docs are in English. All UI text lives in one place so a
  translation can be added later.
- Keyboard-only practice works (space or Enter to reveal, ←/→ to answer, Backspace or z to undo).
- Secrets live only in GitHub secrets and the server `.env`, never in the repository.
- Deploys only happen when CI passes. PRO only gets an image that already ran in DEV.
