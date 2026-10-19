"""Exportiert Musterregelwerk und Demodaten (app/seed.py) für die Browser-Version.

Aufruf (aus dem Ordner backend):
    .venv/bin/python scripts/export_standalone_seed.py ../frontend/src/standalone/seed.json

Die Browser-Version (frontend, `npm run build:standalone`) startet mit genau diesem Datenbestand.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("MACKFMEA_DATA_DIR", tempfile.mkdtemp(prefix="mackfmea-seed-"))
os.environ.setdefault("MACKFMEA_PBKDF2_ITERATIONS", "1000")
os.environ["MACKFMEA_SEED_DEMO"] = "true"

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import selectinload  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.main import init_db  # noqa: E402
from app.models import (  # noqa: E402
    Assembly,
    Attribute,
    Component,
    KeyEntry,
    Measure,
    Requirement,
    ScClass,
    Standard,
    User,
)
from app.services.pdm import DEMO_DATA_FILE  # noqa: E402


def ts(value: datetime | None) -> str | None:
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def main(target: Path) -> None:
    init_db()
    with SessionLocal() as db:
        data = {
            "users": [
                {
                    "id": u.id,
                    "username": u.username,
                    "full_name": u.full_name,
                    "email": u.email,
                    "role": u.role,
                    "is_active": u.is_active,
                    "created_at": ts(u.created_at),
                }
                for u in db.scalars(select(User).order_by(User.id))
            ],
            "sc_classes": [
                {
                    "level": s.level,
                    "code": s.code,
                    "name": s.name,
                    "requirement_level": s.requirement_level,
                    "description": s.description,
                    "default_severity": s.default_severity,
                    "color": s.color,
                }
                for s in db.scalars(select(ScClass).order_by(ScClass.level))
            ],
            "attributes": [
                {
                    "id": a.id,
                    "code": a.code,
                    "name": a.name,
                    "list_no": a.list_no,
                    "multi": a.multi,
                    "required": a.required,
                    "is_failure_mode": a.is_failure_mode,
                    "description": a.description,
                    "sort_order": a.sort_order,
                    "active": a.active,
                    "options": [
                        {
                            "id": o.id,
                            "attribute_id": a.id,
                            "code": o.code,
                            "label": o.label,
                            "description": o.description,
                            "failure_cause": o.failure_cause,
                            "failure_effect": o.failure_effect,
                            "relevant_damages": list(o.relevant_damages or []),
                            "sort_order": o.sort_order,
                            "active": o.active,
                        }
                        for o in a.options
                    ],
                }
                for a in db.scalars(select(Attribute).options(selectinload(Attribute.options)).order_by(Attribute.id))
            ],
            "standards": [
                {
                    "id": s.id,
                    "code": s.code,
                    "title": s.title,
                    "revision": s.revision,
                    "description": s.description,
                    "active": s.active,
                }
                for s in db.scalars(select(Standard).order_by(Standard.id))
            ],
            "requirements": [
                {
                    "id": r.id,
                    "code": r.code,
                    "standard_id": r.standard_id,
                    "scope": r.scope,
                    "category": r.category,
                    "text": r.text,
                    "sc_min": r.sc_min,
                    "sc_max": r.sc_max,
                    "conditions": r.conditions or {},
                    "sort_order": r.sort_order,
                    "active": r.active,
                }
                for r in db.scalars(select(Requirement).order_by(Requirement.id))
            ],
            "measures": [
                {
                    "id": m.id,
                    "code": m.code,
                    "title": m.title,
                    "description": m.description,
                    "measure_type": m.measure_type,
                    "rating": m.rating,
                    "standard_id": m.standard_id,
                    "active": m.active,
                }
                for m in db.scalars(select(Measure).order_by(Measure.id))
            ],
            "keys": [
                {
                    "id": k.id,
                    "code": k.code,
                    "option_id": k.option_id,
                    "sc_level": k.sc_level,
                    "description": k.description,
                    "active": k.active,
                    "measures": [{"measure_id": km.measure_id, "extent": km.extent, "rating": km.rating} for km in k.measures],
                }
                for k in db.scalars(select(KeyEntry).options(selectinload(KeyEntry.measures)).order_by(KeyEntry.id))
            ],
            "assemblies": [],
            "components": [],
        }
        for a in db.scalars(select(Assembly).order_by(Assembly.id)):
            data["assemblies"].append(
                {
                    "id": a.id,
                    "drawing_number": a.drawing_number,
                    "name": a.name,
                    "revision": a.revision,
                    "function": a.function,
                    "description": a.description,
                    "source": a.source,
                    "pdm_ref": a.pdm_ref,
                    "created_by_id": a.created_by_id,
                    "created_at": ts(a.created_at),
                    "updated_at": ts(a.updated_at),
                }
            )
        components = db.scalars(
            select(Component)
            .options(selectinload(Component.classifications))
            .order_by(Component.assembly_id, Component.sort_order)
        )
        for c in components:
            data["components"].append(
                {
                    "id": c.id,
                    "assembly_id": c.assembly_id,
                    "position": c.position,
                    "level": c.level,
                    "drawing_number": c.drawing_number,
                    "name": c.name,
                    "name2": c.name2,
                    "quantity": c.quantity,
                    "unit": c.unit,
                    "material_pdm": c.material_pdm,
                    "pdm_ref": c.pdm_ref,
                    "sort_order": c.sort_order,
                    "classifications": [
                        {
                            "id": cl.id,
                            "component_id": c.id,
                            "version": cl.version,
                            "is_current": cl.is_current,
                            "designation": cl.designation,
                            "designation2": cl.designation2,
                            "function": cl.function,
                            "sc_level": cl.sc_level,
                            "values": cl.values,
                            "justification": cl.justification,
                            "created_by_id": cl.created_by_id,
                            "created_at": ts(cl.created_at),
                        }
                        for cl in c.classifications
                    ],
                }
            )
    data["pdm"] = json.loads(DEMO_DATA_FILE.read_text(encoding="utf-8"))
    target.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{target}: {sum(len(v) for k, v in data.items() if isinstance(v, list))} Datensätze")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else BACKEND.parent / "frontend" / "src" / "standalone" / "seed.json"))
