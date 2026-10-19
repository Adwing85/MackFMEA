"""Admin-Bereich: Regelwerk (SC-Klassen, Merkmalslisten, Werknormen, Regeltabelle,
Maßnahmenkatalog, Schlüsseltabelle). Lesen für alle angemeldeten Benutzer, Schreiben nur für Admins."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .. import audit
from ..database import get_db
from ..models import (
    Attribute,
    AttributeOption,
    KeyEntry,
    KeyMeasure,
    Measure,
    Requirement,
    ScClass,
    Standard,
    User,
)
from ..schemas import (
    AttributeCreate,
    AttributeOut,
    AttributeUpdate,
    KeyMeasureAssign,
    KeyMeasureUpdate,
    KeyOut,
    KeyUpdate,
    MeasureBase,
    MeasureOut,
    MeasureUpdate,
    OptionCreate,
    OptionOut,
    OptionUpdate,
    PreviewRequest,
    RequirementBase,
    RequirementOut,
    RequirementUpdate,
    ScClassOut,
    ScClassUpdate,
    StandardBase,
    StandardOut,
    StandardUpdate,
)
from ..security import get_current_user, require_admin
from ..serializers import key_out, measure_out, requirement_out
from ..services import rules

router = APIRouter(prefix="/api/catalog", tags=["Regelwerk"])
rules_router = APIRouter(prefix="/api/rules", tags=["Regelwerk"])


def _snapshot(obj: Any, fields: list[str]) -> dict[str, Any]:
    return {f: getattr(obj, f) for f in fields}


def _update(db: Session, user: User, obj: Any, changes: dict[str, Any], entity: str, ident: Any, label: str) -> None:
    fields = list(changes)
    before = _snapshot(obj, fields)
    for field, value in changes.items():
        setattr(obj, field, value)
    details = audit.diff(before, _snapshot(obj, fields))
    if details:
        audit.log(db, user, "UPDATE", entity, ident, f"{label} geändert", details)


def _flush(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Eintrag verletzt Eindeutigkeit (Code bereits vorhanden?)") from exc


def _commit(db: Session) -> None:
    _flush(db)
    db.commit()


def _get(db: Session, model: Any, ident: Any, label: str) -> Any:
    obj = db.get(model, ident)
    if obj is None:
        raise HTTPException(status_code=404, detail=f"{label} nicht gefunden")
    return obj


# ------------------------------------------------------------------ SC-Klassen


@router.get("/sc-classes", response_model=list[ScClassOut])
def list_sc_classes(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(select(ScClass).order_by(ScClass.level)).all()


@router.put("/sc-classes/{level}", response_model=ScClassOut)
def update_sc_class(level: int, body: ScClassUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    sc = _get(db, ScClass, level, "SC-Klasse")
    _update(db, admin, sc, body.model_dump(exclude_unset=True), "sc_class", level, f"SC-Klasse {sc.code}")
    _commit(db)
    return sc


# ------------------------------------------------------------------ Merkmale (Liste 1 / Liste 2)


def _validate_damages(db: Session, codes: list[str]) -> None:
    if not codes:
        return
    valid = {
        o.code
        for a in db.scalars(select(Attribute).where(Attribute.is_failure_mode.is_(True)).options(selectinload(Attribute.options)))
        for o in a.options
    }
    unknown = sorted(set(codes) - valid)
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unbekannte Schadensbilder: {', '.join(unknown)}")


@router.get("/attributes", response_model=list[AttributeOut])
def list_attributes(include_inactive: bool = False, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    stmt = select(Attribute).options(selectinload(Attribute.options)).order_by(Attribute.list_no, Attribute.sort_order)
    if not include_inactive:
        stmt = stmt.where(Attribute.active.is_(True))
    attributes = db.scalars(stmt).all()
    result = []
    for a in attributes:
        out = AttributeOut.model_validate(a)
        if not include_inactive:
            out.options = [o for o in out.options if o.active]
        result.append(out)
    return result


@router.post("/attributes", response_model=AttributeOut, status_code=201)
def create_attribute(body: AttributeCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    attribute = Attribute(**body.model_dump())
    db.add(attribute)
    _flush(db)
    audit.log(
        db, admin, "CREATE", "attribute", attribute.id, f"Merkmal {attribute.code} „{attribute.name}“ angelegt", body.model_dump()
    )
    db.commit()
    return attribute


@router.put("/attributes/{attribute_id}", response_model=AttributeOut)
def update_attribute(
    attribute_id: int, body: AttributeUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    attribute = _get(db, Attribute, attribute_id, "Merkmal")
    _update(db, admin, attribute, body.model_dump(exclude_unset=True), "attribute", attribute.id, f"Merkmal {attribute.code}")
    _commit(db)
    return attribute


@router.post("/attributes/{attribute_id}/options", response_model=OptionOut, status_code=201)
def create_option(attribute_id: int, body: OptionCreate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    attribute = _get(db, Attribute, attribute_id, "Merkmal")
    _validate_damages(db, body.relevant_damages)
    option = AttributeOption(attribute=attribute, **body.model_dump())
    db.add(option)
    _flush(db)
    created = rules.ensure_keys(db)
    audit.log(
        db,
        admin,
        "CREATE",
        "attribute_option",
        option.id,
        f"Ausprägung {attribute.code}-{option.code} „{option.label}“ angelegt, {created} Schlüssel erzeugt",
        body.model_dump(),
    )
    db.commit()
    return option


@router.put("/options/{option_id}", response_model=OptionOut)
def update_option(option_id: int, body: OptionUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    option = _get(db, AttributeOption, option_id, "Ausprägung")
    changes = body.model_dump(exclude_unset=True)
    if "relevant_damages" in changes:
        _validate_damages(db, changes["relevant_damages"] or [])
    _update(db, admin, option, changes, "attribute_option", option.id, f"Ausprägung {option.attribute.code}-{option.code}")
    _commit(db)
    return option


# ------------------------------------------------------------------ Werknormen


@router.get("/standards", response_model=list[StandardOut])
def list_standards(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return db.scalars(select(Standard).order_by(Standard.code)).all()


@router.post("/standards", response_model=StandardOut, status_code=201)
def create_standard(body: StandardBase, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    standard = Standard(**body.model_dump())
    db.add(standard)
    _flush(db)
    audit.log(db, admin, "CREATE", "standard", standard.id, f"Werknorm {standard.code} angelegt", body.model_dump())
    db.commit()
    return standard


@router.put("/standards/{standard_id}", response_model=StandardOut)
def update_standard(standard_id: int, body: StandardUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    standard = _get(db, Standard, standard_id, "Werknorm")
    _update(db, admin, standard, body.model_dump(exclude_unset=True), "standard", standard.id, f"Werknorm {standard.code}")
    _commit(db)
    return standard


@router.delete("/standards/{standard_id}", status_code=204)
def delete_standard(standard_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    standard = _get(db, Standard, standard_id, "Werknorm")
    in_use = db.scalar(select(Requirement.id).where(Requirement.standard_id == standard_id).limit(1)) or db.scalar(
        select(Measure.id).where(Measure.standard_id == standard_id).limit(1)
    )
    if in_use:
        raise HTTPException(status_code=409, detail="Werknorm wird noch referenziert – bitte deaktivieren statt löschen")
    audit.log(
        db,
        admin,
        "DELETE",
        "standard",
        standard.id,
        f"Werknorm {standard.code} gelöscht",
        {"code": standard.code, "title": standard.title},
    )
    db.delete(standard)
    db.commit()


# ------------------------------------------------------------------ Regeltabelle (Anforderungen)


def _validate_requirement(db: Session, data: dict[str, Any]) -> None:
    if data.get("sc_min", 0) > data.get("sc_max", 4):
        raise HTTPException(status_code=422, detail="SC min darf nicht größer als SC max sein")
    conditions = data.get("conditions") or {}
    if conditions:
        attrs = {
            a.code: {o.code for o in a.options} for a in db.scalars(select(Attribute).options(selectinload(Attribute.options)))
        }
        for attr_code, option_codes in conditions.items():
            if attr_code not in attrs:
                raise HTTPException(status_code=422, detail=f"Unbekanntes Merkmal in Bedingung: {attr_code}")
            unknown = set(option_codes) - attrs[attr_code]
            if unknown:
                raise HTTPException(
                    status_code=422, detail=f"Unbekannte Ausprägung(en) für {attr_code}: {', '.join(sorted(unknown))}"
                )
    if data.get("standard_id") is not None and db.get(Standard, data["standard_id"]) is None:
        raise HTTPException(status_code=422, detail="Werknorm nicht gefunden")


@router.get("/requirements", response_model=list[RequirementOut])
def list_requirements(
    scope: str | None = None,
    sc_level: int | None = Query(default=None, ge=0, le=4),
    include_inactive: bool = True,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = (
        select(Requirement)
        .options(selectinload(Requirement.standard))
        .order_by(Requirement.scope, Requirement.sort_order, Requirement.code)
    )
    if scope:
        stmt = stmt.where(Requirement.scope == scope)
    if sc_level is not None:
        stmt = stmt.where(Requirement.sc_min <= sc_level, Requirement.sc_max >= sc_level)
    if not include_inactive:
        stmt = stmt.where(Requirement.active.is_(True))
    return [requirement_out(r) for r in db.scalars(stmt).all()]


@router.post("/requirements", response_model=RequirementOut, status_code=201)
def create_requirement(body: RequirementBase, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    data = body.model_dump()
    _validate_requirement(db, data)
    requirement = Requirement(**data)
    db.add(requirement)
    _flush(db)
    audit.log(db, admin, "CREATE", "requirement", requirement.id, f"Anforderung {requirement.code} angelegt", data)
    db.commit()
    return requirement_out(requirement)


@router.put("/requirements/{requirement_id}", response_model=RequirementOut)
def update_requirement(
    requirement_id: int, body: RequirementUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    requirement = _get(db, Requirement, requirement_id, "Anforderung")
    changes = body.model_dump(exclude_unset=True)
    merged = {
        "sc_min": changes.get("sc_min", requirement.sc_min),
        "sc_max": changes.get("sc_max", requirement.sc_max),
        "conditions": changes.get("conditions", requirement.conditions),
        "standard_id": changes.get("standard_id", requirement.standard_id),
    }
    _validate_requirement(db, merged)
    _update(db, admin, requirement, changes, "requirement", requirement.id, f"Anforderung {requirement.code}")
    _commit(db)
    db.refresh(requirement)
    return requirement_out(requirement)


@router.delete("/requirements/{requirement_id}", status_code=204)
def delete_requirement(requirement_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    requirement = _get(db, Requirement, requirement_id, "Anforderung")
    audit.log(
        db,
        admin,
        "DELETE",
        "requirement",
        requirement.id,
        f"Anforderung {requirement.code} gelöscht",
        rules.requirement_dict(requirement),
    )
    db.delete(requirement)
    db.commit()


# ------------------------------------------------------------------ Maßnahmenkatalog


@router.get("/measures", response_model=list[MeasureOut])
def list_measures(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    stmt = select(Measure).options(selectinload(Measure.standard)).order_by(Measure.measure_type.desc(), Measure.code)
    return [measure_out(m) for m in db.scalars(stmt).all()]


@router.post("/measures", response_model=MeasureOut, status_code=201)
def create_measure(body: MeasureBase, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    measure = Measure(**body.model_dump())
    db.add(measure)
    _flush(db)
    audit.log(db, admin, "CREATE", "measure", measure.id, f"Maßnahme {measure.code} angelegt", body.model_dump())
    db.commit()
    db.refresh(measure)
    return measure_out(measure)


@router.put("/measures/{measure_id}", response_model=MeasureOut)
def update_measure(measure_id: int, body: MeasureUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    measure = _get(db, Measure, measure_id, "Maßnahme")
    _update(db, admin, measure, body.model_dump(exclude_unset=True), "measure", measure.id, f"Maßnahme {measure.code}")
    _commit(db)
    db.refresh(measure)
    return measure_out(measure)


@router.delete("/measures/{measure_id}", status_code=204)
def delete_measure(measure_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    measure = _get(db, Measure, measure_id, "Maßnahme")
    if db.scalar(select(KeyMeasure.id).where(KeyMeasure.measure_id == measure_id).limit(1)):
        raise HTTPException(
            status_code=409, detail="Maßnahme ist Schlüsseln zugeordnet – bitte deaktivieren oder Zuordnungen entfernen"
        )
    audit.log(
        db,
        admin,
        "DELETE",
        "measure",
        measure.id,
        f"Maßnahme {measure.code} gelöscht",
        {"code": measure.code, "title": measure.title},
    )
    db.delete(measure)
    db.commit()


# ------------------------------------------------------------------ Schlüsseltabelle


def _key_query():
    return select(KeyEntry).options(
        selectinload(KeyEntry.option).selectinload(AttributeOption.attribute),
        selectinload(KeyEntry.measures).selectinload(KeyMeasure.measure),
    )


@router.get("/keys", response_model=list[KeyOut])
def list_keys(
    attribute_code: str | None = None,
    sc_level: int | None = Query(default=None, ge=0, le=4),
    option_id: int | None = None,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stmt = _key_query().join(KeyEntry.option).join(AttributeOption.attribute)
    if attribute_code:
        stmt = stmt.where(Attribute.code == attribute_code)
    if sc_level is not None:
        stmt = stmt.where(KeyEntry.sc_level == sc_level)
    if option_id is not None:
        stmt = stmt.where(KeyEntry.option_id == option_id)
    stmt = stmt.order_by(Attribute.list_no, Attribute.sort_order, AttributeOption.sort_order, KeyEntry.sc_level)
    return [key_out(k) for k in db.scalars(stmt).all()]


@router.post("/keys/regenerate")
def regenerate_keys(db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    created = rules.ensure_keys(db)
    audit.log(db, admin, "GENERATE", "key_table", "", f"Schlüsseltabelle aktualisiert: {created} neue Schlüssel")
    db.commit()
    return {"created": created}


@router.put("/keys/{key_id}", response_model=KeyOut)
def update_key(key_id: int, body: KeyUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    key = _get(db, KeyEntry, key_id, "Schlüssel")
    _update(db, admin, key, body.model_dump(exclude_unset=True), "key", key.id, f"Schlüssel {key.code}")
    _commit(db)
    return key_out(db.scalars(_key_query().where(KeyEntry.id == key_id)).one())


def _target_keys(db: Session, key: KeyEntry, propagate_up: bool) -> list[KeyEntry]:
    if not propagate_up:
        return [key]
    return list(
        db.scalars(
            select(KeyEntry)
            .where(KeyEntry.option_id == key.option_id, KeyEntry.sc_level >= key.sc_level)
            .order_by(KeyEntry.sc_level)
        ).all()
    )


@router.post("/keys/{key_id}/measures", response_model=KeyOut)
def assign_measure(key_id: int, body: KeyMeasureAssign, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    key = _get(db, KeyEntry, key_id, "Schlüssel")
    measure = _get(db, Measure, body.measure_id, "Maßnahme")
    touched = []
    for target in _target_keys(db, key, body.propagate_up):
        existing = db.scalar(select(KeyMeasure).where(KeyMeasure.key_id == target.id, KeyMeasure.measure_id == measure.id))
        if existing:
            continue
        db.add(KeyMeasure(key_id=target.id, measure_id=measure.id, extent=body.extent, rating=body.rating))
        touched.append(target.code)
    if not touched:
        raise HTTPException(status_code=409, detail="Maßnahme ist bereits zugeordnet")
    audit.log(
        db,
        admin,
        "UPDATE",
        "key",
        key.id,
        f"Maßnahme {measure.code} zugeordnet: {', '.join(touched)}",
        {"measure": measure.code, "keys": touched, "extent": body.extent, "rating": body.rating},
    )
    db.commit()
    return key_out(db.scalars(_key_query().where(KeyEntry.id == key_id)).one())


@router.put("/keys/{key_id}/measures/{measure_id}", response_model=KeyOut)
def update_key_measure(
    key_id: int, measure_id: int, body: KeyMeasureUpdate, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    link = db.scalar(select(KeyMeasure).where(KeyMeasure.key_id == key_id, KeyMeasure.measure_id == measure_id))
    if link is None:
        raise HTTPException(status_code=404, detail="Zuordnung nicht gefunden")
    changes: dict[str, Any] = {}
    if body.extent is not None:
        changes["extent"] = body.extent
    if body.clear_rating:
        changes["rating"] = None
    elif body.rating is not None:
        changes["rating"] = body.rating
    _update(db, admin, link, changes, "key", key_id, f"Zuordnung {link.key.code} → {link.measure.code}")
    db.commit()
    return key_out(db.scalars(_key_query().where(KeyEntry.id == key_id)).one())


@router.delete("/keys/{key_id}/measures/{measure_id}", response_model=KeyOut)
def remove_measure(
    key_id: int, measure_id: int, propagate_up: bool = False, db: Session = Depends(get_db), admin: User = Depends(require_admin)
):
    key = _get(db, KeyEntry, key_id, "Schlüssel")
    removed = []
    for target in _target_keys(db, key, propagate_up):
        link = db.scalar(select(KeyMeasure).where(KeyMeasure.key_id == target.id, KeyMeasure.measure_id == measure_id))
        if link:
            removed.append(target.code)
            db.delete(link)
    if not removed:
        raise HTTPException(status_code=404, detail="Zuordnung nicht gefunden")
    measure = db.get(Measure, measure_id)
    audit.log(
        db,
        admin,
        "UPDATE",
        "key",
        key.id,
        f"Maßnahme {measure.code if measure else measure_id} entfernt: {', '.join(removed)}",
        {"measure_id": measure_id, "keys": removed},
    )
    db.commit()
    db.expire_all()
    return key_out(db.scalars(_key_query().where(KeyEntry.id == key_id)).one())


# ------------------------------------------------------------------ Konsistenz / Export


@router.get("/consistency")
def consistency(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return rules.consistency_report(rules.load_ruleset(db))


@router.get("/export")
def export_ruleset(db: Session = Depends(get_db), _: User = Depends(require_admin)):
    """Vollständiger Regelwerksstand als JSON (Sicherung / Übertragung zwischen Umgebungen)."""
    ruleset = rules.load_ruleset(db)
    attributes = db.scalars(
        select(Attribute).options(selectinload(Attribute.options)).order_by(Attribute.list_no, Attribute.sort_order)
    )
    requirements = db.scalars(select(Requirement).options(selectinload(Requirement.standard)).order_by(Requirement.code))
    measures = db.scalars(select(Measure).options(selectinload(Measure.standard)).order_by(Measure.code))
    keys = db.scalars(_key_query().order_by(KeyEntry.code))
    return {
        "fingerprint": ruleset.fingerprint(),
        "sc_classes": [ScClassOut.model_validate(s).model_dump() for s in ruleset.sc_classes.values()],
        "attributes": [AttributeOut.model_validate(a).model_dump() for a in attributes],
        "standards": [StandardOut.model_validate(s).model_dump() for s in db.scalars(select(Standard).order_by(Standard.code))],
        "requirements": [requirement_out(r).model_dump() for r in requirements],
        "measures": [measure_out(m).model_dump() for m in measures],
        "keys": [key_out(k).model_dump() for k in keys],
    }


# ------------------------------------------------------------------ Vorschau Anforderungsableitung


@rules_router.post("/preview")
def preview(body: PreviewRequest, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return rules.preview(rules.load_ruleset(db), body.values, body.sc_level)
