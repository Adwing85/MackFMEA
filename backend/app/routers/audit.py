from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import audit
from ..database import get_db
from ..models import AuditLog, User
from ..schemas import AuditPage
from ..security import require_reviewer

router = APIRouter(prefix="/api/audit", tags=["Auditlog"])


@router.get("", response_model=AuditPage)
def list_audit(
    entity_type: str | None = None,
    entity_id: str | None = None,
    action: str | None = None,
    username: str | None = None,
    q: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_reviewer),
):
    stmt = select(AuditLog)
    if entity_type:
        stmt = stmt.where(AuditLog.entity_type == entity_type)
    if entity_id:
        stmt = stmt.where(AuditLog.entity_id == entity_id)
    if action:
        stmt = stmt.where(AuditLog.action.in_(action.split(",")))
    if username:
        stmt = stmt.where(AuditLog.username == username)
    if q:
        stmt = stmt.where(AuditLog.summary.ilike(f"%{q}%"))
    if date_from:
        stmt = stmt.where(AuditLog.timestamp >= date_from)
    if date_to:
        stmt = stmt.where(AuditLog.timestamp <= date_to)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    items = db.scalars(stmt.order_by(AuditLog.id.desc()).limit(limit).offset(offset)).all()
    return AuditPage(total=total, items=items)


@router.get("/verify")
def verify(db: Session = Depends(get_db), _: User = Depends(require_reviewer)):
    """Prüft die Hash-Kette des Auditlogs auf Manipulation."""
    return audit.verify_chain(db)
