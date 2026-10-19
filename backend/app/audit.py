"""Auditlog mit Hash-Verkettung.

Jeder Eintrag speichert den SHA-256-Hash seines Inhalts inklusive des Hashes des Vorgängers.
Nachträgliche Manipulationen an einzelnen Einträgen werden dadurch bei der Prüfung (verify_chain) erkannt.
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditLog, User, utcnow


def _canonical_ts(ts: datetime) -> str:
    if ts.tzinfo is not None:
        ts = ts.astimezone(UTC).replace(tzinfo=None)
    return ts.isoformat(timespec="microseconds")


def _normalize(details: dict[str, Any] | None) -> dict[str, Any]:
    return json.loads(json.dumps(details or {}, default=str, ensure_ascii=False))


def _compute_hash(entry: AuditLog) -> str:
    payload = {
        "prev": entry.prev_hash,
        "ts": _canonical_ts(entry.timestamp),
        "user_id": entry.user_id,
        "username": entry.username,
        "action": entry.action,
        "entity_type": entry.entity_type,
        "entity_id": entry.entity_id,
        "summary": entry.summary,
        "details": entry.details,
    }
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def log(
    db: Session,
    user: User | None,
    action: str,
    entity_type: str,
    entity_id: Any = "",
    summary: str = "",
    details: dict[str, Any] | None = None,
) -> AuditLog:
    """Neuen Audit-Eintrag anlegen (Commit erfolgt durch den Aufrufer zusammen mit der Fachänderung)."""
    db.flush()
    last = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(1)).first()
    entry = AuditLog(
        timestamp=utcnow(),
        user_id=user.id if user else None,
        username=user.username if user else "system",
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else "",
        summary=summary,
        details=_normalize(details),
        prev_hash=last.hash if last else "",
    )
    entry.hash = _compute_hash(entry)
    db.add(entry)
    db.flush()
    return entry


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Feldweise Differenz zweier Zustände für das Auditlog."""
    changes: dict[str, dict[str, Any]] = {}
    for key in sorted(set(before) | set(after)):
        old, new = before.get(key), after.get(key)
        if old != new:
            changes[key] = {"alt": old, "neu": new}
    return _normalize(changes)


def verify_chain(db: Session) -> dict[str, Any]:
    entries = db.scalars(select(AuditLog).order_by(AuditLog.id)).all()
    prev = ""
    for entry in entries:
        if entry.prev_hash != prev or _compute_hash(entry) != entry.hash:
            return {"valid": False, "checked": len(entries), "first_invalid_id": entry.id}
        prev = entry.hash
    return {"valid": True, "checked": len(entries), "first_invalid_id": None}
