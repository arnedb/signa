# One image: FastAPI serves /api/v1, the protected videos and the built React app.

FROM node:22-slim AS web
RUN corepack enable
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/api-client/package.json packages/api-client/
RUN pnpm install --frozen-lockfile --filter "@signa/web..."
COPY packages packages
COPY apps/web apps/web
RUN pnpm --filter @signa/web build

FROM python:3.13-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.11 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/app/venv UV_PYTHON_DOWNLOADS=never
WORKDIR /app/api
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY apps/api ./
RUN uv sync --frozen --no-dev
COPY --from=web /src/apps/web/dist /app/web

# The same image runs in dev and pro; SIGNA_ENVIRONMENT is set by the deployment.
ARG SIGNA_RELEASE=unknown
ENV PATH=/app/venv/bin:$PATH \
    SIGNA_RELEASE=$SIGNA_RELEASE \
    SIGNA_WEB_DIST=/app/web \
    SIGNA_DATABASE_URL=sqlite:////data/signa.db \
    SIGNA_MEDIA_DIR=/data/media \
    SIGNA_BACKUP_DIR=/data/backups \
    SIGNA_COOKIE_SECURE=true
RUN useradd --system --uid 10001 signa && mkdir -p /data && chown signa /data
USER signa
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health')"
CMD ["signa", "serve"]
