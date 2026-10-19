"""Baugruppen, Stücklisten (BOM), Bauteilklassifikation und PDM-Anbindung."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import audit
from ..database import get_db
from ..models import Assembly, Classification, Component, FmeaDocument, FmeaStatus, User
from ..schemas import (
    AssemblyCreate,
    AssemblyDetail,
    AssemblyOut,
    AssemblyUpdate,
    ClassificationIn,
    ClassificationOut,
    ComponentCreate,
    ComponentOut,
    ComponentUpdate,
    PdmImportRequest,
)
from ..security import get_current_user, require_admin, require_designer
from ..serializers import assembly_detail, assembly_out, classification_out, component_out
from ..services import rules
from ..services.bom_import import BomImportError, parse_bom_file
from ..services.pdm import PdmError, get_connector

router = APIRouter(prefix="/api", tags=["Baugruppen"])

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
COMPONENT_FIELDS = ["position", "level", "drawing_number", "name", "name2", "quantity", "unit", "material_pdm", "sort_order"]


def _load_assembly(db: Session, assembly_id: int) -> Assembly:
    assembly = db.scalar(
        select(Assembly)
        .where(Assembly.id == assembly_id)
        .options(
            selectinload(Assembly.components).selectinload(Component.classifications).selectinload(Classification.created_by),
            selectinload(Assembly.created_by),
        )
        .execution_options(populate_existing=True)
    )
    if assembly is None:
        raise HTTPException(status_code=404, detail="Baugruppe nicht gefunden")
    return assembly


def _detail(db: Session, assembly: Assembly) -> AssemblyDetail:
    fmeas = db.scalars(
        select(FmeaDocument)
        .where(FmeaDocument.assembly_id == assembly.id)
        .options(selectinload(FmeaDocument.rows), selectinload(FmeaDocument.created_by), selectinload(FmeaDocument.reviewed_by))
    ).all()
    return assembly_detail(assembly, list(fmeas))


def _create_assembly(db: Session, user: User, meta: dict[str, Any], items: list[dict[str, Any]], source: str) -> Assembly:
    assembly = Assembly(
        drawing_number=meta["drawing_number"],
        name=meta["name"],
        revision=meta.get("revision", ""),
        function=meta.get("function", ""),
        description=meta.get("description", ""),
        source=source,
        pdm_ref=meta.get("pdm_ref", ""),
        created_by_id=user.id,
    )
    db.add(assembly)
    for idx, item in enumerate(items):
        data = {k: v for k, v in item.items() if k in COMPONENT_FIELDS + ["pdm_ref"]}
        if data.get("sort_order") is None:
            data["sort_order"] = idx * 10
        db.add(Component(assembly=assembly, **data))
    db.flush()
    return assembly


@router.get("/assemblies", response_model=list[AssemblyOut])
def list_assemblies(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    assemblies = db.scalars(
        select(Assembly)
        .options(selectinload(Assembly.components).selectinload(Component.classifications), selectinload(Assembly.created_by))
        .order_by(Assembly.updated_at.desc())
    ).all()
    return [assembly_out(a) for a in assemblies]


@router.post("/assemblies", response_model=AssemblyDetail, status_code=201)
def create_assembly(body: AssemblyCreate, db: Session = Depends(get_db), user: User = Depends(require_designer)):
    meta = body.model_dump(exclude={"components"})
    assembly = _create_assembly(db, user, meta, [c.model_dump() for c in body.components], "manuell")
    audit.log(db, user, "CREATE", "assembly", assembly.id, f"Baugruppe {assembly.drawing_number} manuell angelegt", meta)
    db.commit()
    return _detail(db, _load_assembly(db, assembly.id))


@router.post("/assemblies/import", response_model=AssemblyDetail, status_code=201)
async def import_assembly(
    file: UploadFile = File(...),
    drawing_number: str = Form(""),
    name: str = Form(""),
    revision: str = Form(""),
    function: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(require_designer),
):
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Datei zu groß (max. 5 MB)")
    filename = file.filename or "upload.csv"
    try:
        parsed = parse_bom_file(filename, content)
    except BomImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    stem = filename.rsplit(".", 1)[0]
    meta = {
        "drawing_number": drawing_number or parsed.drawing_number or stem,
        "name": name or parsed.name or stem,
        "revision": revision or parsed.revision,
        "function": function,
    }
    assembly = _create_assembly(db, user, meta, parsed.items, parsed.source)
    audit.log(
        db,
        user,
        "IMPORT",
        "assembly",
        assembly.id,
        f"Stückliste {filename} importiert ({len(parsed.items)} Positionen)",
        {**meta, "file": filename, "format": parsed.source, "positions": len(parsed.items)},
    )
    db.commit()
    return _detail(db, _load_assembly(db, assembly.id))


@router.get("/assemblies/{assembly_id}", response_model=AssemblyDetail)
def get_assembly(assembly_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return _detail(db, _load_assembly(db, assembly_id))


@router.put("/assemblies/{assembly_id}", response_model=AssemblyDetail)
def update_assembly(
    assembly_id: int, body: AssemblyUpdate, db: Session = Depends(get_db), user: User = Depends(require_designer)
):
    assembly = _load_assembly(db, assembly_id)
    changes = body.model_dump(exclude_unset=True)
    before = {k: getattr(assembly, k) for k in changes}
    for key, value in changes.items():
        setattr(assembly, key, value)
    audit.log(
        db, user, "UPDATE", "assembly", assembly.id, f"Baugruppe {assembly.drawing_number} geändert", audit.diff(before, changes)
    )
    db.commit()
    return _detail(db, _load_assembly(db, assembly_id))


@router.delete("/assemblies/{assembly_id}", status_code=204)
def delete_assembly(assembly_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    assembly = _load_assembly(db, assembly_id)
    released = db.scalar(
        select(func.count())
        .select_from(FmeaDocument)
        .where(FmeaDocument.assembly_id == assembly_id, FmeaDocument.status == FmeaStatus.FREIGEGEBEN.value)
    )
    if released:
        raise HTTPException(status_code=409, detail="Baugruppe besitzt freigegebene FMEAs und kann nicht gelöscht werden")
    audit.log(
        db,
        admin,
        "DELETE",
        "assembly",
        assembly.id,
        f"Baugruppe {assembly.drawing_number} gelöscht",
        {"drawing_number": assembly.drawing_number, "name": assembly.name, "components": len(assembly.components)},
    )
    db.delete(assembly)
    db.commit()


# ------------------------------------------------------------------ Bauteile


def _component(db: Session, component_id: int) -> Component:
    component = db.scalar(
        select(Component)
        .where(Component.id == component_id)
        .options(selectinload(Component.classifications).selectinload(Classification.created_by))
        .execution_options(populate_existing=True)
    )
    if component is None:
        raise HTTPException(status_code=404, detail="Bauteil nicht gefunden")
    return component


@router.post("/assemblies/{assembly_id}/components", response_model=ComponentOut, status_code=201)
def add_component(assembly_id: int, body: ComponentCreate, db: Session = Depends(get_db), user: User = Depends(require_designer)):
    assembly = _load_assembly(db, assembly_id)
    data = body.model_dump()
    if data.get("sort_order") is None:
        data["sort_order"] = (max((c.sort_order for c in assembly.components), default=0)) + 10
    component = Component(assembly=assembly, **data)
    db.add(component)
    db.flush()
    audit.log(
        db,
        user,
        "CREATE",
        "component",
        component.id,
        f"Bauteil {component.drawing_number} {component.name} zu {assembly.drawing_number} hinzugefügt",
        data,
    )
    db.commit()
    return component_out(_component(db, component.id))


@router.get("/components/{component_id}", response_model=ComponentOut)
def get_component(component_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return component_out(_component(db, component_id))


@router.put("/components/{component_id}", response_model=ComponentOut)
def update_component(
    component_id: int, body: ComponentUpdate, db: Session = Depends(get_db), user: User = Depends(require_designer)
):
    component = _component(db, component_id)
    changes = body.model_dump(exclude_unset=True)
    before = {k: getattr(component, k) for k in changes}
    for key, value in changes.items():
        setattr(component, key, value)
    audit.log(
        db, user, "UPDATE", "component", component.id, f"Bauteil {component.drawing_number} geändert", audit.diff(before, changes)
    )
    db.commit()
    return component_out(_component(db, component_id))


@router.delete("/components/{component_id}", status_code=204)
def delete_component(component_id: int, db: Session = Depends(get_db), user: User = Depends(require_designer)):
    component = _component(db, component_id)
    current = component.current_classification
    audit.log(
        db,
        user,
        "DELETE",
        "component",
        component.id,
        f"Bauteil {component.drawing_number} {component.name} gelöscht",
        {
            "drawing_number": component.drawing_number,
            "name": component.name,
            "classification_versions": len(component.classifications),
            "last_classification": {"sc_level": current.sc_level, "values": current.values} if current else None,
        },
    )
    db.delete(component)
    db.commit()


# ------------------------------------------------------------------ Klassifikation


@router.get("/components/{component_id}/classifications", response_model=list[ClassificationOut])
def classification_history(component_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    component = _component(db, component_id)
    return [classification_out(c) for c in sorted(component.classifications, key=lambda c: c.version, reverse=True)]


@router.post("/components/{component_id}/classifications", response_model=ClassificationOut, status_code=201)
def classify_component(
    component_id: int, body: ClassificationIn, db: Session = Depends(get_db), user: User = Depends(require_designer)
):
    component = _component(db, component_id)
    ruleset = rules.load_ruleset(db)
    try:
        normalized = rules.validate_classification(ruleset, body.values, body.sc_level)
    except rules.ClassificationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors) from exc

    previous = component.current_classification
    sc_changed = previous is not None and previous.sc_level != body.sc_level
    if (body.sc_level >= 2 or sc_changed) and not body.justification.strip():
        raise HTTPException(
            status_code=422,
            detail=["Begründung der SC-Klasse erforderlich (ab SC2 bzw. bei Änderung der SC-Klasse)"],
        )
    # Werte speichern: Einfachauswahl als String, Mehrfachauswahl als Liste
    stored: dict[str, Any] = {}
    for attribute in ruleset.attributes:
        selected = normalized.get(attribute.code, [])
        if not selected:
            continue
        stored[attribute.code] = selected if attribute.multi else selected[0]

    for c in component.classifications:
        c.is_current = False
    classification = Classification(
        component=component,
        version=(max((c.version for c in component.classifications), default=0)) + 1,
        is_current=True,
        designation=body.designation or component.name,
        designation2=body.designation2 or component.name2,
        function=body.function,
        sc_level=body.sc_level,
        values=stored,
        justification=body.justification,
        created_by_id=user.id,
    )
    db.add(classification)
    db.flush()

    after = {
        "sc_level": classification.sc_level,
        "designation": classification.designation,
        "designation2": classification.designation2,
        "function": classification.function,
        "values": stored,
        "justification": classification.justification,
    }
    before = (
        {
            "sc_level": previous.sc_level,
            "designation": previous.designation,
            "designation2": previous.designation2,
            "function": previous.function,
            "values": previous.values,
            "justification": previous.justification,
        }
        if previous
        else {}
    )
    derived = rules.derive_requirements(ruleset, normalized, body.sc_level)
    keys = rules.resolve_keys(ruleset, normalized, body.sc_level)
    audit.log(
        db,
        user,
        "CLASSIFY",
        "component",
        component.id,
        f"{component.drawing_number} {classification.designation}: Klassifikation v{classification.version} – SC{body.sc_level}"
        + (f" (vorher SC{previous.sc_level})" if sc_changed and previous else ""),
        {
            "classification_id": classification.id,
            "version": classification.version,
            "changes": audit.diff(before, after),
            "derived_requirements": [r.code for r in derived],
            "keys": [k.code for k in keys],
        },
    )
    db.commit()
    db.refresh(classification)
    return classification_out(classification)


# ------------------------------------------------------------------ PDM


@router.get("/pdm/status")
def pdm_status(_: User = Depends(get_current_user)):
    try:
        return get_connector().status()
    except PdmError as exc:
        return {"connector": "unbekannt", "connected": False, "message": str(exc)}


@router.get("/pdm/search")
def pdm_search(q: str = "", _: User = Depends(get_current_user)):
    try:
        return [item.as_dict() for item in get_connector().search(q)]
    except PdmError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.get("/pdm/items/{number}")
def pdm_item(number: str, _: User = Depends(get_current_user)):
    try:
        return get_connector().get_item(number).as_dict()
    except PdmError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/pdm/import", response_model=AssemblyDetail, status_code=201)
def pdm_import(body: PdmImportRequest, db: Session = Depends(get_db), user: User = Depends(require_designer)):
    connector = get_connector()
    try:
        bom = connector.get_bom(body.drawing_number)
    except PdmError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    meta = {
        "drawing_number": bom.assembly.number,
        "name": bom.assembly.name or bom.assembly.number,
        "revision": bom.assembly.revision,
        "function": body.function,
        "description": bom.assembly.description,
        "pdm_ref": bom.assembly.pdm_ref,
    }
    assembly = _create_assembly(db, user, meta, bom.items, f"pdm:{connector.name}")
    audit.log(
        db,
        user,
        "IMPORT",
        "assembly",
        assembly.id,
        f"Baugruppe {assembly.drawing_number} aus PDM ({connector.name}) übernommen, {len(bom.items)} Positionen",
        {**meta, "positions": len(bom.items)},
    )
    db.commit()
    return _detail(db, _load_assembly(db, assembly.id))


@router.post("/assemblies/{assembly_id}/pdm-refresh", response_model=AssemblyDetail)
def pdm_refresh(assembly_id: int, db: Session = Depends(get_db), user: User = Depends(require_designer)):
    """Stückliste erneut aus dem PDM abfragen: neue Positionen ergänzen, Stammdaten aktualisieren.
    Klassifikationen bleiben erhalten; entfallene Positionen werden nur gemeldet."""
    assembly = _load_assembly(db, assembly_id)
    try:
        bom = get_connector().get_bom(assembly.drawing_number)
    except PdmError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    existing = {(c.drawing_number, c.position): c for c in assembly.components}
    added, updated = [], []
    seen = set()
    next_sort = max((c.sort_order for c in assembly.components), default=0) + 10
    for item in bom.items:
        key = (item["drawing_number"], item["position"])
        seen.add(key)
        component = existing.get(key)
        if component is None:
            db.add(Component(assembly=assembly, sort_order=next_sort, **item))
            next_sort += 10
            added.append(item["drawing_number"])
            continue
        changes = {
            f: item[f]
            for f in ("name", "name2", "quantity", "unit", "material_pdm", "level", "pdm_ref")
            if getattr(component, f) != item[f]
        }
        for f, v in changes.items():
            setattr(component, f, v)
        if changes:
            updated.append(component.drawing_number)
    removed = [c.drawing_number for k, c in existing.items() if k not in seen]
    audit.log(
        db,
        user,
        "PDM_SYNC",
        "assembly",
        assembly.id,
        f"Stückliste {assembly.drawing_number} aus PDM aktualisiert: {len(added)} neu, {len(updated)} geändert, {len(removed)} entfallen",
        {"added": added, "updated": updated, "removed_in_pdm": removed},
    )
    db.commit()
    db.expire_all()
    return _detail(db, _load_assembly(db, assembly_id))
