#!/usr/bin/env bash
# Start the API with a fresh demo database for the end-to-end tests. Needs `pnpm build` first.
set -euo pipefail
port="${1:-8765}"
web_dist="$(cd "$(dirname "$0")/.." && pwd)/dist"
tmp="$(mktemp -d)"
export SIGNA_DATABASE_URL="sqlite:///$tmp/e2e.db" SIGNA_MEDIA_DIR="$tmp/media" SIGNA_WEB_DIST="$web_dist"
cd "$(dirname "$0")/../../api"
uv run signa demo
exec uv run uvicorn signa.main:app --host 127.0.0.1 --port "$port"
