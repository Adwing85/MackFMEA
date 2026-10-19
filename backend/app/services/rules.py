"""Regelwerk-Engine.

Leitet aus der Bauteilklassifikation (Merkmale + SC-Klasse) automatisch ab:
  * die geltenden Anforderungen an Halbzeug und Bauteil (Regeltabelle `Requirement`),
  * die Schlüssel der Schlüsseltabelle (Merkmal + SC-Klasse → generischer Code),
  * die zugeordneten Prüf- und Sicherungsmaßnahmen aus dem Maßnahmenkatalog.

Das Regelwerk wird pro Anfrage einmal als `RuleSet` geladen und ist danach unabhängig von der DB-Session.
"""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import (
    Attribute,
    AttributeOption,
    KeyEntry,
    KeyMeasure,
    Measure,
    Requirement,
    ScClass,
    Standard,
)

SC_LEVELS = (0, 1, 2, 3, 4)


def key_code(attribute_code: str, option_code: str, sc_level: int) -> str:
    """Generischer Schlüssel je Kombination Merkmal + SC-Klasse, z. B. ``BA-GUSS-SC3``."""
    return f"{attribute_code}-{option_code}-SC{sc_level}"


class ClassificationError(ValueError):
    def __init__(self, errors: list[str]):
        super().__init__("; ".join(errors))
        self.errors = errors


@dataclass
class DerivedMeasure:
    measure: Measure
    extent: str
    rating: int
    key_codes: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.measure.id,
            "code": self.measure.code,
            "title": self.measure.title,
            "measure_type": self.measure.measure_type,
            "rating": self.rating,
            "extent": self.extent,
            "keys": self.key_codes,
        }


@dataclass
class ResolvedKey:
    attribute: Attribute
    option: AttributeOption
    key: KeyEntry | None
    code: str

    def as_dict(self, include_measures: bool = True) -> dict[str, Any]:
        data: dict[str, Any] = {
            "code": self.code,
            "attribute_code": self.attribute.code,
            "attribute_name": self.attribute.name,
            "list_no": self.attribute.list_no,
            "option_code": self.option.code,
            "option_label": self.option.label,
            "exists": self.key is not None,
        }
        if include_measures:
            data["measures"] = [
                {
                    "code": km.measure.code,
                    "title": km.measure.title,
                    "measure_type": km.measure.measure_type,
                    "extent": km.extent,
                    "rating": km.rating or km.measure.rating,
                }
                for km in (self.key.measures if self.key else [])
                if km.measure.active
            ]
        return data


@dataclass
class RuleSet:
    sc_classes: dict[int, ScClass]
    attributes: list[Attribute]
    requirements: list[Requirement]
    keys: dict[tuple[int, int], KeyEntry]
    standards: dict[int, Standard]
    active_options: dict[int, list[AttributeOption]] = field(default_factory=dict)

    def options_of(self, attribute: Attribute) -> list[AttributeOption]:
        return self.active_options.get(attribute.id, [])

    @property
    def attributes_by_code(self) -> dict[str, Attribute]:
        return {a.code: a for a in self.attributes}

    def option(self, attribute_code: str, option_code: str) -> AttributeOption | None:
        attribute = self.attributes_by_code.get(attribute_code)
        if attribute is None:
            return None
        return next((o for o in self.options_of(attribute) if o.code == option_code), None)

    def fingerprint(self) -> str:
        """Hash über den inhaltlichen Stand des Regelwerks – dokumentiert in jeder FMEA."""
        data = {
            "sc": [(s.level, s.default_severity) for s in self.sc_classes.values()],
            "attributes": [
                (
                    a.code,
                    [(o.code, o.failure_cause, o.failure_effect, sorted(o.relevant_damages or [])) for o in self.options_of(a)],
                )
                for a in self.attributes
            ],
            "requirements": [(r.code, r.scope, r.category, r.text, r.sc_min, r.sc_max, r.conditions) for r in self.requirements],
            "keys": sorted(
                (k.code, sorted((km.measure.code, km.extent, km.rating) for km in k.measures if km.measure.active))
                for k in self.keys.values()
                if k.active
            ),
        }
        raw = json.dumps(data, sort_keys=True, ensure_ascii=False, default=str)
        return hashlib.sha256(raw.encode()).hexdigest()


def load_ruleset(db: Session) -> RuleSet:
    attributes = db.scalars(
        select(Attribute)
        .where(Attribute.active.is_(True))
        .options(selectinload(Attribute.options))
        .order_by(Attribute.list_no, Attribute.sort_order, Attribute.id)
    ).all()
    keys = db.scalars(select(KeyEntry).options(selectinload(KeyEntry.measures).selectinload(KeyMeasure.measure))).all()
    requirements = db.scalars(
        select(Requirement)
        .where(Requirement.active.is_(True))
        .options(selectinload(Requirement.standard))
        .order_by(Requirement.scope, Requirement.sort_order, Requirement.code)
    ).all()
    return RuleSet(
        sc_classes={s.level: s for s in db.scalars(select(ScClass).order_by(ScClass.level)).all()},
        attributes=list(attributes),
        requirements=list(requirements),
        keys={(k.option_id, k.sc_level): k for k in keys},
        standards={s.id: s for s in db.scalars(select(Standard)).all()},
        active_options={a.id: [o for o in a.options if o.active] for a in attributes},
    )


# --------------------------------------------------------------------------------------------
# Klassifikation normalisieren und prüfen
# --------------------------------------------------------------------------------------------


def normalize_values(ruleset: RuleSet, values: dict[str, Any] | None) -> dict[str, list[str]]:
    """Wandelt Klassifikationswerte in {Merkmalscode: [Optionscodes]} um (nur bekannte Merkmale)."""
    normalized: dict[str, list[str]] = {}
    for attribute in ruleset.attributes:
        raw = (values or {}).get(attribute.code)
        if raw in (None, "", []):
            normalized[attribute.code] = []
        elif isinstance(raw, str):
            normalized[attribute.code] = [raw]
        else:
            normalized[attribute.code] = [str(v) for v in raw if v not in (None, "")]
    return normalized


def validate_classification(ruleset: RuleSet, values: dict[str, Any], sc_level: int) -> dict[str, list[str]]:
    errors: list[str] = []
    if sc_level not in ruleset.sc_classes:
        errors.append(f"Unbekannte SC-Klasse: {sc_level}")
    normalized = normalize_values(ruleset, values)
    for attribute in ruleset.attributes:
        selected = normalized[attribute.code]
        valid_codes = {o.code for o in ruleset.options_of(attribute)}
        unknown = [c for c in selected if c not in valid_codes]
        if unknown:
            errors.append(f"{attribute.name}: unbekannte Ausprägung(en) {', '.join(unknown)}")
        if attribute.required and not selected:
            errors.append(f"{attribute.name}: Angabe erforderlich")
        if not attribute.multi and len(selected) > 1:
            errors.append(f"{attribute.name}: nur eine Ausprägung zulässig")
    unknown_attrs = set((values or {}).keys()) - set(ruleset.attributes_by_code)
    if unknown_attrs:
        errors.append(f"Unbekannte Merkmale: {', '.join(sorted(unknown_attrs))}")
    if errors:
        raise ClassificationError(errors)
    return normalized


# --------------------------------------------------------------------------------------------
# Ableitung
# --------------------------------------------------------------------------------------------


def conditions_match(conditions: dict[str, list[str]] | None, values: dict[str, list[str]]) -> bool:
    """Alle in der Regel genannten Merkmale müssen mindestens eine der geforderten Ausprägungen haben."""
    for attribute_code, allowed in (conditions or {}).items():
        if not allowed:
            continue
        if not set(values.get(attribute_code, [])) & set(allowed):
            return False
    return True


def derive_requirements(ruleset: RuleSet, values: dict[str, list[str]], sc_level: int) -> list[Requirement]:
    return [r for r in ruleset.requirements if r.sc_min <= sc_level <= r.sc_max and conditions_match(r.conditions, values)]


def resolve_keys(ruleset: RuleSet, values: dict[str, list[str]], sc_level: int) -> list[ResolvedKey]:
    resolved: list[ResolvedKey] = []
    for attribute in ruleset.attributes:
        options = {o.code: o for o in ruleset.options_of(attribute)}
        for code in values.get(attribute.code, []):
            option = options.get(code)
            if option is None:
                continue
            key = ruleset.keys.get((option.id, sc_level))
            if key is not None and not key.active:
                key = None
            resolved.append(ResolvedKey(attribute, option, key, key.code if key else key_code(attribute.code, code, sc_level)))
    return resolved


def merge_measures(keys: list[ResolvedKey]) -> list[DerivedMeasure]:
    """Vereinigt die Maßnahmen mehrerer Schlüssel (dedupliziert, beste Bewertung, Umfänge zusammengeführt)."""
    merged: dict[int, DerivedMeasure] = {}
    for resolved in keys:
        if resolved.key is None:
            continue
        for km in resolved.key.measures:
            if not km.measure.active:
                continue
            rating = km.rating or km.measure.rating
            existing = merged.get(km.measure_id)
            if existing is None:
                merged[km.measure_id] = DerivedMeasure(km.measure, km.extent, rating, [resolved.code])
                continue
            existing.rating = min(existing.rating, rating)
            if km.extent and km.extent not in existing.extent.split(" / "):
                existing.extent = f"{existing.extent} / {km.extent}" if existing.extent else km.extent
            if resolved.code not in existing.key_codes:
                existing.key_codes.append(resolved.code)
    return sorted(merged.values(), key=lambda m: (m.measure.measure_type, m.rating, m.measure.code))


def requirement_dict(r: Requirement) -> dict[str, Any]:
    return {
        "id": r.id,
        "code": r.code,
        "scope": r.scope,
        "category": r.category,
        "text": r.text,
        "sc_min": r.sc_min,
        "sc_max": r.sc_max,
        "standard_code": r.standard.code if r.standard else "",
        "conditions": r.conditions or {},
    }


def preview(ruleset: RuleSet, values: dict[str, Any], sc_level: int) -> dict[str, Any]:
    """Live-Vorschau für das Klassifikationsformular (ohne Validierungsfehler abzubrechen)."""
    normalized = normalize_values(ruleset, values)
    requirements = derive_requirements(ruleset, normalized, sc_level)
    keys = resolve_keys(ruleset, normalized, sc_level)
    measures = merge_measures(keys)
    per_level = []
    for level in SC_LEVELS:
        if level not in ruleset.sc_classes:
            continue
        level_measures = merge_measures(resolve_keys(ruleset, normalized, level))
        level_reqs = derive_requirements(ruleset, normalized, level)
        per_level.append(
            {
                "sc_level": level,
                "requirements": len(level_reqs),
                "halbzeug": sum(1 for r in level_reqs if r.scope == "halbzeug"),
                "bauteil": sum(1 for r in level_reqs if r.scope == "bauteil"),
                "measures": len(level_measures),
            }
        )
    sc = ruleset.sc_classes.get(sc_level)
    return {
        "sc_level": sc_level,
        "sc_class": {
            "code": sc.code,
            "name": sc.name,
            "requirement_level": sc.requirement_level,
            "default_severity": sc.default_severity,
        }
        if sc
        else None,
        "requirements": [requirement_dict(r) for r in requirements],
        "keys": [k.as_dict() for k in keys],
        "measures": [m.as_dict() for m in measures],
        "per_level": per_level,
    }


# --------------------------------------------------------------------------------------------
# Pflege der Schlüsseltabelle
# --------------------------------------------------------------------------------------------


def ensure_keys(db: Session) -> int:
    """Legt fehlende Schlüssel für alle Merkmalsausprägungen × SC-Klassen an. Liefert die Anzahl neuer Schlüssel."""
    levels = [s.level for s in db.scalars(select(ScClass)).all()] or list(SC_LEVELS)
    existing = {(k.option_id, k.sc_level) for k in db.scalars(select(KeyEntry)).all()}
    created = 0
    for option in db.scalars(select(AttributeOption).options(selectinload(AttributeOption.attribute))).all():
        for level in levels:
            if (option.id, level) in existing:
                continue
            db.add(
                KeyEntry(
                    code=key_code(option.attribute.code, option.code, level),
                    option_id=option.id,
                    sc_level=level,
                    description=f"{option.attribute.name}: {option.label} – SC{level}",
                )
            )
            created += 1
    db.flush()
    return created


def consistency_report(ruleset: RuleSet) -> dict[str, Any]:
    """Prüft, dass Anforderungs- und Maßnahmenumfang mit steigender SC-Klasse nicht abnimmt."""
    issues: list[dict[str, Any]] = []
    levels = sorted(ruleset.sc_classes)

    for attribute in ruleset.attributes:
        for option in ruleset.options_of(attribute):
            counts = []
            for level in levels:
                key = ruleset.keys.get((option.id, level))
                counts.append(sum(1 for km in key.measures if km.measure.active) if key and key.active else 0)
            for idx in range(1, len(counts)):
                if counts[idx] < counts[idx - 1]:
                    issues.append(
                        {
                            "type": "schluessel",
                            "ref": f"{attribute.code}-{option.code}",
                            "message": f"{attribute.name} „{option.label}“: Maßnahmenanzahl sinkt von "
                            f"SC{levels[idx - 1]} ({counts[idx - 1]}) auf SC{levels[idx]} ({counts[idx]})",
                            "counts": counts,
                        }
                    )
                    break

    groups: dict[tuple[str, str, str], list[Requirement]] = defaultdict(list)
    for r in ruleset.requirements:
        signature = json.dumps(r.conditions or {}, sort_keys=True)
        groups[(r.scope, r.category, signature)].append(r)
    for (scope, category, signature), reqs in groups.items():
        counts = [sum(1 for r in reqs if r.sc_min <= level <= r.sc_max) for level in levels]
        for idx in range(1, len(counts)):
            if counts[idx] < counts[idx - 1]:
                conditions = json.loads(signature)
                cond_text = " für " + ", ".join(f"{k}={'/'.join(v)}" for k, v in conditions.items()) if conditions else ""
                issues.append(
                    {
                        "type": "anforderung",
                        "ref": f"{scope}/{category}",
                        "message": f"Anforderungen {scope} / {category}{cond_text}: Anzahl sinkt von "
                        f"SC{levels[idx - 1]} ({counts[idx - 1]}) auf SC{levels[idx]} ({counts[idx]})",
                        "counts": counts,
                    }
                )
                break

    totals = []
    for level in levels:
        totals.append(
            {
                "sc_level": level,
                "requirements": sum(1 for r in ruleset.requirements if r.sc_min <= level <= r.sc_max),
                "key_measure_links": sum(
                    sum(1 for km in k.measures if km.measure.active)
                    for (opt_id, lvl), k in ruleset.keys.items()
                    if lvl == level and k.active
                ),
            }
        )
    return {"consistent": not issues, "issues": issues, "totals": totals}
