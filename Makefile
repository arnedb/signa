.PHONY: install dev api web test lint typecheck build api-client docker demo e2e deploy-dev deploy-pro

DEMO_URL ?= https://github.com/arnedb/signa/releases/download/demo-media-v1/demo-media.tar.gz

install:
	cd apps/api && uv sync
	pnpm install

api:
	cd apps/api && uv run signa migrate && uv run uvicorn signa.main:app --reload --port 8000

web:
	pnpm dev

dev:
	@echo "Run 'make api' and 'make web' in two terminals, then open http://localhost:5173"

lint:
	cd apps/api && uv run ruff check . && uv run ruff format --check .
	pnpm lint

typecheck:
	cd apps/api && uv run pyright
	pnpm typecheck

test:
	cd apps/api && uv run pytest
	pnpm test

build:
	pnpm build

e2e: build
	pnpm --filter @signa/web e2e

# Regenerate the TypeScript client after changing the API.
api-client:
	pnpm api-client

docker:
	docker build --build-arg SIGNA_RELEASE=$$(git rev-parse HEAD) -t signa .

# Start the Deploy workflow on GitHub (needs the gh CLI). REF defaults to the latest main.
REF ?=
deploy-dev:
	gh workflow run deploy.yml -f environment=dev $(if $(REF),-f ref=$(REF))

deploy-pro:
	gh workflow run deploy.yml -f environment=pro $(if $(REF),-f ref=$(REF))

# Download the demo videos (release asset, CC BY-NC-ND 4.0) and fill a demo database.
# Without the download, generated test clips are used.
demo:
	mkdir -p data/demo-media
	curl -fsSL "$(DEMO_URL)" | tar -xz -C data/demo-media || echo "Demo media not available; using generated clips."
	cd apps/api && uv run signa demo --clips ../../data/demo-media
