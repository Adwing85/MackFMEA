import os
import sys
import tempfile
from pathlib import Path

import pytest

_TMP = tempfile.mkdtemp(prefix="mackfmea-test-")
os.environ["MACKFMEA_DATA_DIR"] = _TMP
os.environ["MACKFMEA_DATABASE_URL"] = f"sqlite:///{Path(_TMP) / 'test.db'}"
os.environ["MACKFMEA_PBKDF2_ITERATIONS"] = "1000"
os.environ["MACKFMEA_SEED_DEMO"] = "true"
os.environ["MACKFMEA_FRONTEND_DIST"] = str(Path(_TMP) / "no-dist")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed(db)
    yield


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def login(client: TestClient, username: str, password: str | None = None) -> dict[str, str]:
    response = client.post("/api/auth/login", json={"username": username, "password": password or username})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def designer(client):
    return login(client, "konstrukteur")


@pytest.fixture
def reviewer(client):
    return login(client, "pruefer")


@pytest.fixture
def admin(client):
    return login(client, "admin")
