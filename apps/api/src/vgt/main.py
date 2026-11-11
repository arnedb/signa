from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.routing import APIRoute

from vgt import __version__
from vgt.config import get_settings
from vgt.jobs import Worker
from vgt.routers import (
    admin_groups,
    admin_orgs,
    admin_users,
    admin_words,
    auth,
    me,
    media,
    recordings,
    words,
)
from vgt.schemas import HealthOut


def _operation_id(route: APIRoute) -> str:
    prefix = "admin_" if "/admin" in route.path else ""
    return f"{prefix}{route.name}"


def build_api() -> APIRouter:
    api = APIRouter(prefix="/api/v1")
    modules = (
        auth,
        me,
        words,
        media,
        admin_words,
        recordings,
        admin_groups,
        admin_users,
        admin_orgs,
    )
    for module in modules:
        api.include_router(module.router)

    @api.get("/health", tags=["meta"], response_model=HealthOut)
    def health() -> HealthOut:
        s = get_settings()
        return HealthOut(
            status="ok", version=__version__, release=s.release, environment=s.environment
        )

    return api


def _mount_web(app: FastAPI, dist: Path) -> None:
    """Serve the built React app. Unknown paths get index.html (client-side routing)."""
    index = dist / "index.html"
    root = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404, "Not found")
        file = (dist / path).resolve()
        if path and root in file.parents and file.is_file():
            cache = (
                "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
            )
            return FileResponse(file, headers={"Cache-Control": cache})
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


def create_app(run_worker: bool | None = None) -> FastAPI:
    settings = get_settings()
    start_worker = settings.run_worker if run_worker is None else run_worker

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        worker = Worker() if start_worker else None
        if worker:
            worker.start()
        yield
        if worker:
            worker.stop()

    app = FastAPI(
        title="vgt-practice API",
        version=__version__,
        lifespan=lifespan,
        generate_unique_id_function=_operation_id,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/v1/openapi.json",
    )
    app.include_router(build_api())
    if settings.web_dist and (settings.web_dist / "index.html").is_file():
        _mount_web(app, settings.web_dist)
    return app


app = create_app()
