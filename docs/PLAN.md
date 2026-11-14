# signa: project plan

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
the school and group switcher. The labelling tool of the old app is ported too
(see [From the old labelling tool](#from-the-old-labelling-tool)). What is left is launching the real app (milestone 7),
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
org_members  user_id, org_id, role (student | teacher | admin), last_used_at  -- per school
groups       id, org_id, year, weekday, label, invite_code, active
memberships  user_id, group_id          -- any number, in any of the user's schools
words        id, org_id, gloss, year, lesson, list_number, position, notes,
             status (draft | published), legacy_id, created_by, updated_by, timestamps
word_groups  word_id, group_id          -- none: the word is for every group of its school
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
  stored on the user, so web and mobile agree and the last school used stays chosen after
  logging in again; `PUT /me/context` changes them. When there is a choice, the header shows
  the current school; it opens a full page (`/switch`) to choose another school or group.
  When the user loses access, the school they used most recently (`org_members.last_used_at`)
  is chosen; with one school, that one. Logged-in users join another group, of any school, with its invite link
  (`POST /me/join`).
- **Superadmins** (`signa create-admin`) create and deactivate schools and act as admin in each.
  School admins manage their own members: add an existing account or a new one, change
  roles, remove someone from the school (the account stays). A school always keeps an admin.
  A teacher can reset a student's password, an admin anyone's in the school, except for
  someone who is staff in another school.
- **Languages:** each school teaches one sign language. A school teaching two languages is
  two schools. Each sign language has a spoken language (`languages.locale`: VGT and NGT
  Dutch, LSFB French): the language of its glosses and the default interface language.
- **Interface languages:** Dutch, French and English. The order: the language chosen on the
  account (`users.locale`, `PUT /me/locale`, so web and mobile agree), then the one chosen on
  this device (login page), then the school's spoken language, then the browser's, then
  Dutch. All text lives in `packages/core/src/text*.ts`; the type checker makes every
  language fill in every text. API error messages are English and translated in the app.
  Weekdays are stored as codes (`mon` … `sun`); a new group's default name is made in the
  school's spoken language (“Année 1 · mardi”). Names people typed are never translated.
- `words.position` is the order of a word within its list. `words.legacy_id` keeps the
  `guid` from the old app.
- A student can be in several groups. Moving a student moves them out of one group into
  another; their other groups stay.
- A teacher's memberships are the groups they teach. A teacher who creates a group teaches it,
  and can mark or unmark other groups as taught.

- Words and clips are separate. A new recording becomes the primary clip and the old one
  is archived, so nothing is lost and a replacement can be undone.
- `(year, list_number)` identifies a list, because year 2 reuses numbers like "1.1".
- **Lists per group.** A word is for every group of its school, unless it is limited to some
  groups (`word_groups`). A group practises the shared words and its own. A published word for
  a group replaces, for that group, the shared word with the same gloss on the same list. So
  groups can have a list with the same number but another video for a word (a variant of
  that word for the group) or another set of words (words for one group only). Students only
  see their current group's words: in practice, the dictionary, the catalog and their
  difficult words. Without a group, only the shared words. Teachers see every word in the
  admin, and can filter on a group.
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

- **Words:** edit, draft and publish, history with undo, several clips per word. Limit words
  to groups, one by one or a whole selection at once (“Groepen”); the change is in the history.
- **Trim a clip:** cut the start and/or end off a clip, with draggable start and end handles,
  frame steps and keyboard shortcuts (I/O, ←/→, Space). The shortened copy takes the clip's
  place and the original is archived, so a trim can be undone from the history.
- **Recording sessions:**
  1. Upload a long video.
  2. The app splits it automatically. The default method finds the rests between signs (the
     hands come down): it measures how much the picture changes and uses a threshold that adapts
     to each video, so camera noise and a signer who sways a little do not matter. The other
     method, ffmpeg `freezedetect`, cuts more tightly when the picture is truly still between
     words. The teacher can split again with the other method.
  3. Adjust the cut points on a timeline under the video (S splits at the playhead, Space plays,
     ←/→ steps), or per segment with start and end fields.
  4. Match each segment to an existing word, with suggestions in lesson order and the old and
     new clip side by side, or make it a new word on the chosen year and list. New words are
     drafts unless "publish now" is ticked. A name that is already on that list is refused (choose
     the existing word instead); the same name on another list becomes an extra word.
     When the recording is for some groups, new words are for those groups only, and a name
     matches the word those groups have: a shared word gets a group variant with the new clip.
  5. For existing words, choose whether the new clip replaces the old one or is added as an
     extra clip.

  The teacher's new year 1 recordings come in this way, and so do new lists.
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
  first superadmin is created from the command line (`signa create-admin`), the first school
  with `signa create-org` or in the web app.

## Data and media

- **Legacy import** (`signa import-legacy`, with `--dry-run`, `--draft` and `--report`;
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
- **Backups:** `signa backup` makes a safe copy of the database while the app runs. Every deploy
  makes one first. A daily cron entry on the server adds more (see `docs/DEPLOY.md`).

## From the old labelling tool

The old app had a separate manager (`manager/server.py` in the `vgt` repository) to import,
label and trim videos. Its features now live in `/admin`:

| Old manager | Here |
|---|---|
| Upload a long video, auto-detect the rests between signs (OpenCV motion, 30th percentile) | Recording sessions, split method "rest moments" (`media.detect_motion`). Same idea, measured with ffmpeg so OpenCV is not needed. The threshold sits a little above the quietest 30 %, so a rest is not broken in two by small wobbles. A video that starts or ends while signing keeps its first or last sign |
| Mark split points with S, undo, click a marker to delete it | Timeline with numbered segments, S to split at the playhead, delete or adjust a segment, merge it with the previous or next one (M, Shift+M) |
| Label each segment with a new word on a year and list; skip words that already exist on that list | "New word" per segment (or for all empty segments at once), on the chosen year and list. A duplicate on the same list is refused, a name on another list is shown as an extra word |
| Lexicon tab: change a word's name, year or list | Word editor (with history and undo) |
| Lexicon tab: trim a clip with in/out handles, frame steps and I/O keys | "Trim" on each clip. The trimmed copy is re-encoded with the standard settings, and the original is archived instead of overwritten |
| Delete words and their videos, one by one or in a batch | Not ported: clips are archived, not deleted, and words go back to draft. Nothing is lost by accident |

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
| 6 | Admin: recording sessions (jobs, auto-split, matching to words, replacing clips), plus the old labelling tool: rest-based split, timeline, new words from a recording, trimming clips | Done in code. The new year 1 videos come in after launch. Tune the split on a real class video (`SIGNA_SPLIT_REST_PERCENTILE`) |
| 7 | Launch on `signa.arnedb.be` (PRO): legacy import into PRO, first admin, first release, daily backup cron on the server, announce to the groups | To do. Deploy with backup and rollback is already in place |
| 8 | Portfolio: demo videos as the `demo-media-v1` release asset, public demo, screenshots in the README (the architecture diagram is there), `docs/case-study.md`, accessibility and Lighthouse pass | To do |
| 9 | Mobile (later): Expo app with login, practice and browse, offline clip caching. Publish via EAS to TestFlight and Play internal testing first | To do. API, auth, client and `packages/core` are ready for it (see `apps/mobile/README.md`) |

Milestones 1 to 4 give a usable product. Milestone 6 was the largest.

## Ground rules

- UI text is in Dutch, French and English; code and docs are in English. All UI text lives
  in `packages/core/src/text*.ts`. Dutch (`text.ts`) is the reference: add a text there first,
  then in every other language (the type checker lists what is missing).
- Keyboard-only practice works (space or Enter to reveal, ←/→ to answer, Backspace or z to undo).
- Secrets live only in GitHub secrets and the server `.env`, never in the repository.
- Deploys only happen when CI passes. PRO only gets an image that already ran in DEV.
