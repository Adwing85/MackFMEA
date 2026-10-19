"""FMEA-Generierung, Review-Workflow, Export und PDM-Rückspeicherung."""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import audit
from ..database import get_db
from ..models import (
    Assembly,
    AuditLog,
    Component,
    FmeaDocument,
    FmeaRow,
    FmeaStatus,
    Role,
    User,
    utcnow,
)
from ..schemas import (
    AuditOut,
    FmeaHeaderUpdate,
    FmeaRowOut,
    FmeaRowUpdate,
    FmeaSummary,
    GenerateRequest,
    ReviewDecision,
)
from ..security import get_current_user, require_designer, require_reviewer
from ..serializers import fmea_detail, fmea_summary, row_out
from ..services import fmea_generator, rules
from ..services.export_excel import build_workbook
from ..services.export_pdf import build_pdf
from ..services.pdm import PdmError, get_connector

router = APIRouter(prefix="/api", tags=["FMEA"])

EDITABLE_BY_DESIGNER = {FmeaStatus.ENTWURF.value, FmeaStatus.ABGELEHNT.value}
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _load(db: Session, fmea_id: int) -> FmeaDocument:
    doc = db.scalar(
        select(FmeaDocument)
        .where(FmeaDocument.id == fmea_id)
        .options(
            selectinload(FmeaDocument.rows),
            selectinload(FmeaDocument.requirements),
            selectinload(FmeaDocument.assembly),
            selectinload(FmeaDocument.created_by),
            selectinload(FmeaDocument.reviewed_by),
        )
        .execution_options(populate_existing=True)
    )
    if doc is None:
        raise HTTPException(status_code=404, detail="FMEA nicht gefunden")
    return doc


def _outdated(db: Session, doc: FmeaDocument) -> list[str]:
    """Bauteile, deren Klassifikation sich seit der Generierung geändert hat."""
    snapshot = {c["component_id"]: c["classification_id"] for c in (doc.snapshot or {}).get("components", [])}
    components = db.scalars(
        select(Component).where(Component.assembly_id == doc.assembly_id).options(selectinload(Component.classifications))
    ).all()
    outdated = []
    for component in components:
        current = component.current_classification
        if current is None:
            continue
        if snapshot.get(component.id) != current.id:
            outdated.append(f"{component.drawing_number} {current.designation or component.name}".strip())
    return outdated


def _detail(db: Session, doc: FmeaDocument) -> dict[str, Any]:
    data = fmea_detail(doc).model_dump()
    data["outdated_components"] = _outdated(db, doc) if doc.status not in (FmeaStatus.ERSETZT.value,) else []
    return data


@router.post("/assemblies/{assembly_id}/fmea/generate", status_code=201)
def generate(assembly_id: int, body: GenerateRequest, db: Session = Depends(get_db), user: User = Depends(require_designer)):
    assembly = db.scalar(
        select(Assembly)
        .where(Assembly.id == assembly_id)
        .options(selectinload(Assembly.components).selectinload(Component.classifications))
    )
    if assembly is None:
        raise HTTPException(status_code=404, detail="Baugruppe nicht gefunden")
    try:
        doc = fmea_generator.generate_fmea(db, assembly, user, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    snapshot = doc.snapshot
    audit.log(
        db,
        user,
        "GENERATE",
        "fmea",
        doc.id,
        f"{doc.fmea_number} Version {doc.version} generiert: {len(doc.rows)} Zeilen, {len(doc.requirements)} Anforderungen",
        {
            "assembly": assembly.drawing_number,
            "version": doc.version,
            "ruleset_fingerprint": snapshot["ruleset_fingerprint"],
            "classifications": {c["label"]: f"v{c['classification_version']} SC{c['sc_level']}" for c in snapshot["components"]},
            "ap_counts": snapshot["ap_counts"],
            "warnings": doc.warnings,
            "content_hash": doc.content_hash,
        },
    )
    db.commit()
    return _detail(db, _load(db, doc.id))


@router.get("/fmea", response_model=list[FmeaSummary])
def list_fmea(
    status: str | None = None,
    assembly_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = select(FmeaDocument).options(
        selectinload(FmeaDocument.rows),
        selectinload(FmeaDocument.assembly),
        selectinload(FmeaDocument.created_by),
        selectinload(FmeaDocument.reviewed_by),
    )
    if status:
        stmt = stmt.where(FmeaDocument.status.in_(status.split(",")))
    if assembly_id:
        stmt = stmt.where(FmeaDocument.assembly_id == assembly_id)
    return [fmea_summary(d) for d in db.scalars(stmt.order_by(FmeaDocument.created_at.desc())).all()]


@router.get("/fmea/{fmea_id}")
def get_fmea(fmea_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)) -> dict[str, Any]:
    return _detail(db, _load(db, fmea_id))


@router.put("/fmea/{fmea_id}")
def update_header(fmea_id: int, body: FmeaHeaderUpdate, db: Session = Depends(get_db), user: User = Depends(require_designer)):
    doc = _load(db, fmea_id)
    if doc.status not in EDITABLE_BY_DESIGNER:
        raise HTTPException(status_code=409, detail="Kopfdaten sind nur im Entwurf änderbar")
    changes = body.model_dump(exclude_unset=True)
    before = {k: getattr(doc, k) for k in changes}
    for key, value in changes.items():
        setattr(doc, key, value)
    audit.log(
        db, user, "UPDATE", "fmea", doc.id, f"{doc.fmea_number} V{doc.version}: Kopfdaten geändert", audit.diff(before, changes)
    )
    db.commit()
    return _detail(db, _load(db, fmea_id))


@router.delete("/fmea/{fmea_id}", status_code=204)
def delete_fmea(fmea_id: int, db: Session = Depends(get_db), user: User = Depends(require_designer)):
    doc = _load(db, fmea_id)
    if doc.status not in EDITABLE_BY_DESIGNER:
        raise HTTPException(status_code=409, detail="Nur Entwürfe können gelöscht werden")
    if user.role != Role.ADMIN.value and doc.created_by_id != user.id:
        raise HTTPException(status_code=403, detail="Nur der Ersteller oder ein Admin kann den Entwurf löschen")
    audit.log(
        db,
        user,
        "DELETE",
        "fmea",
        doc.id,
        f"Entwurf {doc.fmea_number} V{doc.version} gelöscht",
        {"version": doc.version, "rows": len(doc.rows), "content_hash": doc.content_hash},
    )
    db.delete(doc)
    db.commit()


@router.put("/fmea/{fmea_id}/rows/{row_id}", response_model=FmeaRowOut)
def update_row(
    fmea_id: int, row_id: int, body: FmeaRowUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    doc = _load(db, fmea_id)
    if doc.status in EDITABLE_BY_DESIGNER:
        allowed = {Role.KONSTRUKTEUR.value, Role.ADMIN.value}
    elif doc.status == FmeaStatus.IN_PRUEFUNG.value:
        allowed = {Role.PRUEFER.value, Role.ADMIN.value}
    else:
        raise HTTPException(status_code=409, detail="Freigegebene bzw. ersetzte FMEAs sind schreibgeschützt")
    if user.role not in allowed:
        raise HTTPException(status_code=403, detail="Keine Berechtigung, diese FMEA im aktuellen Status zu bearbeiten")
    row = db.get(FmeaRow, row_id)
    if row is None or row.document_id != doc.id:
        raise HTTPException(status_code=404, detail="Zeile nicht gefunden")
    changes = body.model_dump(exclude_unset=True, exclude={"change_reason"})
    before = {k: getattr(row, k) for k in fmea_generator.EDITABLE_ROW_FIELDS}
    for key, value in changes.items():
        setattr(row, key, value)
    fmea_generator.recalculate_row(row)
    after = {k: getattr(row, k) for k in fmea_generator.EDITABLE_ROW_FIELDS}
    details = audit.diff(before, after)
    if not details:
        return row_out(row)
    row.manually_edited = True
    doc.content_hash = fmea_generator.compute_content_hash(doc)
    audit.log(
        db,
        user,
        "UPDATE",
        "fmea",
        doc.id,
        f"{doc.fmea_number} V{doc.version}: Zeile {row.focus_element} / {row.failure_mode} bearbeitet (AP {row.action_priority})",
        {"row_id": row.id, "changes": details, "reason": body.change_reason},
    )
    db.commit()
    return row_out(row)


@router.post("/fmea/{fmea_id}/submit")
def submit(fmea_id: int, db: Session = Depends(get_db), user: User = Depends(require_designer)):
    doc = _load(db, fmea_id)
    if doc.status not in EDITABLE_BY_DESIGNER:
        raise HTTPException(status_code=409, detail="Nur Entwürfe können zur Prüfung eingereicht werden")
    doc.status = FmeaStatus.IN_PRUEFUNG.value
    doc.submitted_at = utcnow()
    audit.log(
        db,
        user,
        "SUBMIT",
        "fmea",
        doc.id,
        f"{doc.fmea_number} V{doc.version} zur Prüfung eingereicht",
        {"content_hash": doc.content_hash},
    )
    db.commit()
    return _detail(db, _load(db, fmea_id))


def _approval_blockers(doc: FmeaDocument) -> list[str]:
    blockers = []
    for idx, row in enumerate(doc.rows, start=1):
        if row.action_priority == "H" and not row.opt_responsible.strip():
            blockers.append(
                f"Zeile {idx} ({row.focus_element} / {row.failure_mode}): AP hoch ohne Verantwortlichen für die Optimierung"
            )
    return blockers


@router.post("/fmea/{fmea_id}/approve")
def approve(fmea_id: int, body: ReviewDecision, db: Session = Depends(get_db), user: User = Depends(require_reviewer)):
    doc = _load(db, fmea_id)
    if doc.status != FmeaStatus.IN_PRUEFUNG.value:
        raise HTTPException(status_code=409, detail="Nur FMEAs im Status „In Prüfung“ können freigegeben werden")
    if doc.created_by_id == user.id:
        raise HTTPException(status_code=403, detail="Vier-Augen-Prinzip: Der Ersteller darf die eigene FMEA nicht freigeben")
    blockers = _approval_blockers(doc)
    if blockers:
        raise HTTPException(status_code=422, detail=blockers)
    superseded = db.scalars(
        select(FmeaDocument).where(
            FmeaDocument.assembly_id == doc.assembly_id,
            FmeaDocument.status == FmeaStatus.FREIGEGEBEN.value,
            FmeaDocument.id != doc.id,
        )
    ).all()
    for old in superseded:
        old.status = FmeaStatus.ERSETZT.value
        audit.log(db, user, "SUPERSEDE", "fmea", old.id, f"{old.fmea_number} V{old.version} durch V{doc.version} ersetzt")
    doc.status = FmeaStatus.FREIGEGEBEN.value
    doc.reviewed_by = user
    doc.reviewed_at = utcnow()
    doc.review_comment = body.comment
    doc.content_hash = fmea_generator.compute_content_hash(doc)
    audit.log(
        db,
        user,
        "APPROVE",
        "fmea",
        doc.id,
        f"{doc.fmea_number} V{doc.version} freigegeben",
        {"comment": body.comment, "content_hash": doc.content_hash},
    )
    db.commit()
    return _detail(db, _load(db, fmea_id))


@router.post("/fmea/{fmea_id}/reject")
def reject(fmea_id: int, body: ReviewDecision, db: Session = Depends(get_db), user: User = Depends(require_reviewer)):
    doc = _load(db, fmea_id)
    if doc.status != FmeaStatus.IN_PRUEFUNG.value:
        raise HTTPException(status_code=409, detail="Nur FMEAs im Status „In Prüfung“ können zurückgewiesen werden")
    if not body.comment.strip():
        raise HTTPException(status_code=422, detail="Bitte Begründung für die Zurückweisung angeben")
    doc.status = FmeaStatus.ABGELEHNT.value
    doc.reviewed_by = user
    doc.reviewed_at = utcnow()
    doc.review_comment = body.comment
    audit.log(db, user, "REJECT", "fmea", doc.id, f"{doc.fmea_number} V{doc.version} zurückgewiesen", {"comment": body.comment})
    db.commit()
    return _detail(db, _load(db, fmea_id))


def _filename(doc: FmeaDocument, ext: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{doc.fmea_number}_V{doc.version}")
    return f"{base}.{ext}"


def _export(db: Session, doc: FmeaDocument, fmt: str) -> bytes:
    if fmt == "xlsx":
        return build_workbook(doc, rules.load_ruleset(db))
    return build_pdf(doc)


@router.get("/fmea/{fmea_id}/export.xlsx")
def export_xlsx(fmea_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = _load(db, fmea_id)
    content = _export(db, doc, "xlsx")
    audit.log(db, user, "EXPORT", "fmea", doc.id, f"{doc.fmea_number} V{doc.version} als Excel exportiert")
    db.commit()
    return Response(
        content, media_type=XLSX_MIME, headers={"Content-Disposition": f'attachment; filename="{_filename(doc, "xlsx")}"'}
    )


@router.get("/fmea/{fmea_id}/export.pdf")
def export_pdf(fmea_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = _load(db, fmea_id)
    content = _export(db, doc, "pdf")
    audit.log(db, user, "EXPORT", "fmea", doc.id, f"{doc.fmea_number} V{doc.version} als PDF exportiert")
    db.commit()
    return Response(
        content, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{_filename(doc, "pdf")}"'}
    )


@router.post("/fmea/{fmea_id}/pdm-store")
def store_in_pdm(fmea_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = _load(db, fmea_id)
    if doc.status != FmeaStatus.FREIGEGEBEN.value:
        raise HTTPException(status_code=409, detail="Nur freigegebene FMEAs werden ins PDM zurückgespeichert")
    connector = get_connector()
    metadata = {
        "fmea_number": doc.fmea_number,
        "version": doc.version,
        "status": doc.status,
        "content_hash": doc.content_hash,
        "approved_by": doc.reviewed_by.username if doc.reviewed_by else "",
        "approved_at": doc.reviewed_at,
        "assembly": doc.assembly.drawing_number,
    }
    refs = []
    try:
        for fmt in ("xlsx", "pdf"):
            refs.append(
                connector.store_document(
                    doc.assembly.pdm_ref or doc.assembly.drawing_number, _filename(doc, fmt), _export(db, doc, fmt), metadata
                )
            )
    except PdmError as exc:
        doc.pdm_status = "fehler"
        audit.log(db, user, "PDM_STORE", "fmea", doc.id, f"Rückspeicherung ins PDM fehlgeschlagen: {exc}")
        db.commit()
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    doc.pdm_status = "gespeichert"
    doc.pdm_ref = "; ".join(refs)
    doc.pdm_synced_at = utcnow()
    audit.log(
        db,
        user,
        "PDM_STORE",
        "fmea",
        doc.id,
        f"{doc.fmea_number} V{doc.version} im PDM ({connector.name}) gespeichert",
        {"refs": refs, **metadata},
    )
    db.commit()
    return _detail(db, _load(db, fmea_id))


@router.get("/fmea/{fmea_id}/history", response_model=list[AuditOut])
def history(fmea_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(
        select(AuditLog).where(AuditLog.entity_type == "fmea", AuditLog.entity_id == str(fmea_id)).order_by(AuditLog.id.desc())
    ).all()


def _row_key(row: FmeaRow) -> tuple:
    return (row.component_id, row.failure_mode, row.lower_level)


@router.get("/fmea/{fmea_id}/compare/{other_id}")
def compare(fmea_id: int, other_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Vergleich zweier FMEA-Versionen (other = Basis/ältere Version)."""
    current, base = _load(db, fmea_id), _load(db, other_id)
    if current.assembly_id != base.assembly_id:
        raise HTTPException(status_code=422, detail="Nur Versionen derselben Baugruppe sind vergleichbar")
    fields = (
        "severity",
        "occurrence",
        "detection",
        "action_priority",
        "prevention_controls",
        "detection_controls",
        "failure_cause",
        "failure_effect",
        "special_characteristic",
    )
    base_rows = {_row_key(r): r for r in base.rows}
    current_rows = {_row_key(r): r for r in current.rows}
    added = [row_out(r).model_dump() for k, r in current_rows.items() if k not in base_rows]
    removed = [row_out(r).model_dump() for k, r in base_rows.items() if k not in current_rows]
    changed = []
    for key, row in current_rows.items():
        old = base_rows.get(key)
        if old is None:
            continue
        diff = {f: {"alt": getattr(old, f), "neu": getattr(row, f)} for f in fields if getattr(old, f) != getattr(row, f)}
        if diff:
            changed.append(
                {
                    "focus_element": row.focus_element,
                    "failure_mode": row.failure_mode,
                    "lower_level": row.lower_level,
                    "changes": diff,
                }
            )
    base_reqs = {(r.component_label, r.requirement_code) for r in base.requirements}
    current_reqs = {(r.component_label, r.requirement_code) for r in current.requirements}
    return {
        "base": {"id": base.id, "version": base.version},
        "current": {"id": current.id, "version": current.version},
        "rows_added": added,
        "rows_removed": removed,
        "rows_changed": changed,
        "requirements_added": sorted(f"{label}: {code}" for label, code in current_reqs - base_reqs),
        "requirements_removed": sorted(f"{label}: {code}" for label, code in base_reqs - current_reqs),
        "fingerprint_changed": (base.snapshot or {}).get("ruleset_fingerprint")
        != (current.snapshot or {}).get("ruleset_fingerprint"),
    }
