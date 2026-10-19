"""Zentrale Konfiguration. Alle Werte sind über Umgebungsvariablen (Präfix MACKFMEA_) einstellbar."""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


def _env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(f"MACKFMEA_{name}", default)


def _env_bool(name: str, default: bool) -> bool:
    value = _env(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "ja", "on"}


def _load_secret(data_dir: Path) -> str:
    """JWT-Secret aus der Umgebung oder persistent im Datenverzeichnis (wird beim ersten Start erzeugt)."""
    explicit = _env("SECRET_KEY")
    if explicit:
        return explicit
    secret_file = data_dir / ".secret_key"
    if secret_file.exists():
        return secret_file.read_text().strip()
    secret = secrets.token_urlsafe(48)
    secret_file.write_text(secret)
    try:
        secret_file.chmod(0o600)
    except OSError:
        pass
    return secret


@dataclass
class Settings:
    data_dir: Path
    database_url: str
    secret_key: str
    token_expire_minutes: int = 8 * 60
    pbkdf2_iterations: int = 600_000
    seed_demo: bool = True
    admin_password: str | None = None
    company_name: str = ""
    frontend_dist: Path = field(default_factory=lambda: REPO_DIR / "frontend" / "dist")
    cors_origins: list[str] = field(default_factory=list)

    # PDM-Anbindung
    pdm_connector: str = "demo"  # demo | keytech
    pdm_store_dir: Path | None = None
    keytech_base_url: str = ""
    keytech_user: str = ""
    keytech_password: str = ""
    keytech_item_path: str = "/elements/{key}"
    keytech_bom_path: str = "/elements/{key}/bom"
    keytech_upload_path: str = "/elements/{key}/files"
    keytech_search_path: str = "/search?q={number}"
    keytech_verify_tls: bool = True


def load_settings() -> Settings:
    data_dir = Path(_env("DATA_DIR", str(BACKEND_DIR / "data"))).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    database_url = _env("DATABASE_URL") or f"sqlite:///{data_dir / 'mackfmea.db'}"
    cors = _env("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173") or ""
    pdm_store = Path(_env("PDM_STORE_DIR", str(data_dir / "pdm_store"))).resolve()
    frontend_dist = Path(_env("FRONTEND_DIST", str(REPO_DIR / "frontend" / "dist"))).resolve()
    return Settings(
        data_dir=data_dir,
        database_url=database_url,
        secret_key=_load_secret(data_dir),
        token_expire_minutes=int(_env("TOKEN_EXPIRE_MINUTES", "480") or 480),
        pbkdf2_iterations=int(_env("PBKDF2_ITERATIONS", "600000") or 600000),
        seed_demo=_env_bool("SEED_DEMO", True),
        admin_password=_env("ADMIN_PASSWORD"),
        company_name=_env("COMPANY_NAME", "") or "",
        frontend_dist=frontend_dist,
        cors_origins=[o.strip() for o in cors.split(",") if o.strip()],
        pdm_connector=(_env("PDM_CONNECTOR", "demo") or "demo").lower(),
        pdm_store_dir=pdm_store,
        keytech_base_url=_env("KEYTECH_BASE_URL", "") or "",
        keytech_user=_env("KEYTECH_USER", "") or "",
        keytech_password=_env("KEYTECH_PASSWORD", "") or "",
        keytech_item_path=_env("KEYTECH_ITEM_PATH", "/elements/{key}") or "/elements/{key}",
        keytech_bom_path=_env("KEYTECH_BOM_PATH", "/elements/{key}/bom") or "/elements/{key}/bom",
        keytech_upload_path=_env("KEYTECH_UPLOAD_PATH", "/elements/{key}/files") or "/elements/{key}/files",
        keytech_search_path=_env("KEYTECH_SEARCH_PATH", "/search?q={number}") or "/search?q={number}",
        keytech_verify_tls=_env_bool("KEYTECH_VERIFY_TLS", True),
    )


settings = load_settings()
