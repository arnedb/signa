#!/usr/bin/env bash
# Deploy one environment on the server: back up, pull, restart, health check, roll back.
#
#   deploy/deploy.sh <dev|pro> <image>
#   deploy/deploy.sh pro ghcr.io/arnedb/signa:3f2c1ab
#
# Run from the deploy folder, which holds compose.yaml and .env.dev / .env.pro.
set -euo pipefail

env="${1:?usage: deploy.sh <dev|pro> <image>}"
image="${2:?usage: deploy.sh <dev|pro> <image>}"
case "$env" in dev|pro) ;; *) echo "environment must be dev or pro" >&2; exit 2 ;; esac

cd "$(dirname "$0")"
env_file=".env.$env"
[ -f "$env_file" ] || { echo "missing $env_file (see env.$env.example)" >&2; exit 1; }
# Env files from before the rename to Signa use VGT_* names: rename them in place.
sed -i 's/^VGT_/SIGNA_/' "$env_file"
compose=(docker compose -p "signa-$env" --env-file "$env_file" -f compose.yaml)

previous="$(sed -n 's/^SIGNA_IMAGE=//p' "$env_file")"
set_image() { sed -i "s|^SIGNA_IMAGE=.*|SIGNA_IMAGE=$1|" "$env_file"; }

echo "==> $env: $previous -> $image"
# Pull first: if the image cannot be downloaded, nothing on the server has changed yet.
if ! docker pull "$image"; then
  echo "==> cannot pull $image. If the package is private, run 'docker login ghcr.io' as $(whoami)" \
    "with a token that has read:packages, or make the package public (see docs/DEPLOY.md)." >&2
  exit 1
fi

if [ -n "$("${compose[@]}" ps -q signa 2>/dev/null)" ]; then
  echo "==> backing up the database"
  "${compose[@]}" exec -T signa signa backup --label "before-deploy"
fi

set_image "$image"
"${compose[@]}" up -d --remove-orphans

echo "==> waiting for the health check"
container="$("${compose[@]}" ps -q signa)"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$container" 2>/dev/null || echo starting)"
  if [ "$status" = healthy ]; then
    "${compose[@]}" exec -T signa python -c \
      "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health').read().decode())"
    docker image prune -f >/dev/null
    echo "==> $env is running $image"
    exit 0
  fi
  sleep 3
done

echo "==> $env did not become healthy; rolling back to $previous" >&2
"${compose[@]}" logs --tail 50 signa >&2 || true
if [ -n "$previous" ] && [ "$previous" != "$image" ]; then
  set_image "$previous"
  "${compose[@]}" up -d
fi
exit 1
