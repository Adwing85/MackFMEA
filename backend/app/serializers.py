"""Umwandlung ORM → API-Schemas."""

from __future__ import annotations

from .models import (
    Assembly,
    Classification,
    Component,
    FmeaDocument,
    FmeaRow,
    KeyEntry,
    Measure,
    Requirement,
)
from .schemas import (
    AssemblyDetail,
    AssemblyOut,
    ClassificationOut,
    ComponentOut,
    FmeaDetail,
    FmeaRequirementOut,
    FmeaRowOut,
    FmeaSummary,
    KeyMeasureOut,
    KeyOut,
    MeasureOut,
    RequirementOut,
)


def classification_out(c: Classification | None) -> ClassificationOut | None:
    if c is None:
        return None
    out = ClassificationOut.model_validate(c)
    out.created_by_name = c.created_by.username if c.created_by else ""
    return out


def component_out(c: Component) -> ComponentOut:
    data = ComponentOut.model_validate(c)
    data.classification = classification_out(c.current_classification)
    return data


def assembly_out(a: Assembly) -> AssemblyOut:
    out = AssemblyOut.model_validate(a)
    out.created_by_name = a.created_by.username if a.created_by else ""
    out.component_count = len(a.components)
    out.classified_count = sum(1 for c in a.components if c.current_classification is not None)
    return out


def fmea_summary(d: FmeaDocument) -> FmeaSummary:
    return FmeaSummary(
        id=d.id,
        fmea_number=d.fmea_number,
        version=d.version,
        status=d.status,
        title=d.title,
        created_at=d.created_at,
        created_by=d.created_by.username if d.created_by else "",
        reviewed_by=d.reviewed_by.username if d.reviewed_by else "",
        rows=len(d.rows),
        ap_counts={ap: sum(1 for r in d.rows if r.action_priority == ap) for ap in ("H", "M", "L")},
        assembly_id=d.assembly_id,
        assembly_name=d.assembly.name if d.assembly else "",
        assembly_drawing_number=d.assembly.drawing_number if d.assembly else "",
    )


def assembly_detail(a: Assembly, fmeas: list[FmeaDocument]) -> AssemblyDetail:
    base = assembly_out(a)
    return AssemblyDetail(
        **base.model_dump(),
        components=[component_out(c) for c in sorted(a.components, key=lambda c: (c.sort_order, c.id))],
        fmeas=[fmea_summary(d) for d in sorted(fmeas, key=lambda d: d.version, reverse=True)],
    )


def row_out(r: FmeaRow) -> FmeaRowOut:
    out = FmeaRowOut.model_validate(r)
    out.rpn = r.severity * r.occurrence * r.detection
    return out


def fmea_detail(d: FmeaDocument) -> FmeaDetail:
    return FmeaDetail(
        id=d.id,
        assembly_id=d.assembly_id,
        assembly_name=d.assembly.name if d.assembly else "",
        assembly_drawing_number=d.assembly.drawing_number if d.assembly else "",
        fmea_number=d.fmea_number,
        version=d.version,
        status=d.status,
        title=d.title,
        team=d.team,
        responsible=d.responsible,
        confidentiality=d.confidentiality,
        created_at=d.created_at,
        created_by=d.created_by.username if d.created_by else "",
        created_by_id=d.created_by_id,
        submitted_at=d.submitted_at,
        reviewed_by=d.reviewed_by.username if d.reviewed_by else "",
        reviewed_at=d.reviewed_at,
        review_comment=d.review_comment,
        snapshot=d.snapshot or {},
        warnings=d.warnings or [],
        content_hash=d.content_hash,
        pdm_status=d.pdm_status,
        pdm_ref=d.pdm_ref,
        pdm_synced_at=d.pdm_synced_at,
        rows=[row_out(r) for r in d.rows],
        requirements=[FmeaRequirementOut.model_validate(r) for r in d.requirements],
    )


def key_out(k: KeyEntry) -> KeyOut:
    return KeyOut(
        id=k.id,
        code=k.code,
        option_id=k.option_id,
        attribute_code=k.option.attribute.code,
        option_code=k.option.code,
        option_label=k.option.label,
        sc_level=k.sc_level,
        description=k.description,
        active=k.active,
        measures=[
            KeyMeasureOut(
                measure_id=km.measure_id,
                code=km.measure.code,
                title=km.measure.title,
                measure_type=km.measure.measure_type,
                extent=km.extent,
                rating=km.rating,
                effective_rating=km.rating or km.measure.rating,
            )
            for km in k.measures
        ],
    )


def measure_out(m: Measure) -> MeasureOut:
    out = MeasureOut.model_validate(m)
    out.standard_code = m.standard.code if m.standard else ""
    return out


def requirement_out(r: Requirement) -> RequirementOut:
    out = RequirementOut.model_validate(r)
    out.standard_code = r.standard.code if r.standard else ""
    return out
