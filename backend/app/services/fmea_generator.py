"""Automatische FMEA-Generierung.

Prozesskette je Baugruppe:
  1. Baugruppenstruktur (Stückliste/BOM) abfragen
  2. Merkmalsübergabe aus Liste 1 (Merkmale) und Liste 2 (Klassifikation) je Bauteil
  3. Schlüsselgenerierung: Merkmal + SC-Klasse → generischer Code (Schlüsseltabelle)
  4. Maßnahmenableitung: Schlüssel → Prüf- und Sicherungsmaßnahmen aus dem Maßnahmenkatalog
  5. Datenzusammenführung zu FMEA-Zeilen (AIAG & VDA Schritte 2–6) und Anforderungsliste
  6. Ausgabe als versioniertes FMEA-Dokument (Export Excel/PDF separat)

Zeilenbildung: Für jedes Schadensbild (Fehlerart) eines Bauteils entsteht je relevanter Fehlerursache
(aus den gewählten Merkmalsausprägungen) eine Zeile. Liefert kein Merkmal eine passende Ursache, wird die
generische Ursache des Schadensbildes verwendet. Maßnahmen der Zeile stammen aus den Schlüsseln
des Schadensbildes, der Ursache sowie der allgemeinen Merkmale (z. B. Inspizierbarkeit).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import (
    Assembly,
    Attribute,
    AttributeOption,
    Classification,
    Component,
    FmeaDocument,
    FmeaRequirement,
    FmeaRow,
    FmeaStatus,
    MeasureType,
    User,
    utcnow,
)
from .ap import action_priority
from .rules import (
    SC_LEVELS,
    DerivedMeasure,
    ResolvedKey,
    RuleSet,
    derive_requirements,
    load_ruleset,
    merge_measures,
    normalize_values,
    resolve_keys,
)

GENERATOR_VERSION = "1.0"
DEFAULT_OCCURRENCE = 8  # keine Vermeidungsmaßnahme hinterlegt
DEFAULT_DETECTION = 10  # keine Entdeckungsmaßnahme hinterlegt

EDITABLE_ROW_FIELDS = (
    "failure_effect",
    "severity",
    "failure_mode",
    "failure_cause",
    "prevention_controls",
    "occurrence",
    "detection_controls",
    "detection",
    "opt_prevention",
    "opt_detection",
    "opt_responsible",
    "opt_target_date",
    "opt_status",
    "opt_occurrence",
    "opt_detection_rating",
    "remarks",
)


@dataclass
class _ComponentContext:
    component: Component
    classification: Classification
    values: dict[str, list[str]]
    keys: list[ResolvedKey]
    label: str


def component_label(component: Component, classification: Classification | None = None) -> str:
    name = (classification.designation if classification and classification.designation else component.name) or ""
    parts = [p for p in (component.drawing_number, name) if p]
    return " ".join(parts) or f"Pos. {component.position}"


def format_measures(measures: list[DerivedMeasure]) -> str:
    lines = []
    for m in measures:
        extent = f" ({m.extent})" if m.extent else ""
        lines.append(f"{m.measure.code} {m.measure.title}{extent}")
    return "\n".join(lines)


def row_content(row: FmeaRow) -> dict[str, Any]:
    return {
        "component_id": row.component_id,
        "focus_element": row.focus_element,
        "lower_level": row.lower_level,
        "failure_effect": row.failure_effect,
        "severity": row.severity,
        "failure_mode": row.failure_mode,
        "failure_cause": row.failure_cause,
        "prevention_controls": row.prevention_controls,
        "occurrence": row.occurrence,
        "detection_controls": row.detection_controls,
        "detection": row.detection,
        "action_priority": row.action_priority,
        "opt_prevention": row.opt_prevention,
        "opt_detection": row.opt_detection,
        "opt_responsible": row.opt_responsible,
        "opt_target_date": row.opt_target_date,
        "opt_status": row.opt_status,
        "opt_occurrence": row.opt_occurrence,
        "opt_detection_rating": row.opt_detection_rating,
        "opt_action_priority": row.opt_action_priority,
        "remarks": row.remarks,
    }


def compute_content_hash(document: FmeaDocument) -> str:
    data = {
        "number": document.fmea_number,
        "version": document.version,
        "rows": [row_content(r) for r in document.rows],
        "requirements": [(r.component_id, r.requirement_code, r.text) for r in document.requirements],
    }
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def recalculate_row(row: FmeaRow) -> None:
    row.action_priority = action_priority(row.severity, row.occurrence, row.detection)
    if row.opt_occurrence or row.opt_detection_rating:
        row.opt_action_priority = action_priority(
            row.severity, row.opt_occurrence or row.occurrence, row.opt_detection_rating or row.detection
        )
    else:
        row.opt_action_priority = ""


def _parent_map(components: list[Component]) -> dict[int, Component]:
    """Ermittelt die übergeordnete BOM-Position anhand der Strukturstufe (level)."""
    parents: dict[int, Component] = {}
    stack: list[Component] = []
    for component in components:
        while stack and stack[-1].level >= component.level:
            stack.pop()
        if stack:
            parents[component.id] = stack[-1]
        stack.append(component)
    return parents


def _requirement_refs(ruleset: RuleSet, attribute: Attribute, option: AttributeOption, ctx: _ComponentContext) -> list[str]:
    sc = ctx.classification.sc_level
    return [
        r.code
        for r in derive_requirements(ruleset, ctx.values, sc)
        if option.code in (r.conditions or {}).get(attribute.code, [])
    ]


def _suggestions(
    ruleset: RuleSet, ctx: _ComponentContext, row_keys: list[ResolvedKey], current: list[DerivedMeasure]
) -> tuple[list[DerivedMeasure], list[DerivedMeasure]]:
    """Optimierungsvorschläge: wirksamere Maßnahmen derselben Merkmale aus höheren SC-Klassen."""
    sc = ctx.classification.sc_level
    current_ids = {m.measure.id for m in current}
    best_o = min((m.rating for m in current if m.measure.measure_type == MeasureType.VERMEIDUNG.value), default=11)
    best_d = min((m.rating for m in current if m.measure.measure_type == MeasureType.ENTDECKUNG.value), default=11)
    higher: list[ResolvedKey] = []
    for level in SC_LEVELS:
        if level <= sc:
            continue
        for rk in row_keys:
            key = ruleset.keys.get((rk.option.id, level))
            if key is not None and key.active:
                higher.append(ResolvedKey(rk.attribute, rk.option, key, key.code))
    candidates = [m for m in merge_measures(higher) if m.measure.id not in current_ids]
    prevention = [m for m in candidates if m.measure.measure_type == MeasureType.VERMEIDUNG.value and m.rating < best_o]
    detection = [m for m in candidates if m.measure.measure_type == MeasureType.ENTDECKUNG.value and m.rating < best_d]
    return prevention[:3], detection[:3]


def _build_rows(
    ruleset: RuleSet,
    assembly: Assembly,
    ctx: _ComponentContext,
    parent: _ComponentContext | Component | None,
    warnings: list[str],
) -> list[FmeaRow]:
    cls = ctx.classification
    sc = ruleset.sc_classes[cls.sc_level]
    if isinstance(parent, _ComponentContext):
        higher_level = parent.label
        function_higher = parent.classification.function
    elif isinstance(parent, Component):
        higher_level = component_label(parent)
        function_higher = ""
    else:
        higher_level = " ".join(p for p in (assembly.drawing_number, assembly.name) if p)
        function_higher = assembly.function
    focus = ctx.label + (f" / {cls.designation2}" if cls.designation2 else "")

    failure_mode_keys = [k for k in ctx.keys if k.attribute.is_failure_mode]
    cause_keys = [k for k in ctx.keys if not k.attribute.is_failure_mode and k.option.failure_cause]
    general_keys = [k for k in ctx.keys if not k.attribute.is_failure_mode and not k.option.failure_cause]

    if not failure_mode_keys:
        warnings.append(f"{ctx.label}: keine Schadensbilder (Fehlerarten) klassifiziert – keine FMEA-Zeilen erzeugt")
        return []

    rows: list[FmeaRow] = []
    for fm in failure_mode_keys:
        relevant = [k for k in cause_keys if not k.option.relevant_damages or fm.option.code in k.option.relevant_damages]
        causes: list[ResolvedKey | None] = list(relevant)
        if not causes:
            # Rückfallebene: generische Ursache des Schadensbildes selbst
            causes = [None]
            if not fm.option.failure_cause:
                warnings.append(
                    f"{ctx.label}: für Schadensbild „{fm.option.label}“ ist keine Ursache hinterlegt – "
                    "Ursache bitte manuell ergänzen"
                )
        for cause in causes:
            row_keys = [fm] + ([cause] if cause else []) + general_keys
            measures = merge_measures(row_keys)
            prevention = [m for m in measures if m.measure.measure_type == MeasureType.VERMEIDUNG.value]
            detection = [m for m in measures if m.measure.measure_type == MeasureType.ENTDECKUNG.value]
            occurrence = min((m.rating for m in prevention), default=DEFAULT_OCCURRENCE)
            detection_rating = min((m.rating for m in detection), default=DEFAULT_DETECTION)
            if cause:
                refs = _requirement_refs(ruleset, cause.attribute, cause.option, ctx)
                lower_level = f"{cause.attribute.name}: {cause.option.label}"
                function_lower = f"{cause.option.label} gemäß {sc.code}" + (
                    f" ({', '.join(refs)})" if refs else " (Anforderungsliste)"
                )
                failure_cause = cause.option.failure_cause
            else:
                lower_level = f"{fm.attribute.name}: {fm.option.label} (generisch)"
                function_lower = f"Anforderungen gemäß {sc.code} (Anforderungsliste)"
                failure_cause = fm.option.failure_cause or "Keine Ursache hinterlegt – bitte ergänzen"
            effect = fm.option.failure_effect or f"Funktionsverlust {ctx.label}"
            row = FmeaRow(
                component_id=ctx.component.id,
                higher_level=higher_level,
                focus_element=focus,
                lower_level=lower_level,
                function_higher=function_higher or "",
                function_focus=cls.function or "",
                function_lower=function_lower,
                failure_effect=f"{effect} – Auswirkung auf {higher_level}",
                severity=sc.default_severity,
                failure_mode=fm.option.label,
                failure_cause=failure_cause,
                prevention_controls=format_measures(prevention) or "Keine Vermeidungsmaßnahme hinterlegt",
                occurrence=occurrence,
                detection_controls=format_measures(detection) or "Keine Entdeckungsmaßnahme hinterlegt",
                detection=detection_rating,
                special_characteristic=sc.code if cls.sc_level > 0 else "",
                key_codes=[k.code for k in row_keys],
                measure_codes=[m.measure.code for m in measures],
            )
            recalculate_row(row)
            if row.action_priority in ("H", "M"):
                sugg_v, sugg_e = _suggestions(ruleset, ctx, row_keys, measures)
                row.opt_prevention = format_measures(sugg_v)
                row.opt_detection = format_measures(sugg_e)
                row.opt_status = "offen" if row.action_priority == "H" else ""
                row.remarks = (
                    "AP hoch: Maßnahme festlegen oder Begründung dokumentieren"
                    if row.action_priority == "H"
                    else "AP mittel: Maßnahme empfohlen"
                )
            rows.append(row)
    return rows


def generate_fmea(db: Session, assembly: Assembly, user: User, header: dict[str, Any] | None = None) -> FmeaDocument:
    header = header or {}
    ruleset = load_ruleset(db)
    warnings: list[str] = []

    # Schritt 1 – Baugruppenstruktur (BOM)
    components = sorted(assembly.components, key=lambda c: (c.sort_order, c.id))
    parents = _parent_map(components)

    # Schritt 2 + 3 – Merkmalsübergabe und Schlüsselgenerierung
    contexts: dict[int, _ComponentContext] = {}
    skipped: list[dict[str, Any]] = []
    for component in components:
        cls = component.current_classification
        if cls is None:
            skipped.append({"component_id": component.id, "label": component_label(component), "reason": "nicht klassifiziert"})
            warnings.append(f"{component_label(component)}: nicht klassifiziert – nicht in der FMEA enthalten")
            continue
        if cls.sc_level not in ruleset.sc_classes:
            skipped.append({"component_id": component.id, "label": component_label(component), "reason": "SC-Klasse unbekannt"})
            warnings.append(f"{component_label(component)}: SC-Klasse {cls.sc_level} unbekannt")
            continue
        values = normalize_values(ruleset, cls.values)
        keys = resolve_keys(ruleset, values, cls.sc_level)
        missing = [k.code for k in keys if k.key is None]
        if missing:
            warnings.append(f"{component_label(component, cls)}: Schlüssel nicht vorhanden/inaktiv: {', '.join(missing)}")
        contexts[component.id] = _ComponentContext(component, cls, values, keys, component_label(component, cls))

    if not contexts:
        raise ValueError("Keine klassifizierten Bauteile vorhanden – FMEA kann nicht generiert werden")

    next_version = (db.scalar(select(func.max(FmeaDocument.version)).where(FmeaDocument.assembly_id == assembly.id)) or 0) + 1
    document = FmeaDocument(
        assembly_id=assembly.id,
        fmea_number=f"DFMEA-{assembly.drawing_number or assembly.id}",
        version=next_version,
        status=FmeaStatus.ENTWURF.value,
        title=header.get("title") or f"Design-FMEA {assembly.name}",
        team=header.get("team", ""),
        responsible=header.get("responsible") or user.full_name or user.username,
        confidentiality=header.get("confidentiality", "Intern"),
        created_by_id=user.id,
        created_at=utcnow(),
    )

    # Schritt 4 + 5 – Maßnahmenableitung und Datenzusammenführung
    component_snapshots = []
    sort = 0
    req_sort = 0
    for component in components:
        ctx = contexts.get(component.id)
        if ctx is None:
            continue
        parent_component = parents.get(component.id)
        parent: _ComponentContext | Component | None = None
        if parent_component is not None:
            parent = contexts.get(parent_component.id, parent_component)
        rows = _build_rows(ruleset, assembly, ctx, parent, warnings)
        for row in rows:
            sort += 10
            row.sort_order = sort
            document.rows.append(row)

        requirements = derive_requirements(ruleset, ctx.values, ctx.classification.sc_level)
        for req in requirements:
            req_sort += 1
            document.requirements.append(
                FmeaRequirement(
                    component_id=component.id,
                    component_label=ctx.label,
                    sc_level=ctx.classification.sc_level,
                    requirement_code=req.code,
                    standard_code=req.standard.code if req.standard else "",
                    scope=req.scope,
                    category=req.category,
                    text=req.text,
                    sort_order=req_sort,
                )
            )
        measures = merge_measures(ctx.keys)
        component_snapshots.append(
            {
                "component_id": component.id,
                "position": component.position,
                "drawing_number": component.drawing_number,
                "label": ctx.label,
                "classification_id": ctx.classification.id,
                "classification_version": ctx.classification.version,
                "sc_level": ctx.classification.sc_level,
                "liste1": {
                    "bezeichnung": ctx.classification.designation,
                    "bezeichnung2": ctx.classification.designation2,
                    "funktion": ctx.classification.function,
                    **{a.code: ctx.values.get(a.code, []) for a in ruleset.attributes if a.list_no == 1},
                },
                "liste2": {
                    "sc_klasse": f"SC{ctx.classification.sc_level}",
                    **{a.code: ctx.values.get(a.code, []) for a in ruleset.attributes if a.list_no == 2},
                },
                "keys": [k.code for k in ctx.keys],
                "measures": [m.measure.code for m in measures],
                "requirements": [r.code for r in requirements],
                "rows": len(rows),
            }
        )

    ap_counts = {ap: sum(1 for r in document.rows if r.action_priority == ap) for ap in ("H", "M", "L")}
    document.warnings = warnings
    document.snapshot = {
        "generator_version": GENERATOR_VERSION,
        "generated_at": document.created_at.isoformat(),
        "generated_by": user.username,
        "ruleset_fingerprint": ruleset.fingerprint(),
        "assembly": {
            "id": assembly.id,
            "drawing_number": assembly.drawing_number,
            "name": assembly.name,
            "revision": assembly.revision,
            "source": assembly.source,
            "pdm_ref": assembly.pdm_ref,
        },
        "process": [
            {"step": 1, "name": "Abfrage Baugruppenstruktur (BOM)", "result": f"{len(components)} Positionen"},
            {"step": 2, "name": "Merkmalsübergabe Liste 1 / Liste 2", "result": f"{len(contexts)} klassifizierte Bauteile"},
            {
                "step": 3,
                "name": "Schlüsselgenerierung (Merkmal + SC-Klasse)",
                "result": f"{sum(len(c.keys) for c in contexts.values())} Schlüssel",
            },
            {
                "step": 4,
                "name": "Maßnahmenableitung aus Maßnahmenkatalog",
                "result": f"{sum(len(s['measures']) for s in component_snapshots)} Maßnahmenzuordnungen",
            },
            {
                "step": 5,
                "name": "Datenzusammenführung",
                "result": f"{len(document.rows)} FMEA-Zeilen, {len(document.requirements)} Anforderungen",
            },
            {"step": 6, "name": "Ausgabe FMEA-Blatt", "result": f"{document.fmea_number} Version {next_version}"},
        ],
        "ap_counts": ap_counts,
        "components": component_snapshots,
        "skipped": skipped,
    }
    db.add(document)
    db.flush()
    document.content_hash = compute_content_hash(document)
    return document
