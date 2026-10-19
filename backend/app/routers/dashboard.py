from collections import Counter

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Assembly, AuditLog, Classification, Component, FmeaDocument, FmeaRow, User
from ..schemas import AuditOut
from ..security import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("")
def dashboard(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    components = db.scalar(select(func.count()).select_from(Component)) or 0
    current = db.scalars(select(Classification).where(Classification.is_current.is_(True))).all()
    sc_distribution = Counter(c.sc_level for c in current)
    fmea_status = Counter(db.scalars(select(FmeaDocument.status)).all())
    ap = Counter(db.scalars(select(FmeaRow.action_priority).join(FmeaDocument).where(FmeaDocument.status != "ersetzt")).all())
    pending = db.scalars(
        select(FmeaDocument)
        .where(FmeaDocument.status == "in_pruefung")
        .options(selectinload(FmeaDocument.assembly))
        .order_by(FmeaDocument.submitted_at)
    ).all()
    recent_stmt = select(AuditLog).order_by(AuditLog.id.desc()).limit(8)
    if user.role == "konstrukteur":
        recent_stmt = recent_stmt.where(AuditLog.user_id == user.id)
    recent = db.scalars(recent_stmt).all()
    return {
        "assemblies": db.scalar(select(func.count()).select_from(Assembly)) or 0,
        "components": components,
        "classified": len(current),
        "sc_distribution": {f"SC{level}": sc_distribution.get(level, 0) for level in range(5)},
        "fmea_status": dict(fmea_status),
        "action_priority": {k: ap.get(k, 0) for k in ("H", "M", "L")},
        "pending_reviews": [
            {
                "id": d.id,
                "fmea_number": d.fmea_number,
                "version": d.version,
                "assembly_name": d.assembly.name,
                "submitted_at": d.submitted_at,
            }
            for d in pending
        ],
        "recent_activity": [AuditOut.model_validate(a).model_dump() for a in recent],
    }
