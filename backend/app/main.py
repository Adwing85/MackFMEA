"""FastAPI-Anwendung: REST-API unter /api, gebaute Web-Oberfläche (frontend/dist) unter /."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from . import __version__
from .config import settings
from .database import Base, SessionLocal, engine
from .routers import assemblies, audit, auth, catalog, dashboard, fmea, users
from .seed import seed

logging.basicConfig(level=logging.INFO)


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed(db)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="MackFMEA",
    description="Automatisierte FMEA-Erstellung auf Basis der Bauteilklassifikation (SC0–SC4)",
    version=__version__,
    lifespan=lifespan,
)

if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

for module in (auth, users, catalog, assemblies, fmea, audit, dashboard):
    app.include_router(module.router)
app.include_router(catalog.rules_router)


@app.get("/api/health", tags=["System"])
def health():
    return {"status": "ok", "version": __version__}


@app.get("/api/{path:path}", include_in_schema=False)
def api_not_found(path: str):
    raise HTTPException(status_code=404, detail=f"Unbekannter API-Pfad: /api/{path}")


# ------------------------------------------------------------------ Web-Oberfläche (SPA)

_dist: Path = settings.frontend_dist


@app.get("/{path:path}", include_in_schema=False)
def spa(path: str):
    if not _dist.is_dir():
        return {
            "message": "Frontend nicht gebaut. Bitte `npm run build` im Ordner frontend ausführen "
            "oder den Entwicklungsserver (npm run dev) verwenden.",
            "api_docs": "/docs",
        }
    candidate = (_dist / path).resolve()
    if path and candidate.is_file() and _dist.resolve() in candidate.parents:
        return FileResponse(candidate)
    return FileResponse(_dist / "index.html")
