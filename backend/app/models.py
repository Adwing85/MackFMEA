"""Datenmodell.

Fachliche Struktur:
  * Stammdaten/Regelwerk (Admin):   ScClass, Attribute + AttributeOption (Liste 1/2), Standard (Werknorm),
                                     Requirement (Regeltabelle), Measure (Maßnahmenkatalog),
                                     KeyEntry + KeyMeasure (Schlüsseltabelle)
  * Bauteildaten (Konstrukteur):     Assembly (Baugruppe), Component (BOM-Position), Classification (versioniert)
  * Ergebnis:                        FmeaDocument (versioniert) mit FmeaRow und FmeaRequirement
  * Nachvollziehbarkeit:             AuditLog (Hash-Kette)
"""

from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


class Role(StrEnum):
    KONSTRUKTEUR = "konstrukteur"
    PRUEFER = "pruefer"
    ADMIN = "admin"


class FmeaStatus(StrEnum):
    ENTWURF = "entwurf"
    IN_PRUEFUNG = "in_pruefung"
    FREIGEGEBEN = "freigegeben"
    ABGELEHNT = "abgelehnt"
    ERSETZT = "ersetzt"


class MeasureType(StrEnum):
    VERMEIDUNG = "V"  # Vermeidungsmaßnahme (Prevention Control)
    ENTDECKUNG = "E"  # Entdeckungsmaßnahme (Detection Control)


class Scope(StrEnum):
    HALBZEUG = "halbzeug"
    BAUTEIL = "bauteil"


# --------------------------------------------------------------------------------------------
# Benutzer
# --------------------------------------------------------------------------------------------


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(128), default="")
    email: Mapped[str] = mapped_column(String(128), default="")
    role: Mapped[str] = mapped_column(String(20), default=Role.KONSTRUKTEUR.value)
    password_hash: Mapped[str] = mapped_column(String(256))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


# --------------------------------------------------------------------------------------------
# Regelwerk / Stammdaten
# --------------------------------------------------------------------------------------------


class ScClass(Base):
    """Safety-Characteristic-Klasse SC0–SC4."""

    __tablename__ = "sc_classes"

    level: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    code: Mapped[str] = mapped_column(String(8), unique=True)
    name: Mapped[str] = mapped_column(String(128))
    requirement_level: Mapped[str] = mapped_column(String(256))
    description: Mapped[str] = mapped_column(Text, default="")
    default_severity: Mapped[int] = mapped_column(Integer, default=5)
    color: Mapped[str] = mapped_column(String(16), default="#888888")


class Attribute(Base):
    """Merkmal (z. B. Bauteilart, Material, Schaden). list_no 1 = Merkmale, 2 = Klassifikation."""

    __tablename__ = "attributes"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    list_no: Mapped[int] = mapped_column(Integer, default=2)
    multi: Mapped[bool] = mapped_column(Boolean, default=False)
    required: Mapped[bool] = mapped_column(Boolean, default=True)
    is_failure_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    options: Mapped[list[AttributeOption]] = relationship(
        back_populates="attribute",
        order_by="AttributeOption.sort_order",
        cascade="all, delete-orphan",
    )


class AttributeOption(Base):
    """Ausprägung eines Merkmals. Liefert optional Fehlerursache bzw. Fehlerfolge für die FMEA."""

    __tablename__ = "attribute_options"
    __table_args__ = (UniqueConstraint("attribute_id", "code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    attribute_id: Mapped[int] = mapped_column(ForeignKey("attributes.id", ondelete="CASCADE"))
    code: Mapped[str] = mapped_column(String(16))
    label: Mapped[str] = mapped_column(String(256))
    description: Mapped[str] = mapped_column(Text, default="")
    # Fehlerursache, die diese Ausprägung in die FMEA einbringt (leer = keine eigene Ursachenzeile)
    failure_cause: Mapped[str] = mapped_column(Text, default="")
    # Fehlerfolge (nur für Schadensbilder / Fehlerarten)
    failure_effect: Mapped[str] = mapped_column(Text, default="")
    # Für welche Schadensbilder (Codes) die Ursache relevant ist. Leer = alle.
    relevant_damages: Mapped[list[str]] = mapped_column(JSON, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    attribute: Mapped[Attribute] = relationship(back_populates="options")
    keys: Mapped[list[KeyEntry]] = relationship(back_populates="option", cascade="all, delete-orphan")


class Standard(Base):
    """Werknorm bzw. referenzierte Norm."""

    __tablename__ = "standards"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True)
    title: Mapped[str] = mapped_column(String(256))
    revision: Mapped[str] = mapped_column(String(32), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Requirement(Base):
    """Regeltabelle: Anforderung an Halbzeug oder Bauteil, gültig ab SC-Klasse sc_min (bis sc_max)."""

    __tablename__ = "requirements"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    standard_id: Mapped[int | None] = mapped_column(ForeignKey("standards.id", ondelete="SET NULL"))
    scope: Mapped[str] = mapped_column(String(16), default=Scope.BAUTEIL.value)
    category: Mapped[str] = mapped_column(String(64))
    text: Mapped[str] = mapped_column(Text)
    sc_min: Mapped[int] = mapped_column(Integer, default=0)
    sc_max: Mapped[int] = mapped_column(Integer, default=4)
    # Anwendbarkeitsbedingungen {Merkmalscode: [Optionscodes]} – alle Merkmale müssen zutreffen
    conditions: Mapped[dict[str, list[str]]] = mapped_column(JSON, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    standard: Mapped[Standard | None] = relationship()


class Measure(Base):
    """Maßnahmenkatalog: Prüf- (Entdeckung) und Sicherungsmaßnahmen (Vermeidung)."""

    __tablename__ = "measures"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(32), unique=True)
    title: Mapped[str] = mapped_column(String(256))
    description: Mapped[str] = mapped_column(Text, default="")
    measure_type: Mapped[str] = mapped_column(String(1), default=MeasureType.VERMEIDUNG.value)
    # Bewertung, die die Maßnahme erreicht: Auftreten (A) bei Vermeidung, Entdeckung (E) bei Entdeckung
    rating: Mapped[int] = mapped_column(Integer, default=5)
    standard_id: Mapped[int | None] = mapped_column(ForeignKey("standards.id", ondelete="SET NULL"))
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    standard: Mapped[Standard | None] = relationship()


class KeyEntry(Base):
    """Schlüsseltabelle: generischer Code je Kombination Merkmal(-ausprägung) + SC-Klasse."""

    __tablename__ = "key_entries"
    __table_args__ = (UniqueConstraint("option_id", "sc_level"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    option_id: Mapped[int] = mapped_column(ForeignKey("attribute_options.id", ondelete="CASCADE"))
    sc_level: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    option: Mapped[AttributeOption] = relationship(back_populates="keys")
    measures: Mapped[list[KeyMeasure]] = relationship(
        back_populates="key", cascade="all, delete-orphan", order_by="KeyMeasure.id"
    )


class KeyMeasure(Base):
    """Zuordnung Schlüssel → Maßnahme inkl. SC-abhängigem Umfang/Tiefe."""

    __tablename__ = "key_measures"
    __table_args__ = (UniqueConstraint("key_id", "measure_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    key_id: Mapped[int] = mapped_column(ForeignKey("key_entries.id", ondelete="CASCADE"))
    measure_id: Mapped[int] = mapped_column(ForeignKey("measures.id", ondelete="CASCADE"))
    extent: Mapped[str] = mapped_column(String(256), default="")
    rating: Mapped[int | None] = mapped_column(Integer, nullable=True)  # überschreibt Measure.rating

    key: Mapped[KeyEntry] = relationship(back_populates="measures")
    measure: Mapped[Measure] = relationship()


# --------------------------------------------------------------------------------------------
# Baugruppen / Bauteile / Klassifikation
# --------------------------------------------------------------------------------------------


class Assembly(Base):
    __tablename__ = "assemblies"

    id: Mapped[int] = mapped_column(primary_key=True)
    drawing_number: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(256))
    revision: Mapped[str] = mapped_column(String(32), default="")
    function: Mapped[str] = mapped_column(Text, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(32), default="manuell")  # manuell | csv | xml | pdm:<name>
    pdm_ref: Mapped[str] = mapped_column(String(128), default="")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    components: Mapped[list[Component]] = relationship(
        back_populates="assembly", cascade="all, delete-orphan", order_by="Component.sort_order"
    )
    created_by: Mapped[User | None] = relationship()


class Component(Base):
    """BOM-Position (Bauteil) einer Baugruppe."""

    __tablename__ = "components"

    id: Mapped[int] = mapped_column(primary_key=True)
    assembly_id: Mapped[int] = mapped_column(ForeignKey("assemblies.id", ondelete="CASCADE"), index=True)
    position: Mapped[str] = mapped_column(String(32), default="")
    level: Mapped[int] = mapped_column(Integer, default=1)
    drawing_number: Mapped[str] = mapped_column(String(64), default="")
    name: Mapped[str] = mapped_column(String(256))
    name2: Mapped[str] = mapped_column(String(256), default="")
    quantity: Mapped[float] = mapped_column(Float, default=1.0)
    unit: Mapped[str] = mapped_column(String(16), default="Stk")
    material_pdm: Mapped[str] = mapped_column(String(128), default="")
    pdm_ref: Mapped[str] = mapped_column(String(128), default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    assembly: Mapped[Assembly] = relationship(back_populates="components")
    classifications: Mapped[list[Classification]] = relationship(
        back_populates="component", cascade="all, delete-orphan", order_by="Classification.version"
    )

    @property
    def current_classification(self) -> Classification | None:
        current = [c for c in self.classifications if c.is_current]
        return current[-1] if current else None


class Classification(Base):
    """Bauteilklassifikation durch den Konstrukteur. Jede Änderung erzeugt eine neue Version."""

    __tablename__ = "classifications"
    __table_args__ = (UniqueConstraint("component_id", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    component_id: Mapped[int] = mapped_column(ForeignKey("components.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    # Liste 1 – Merkmale (Freitext); Inspizierbarkeit/Schaden stecken in values
    designation: Mapped[str] = mapped_column(String(256), default="")
    designation2: Mapped[str] = mapped_column(String(256), default="")
    function: Mapped[str] = mapped_column(Text, default="")
    # Liste 2 – Klassifikation
    sc_level: Mapped[int] = mapped_column(Integer, default=0)
    # {Merkmalscode: Optionscode | [Optionscodes]}
    values: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    justification: Mapped[str] = mapped_column(Text, default="")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    component: Mapped[Component] = relationship(back_populates="classifications")
    created_by: Mapped[User | None] = relationship()


# --------------------------------------------------------------------------------------------
# FMEA
# --------------------------------------------------------------------------------------------


class FmeaDocument(Base):
    __tablename__ = "fmea_documents"
    __table_args__ = (UniqueConstraint("assembly_id", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    assembly_id: Mapped[int] = mapped_column(ForeignKey("assemblies.id", ondelete="CASCADE"), index=True)
    fmea_number: Mapped[str] = mapped_column(String(64), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default=FmeaStatus.ENTWURF.value)
    title: Mapped[str] = mapped_column(String(256), default="")
    team: Mapped[str] = mapped_column(Text, default="")
    responsible: Mapped[str] = mapped_column(String(128), default="")
    confidentiality: Mapped[str] = mapped_column(String(64), default="Intern")
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_comment: Mapped[str] = mapped_column(Text, default="")
    # Eingangsdaten + Regelwerksstand zum Generierungszeitpunkt (Rückverfolgbarkeit)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    warnings: Mapped[list[str]] = mapped_column(JSON, default=list)
    content_hash: Mapped[str] = mapped_column(String(64), default="")
    pdm_status: Mapped[str] = mapped_column(String(32), default="")
    pdm_ref: Mapped[str] = mapped_column(String(256), default="")
    pdm_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    assembly: Mapped[Assembly] = relationship()
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_id])
    reviewed_by: Mapped[User | None] = relationship(foreign_keys=[reviewed_by_id])
    rows: Mapped[list[FmeaRow]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="FmeaRow.sort_order"
    )
    requirements: Mapped[list[FmeaRequirement]] = relationship(
        back_populates="document", cascade="all, delete-orphan", order_by="FmeaRequirement.sort_order"
    )


class FmeaRow(Base):
    """Eine Zeile des FMEA-Formblatts (AIAG & VDA, Schritte 2–6)."""

    __tablename__ = "fmea_rows"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("fmea_documents.id", ondelete="CASCADE"), index=True)
    component_id: Mapped[int | None] = mapped_column(ForeignKey("components.id", ondelete="SET NULL"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    # Schritt 2 – Strukturanalyse
    higher_level: Mapped[str] = mapped_column(String(256), default="")
    focus_element: Mapped[str] = mapped_column(String(256), default="")
    lower_level: Mapped[str] = mapped_column(String(256), default="")
    # Schritt 3 – Funktionsanalyse
    function_higher: Mapped[str] = mapped_column(Text, default="")
    function_focus: Mapped[str] = mapped_column(Text, default="")
    function_lower: Mapped[str] = mapped_column(Text, default="")
    # Schritt 4 – Fehleranalyse
    failure_effect: Mapped[str] = mapped_column(Text, default="")
    severity: Mapped[int] = mapped_column(Integer, default=1)
    failure_mode: Mapped[str] = mapped_column(Text, default="")
    failure_cause: Mapped[str] = mapped_column(Text, default="")
    # Schritt 5 – Risikoanalyse
    prevention_controls: Mapped[str] = mapped_column(Text, default="")
    occurrence: Mapped[int] = mapped_column(Integer, default=10)
    detection_controls: Mapped[str] = mapped_column(Text, default="")
    detection: Mapped[int] = mapped_column(Integer, default=10)
    action_priority: Mapped[str] = mapped_column(String(1), default="H")
    special_characteristic: Mapped[str] = mapped_column(String(16), default="")
    key_codes: Mapped[list[str]] = mapped_column(JSON, default=list)
    measure_codes: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Schritt 6 – Optimierung
    opt_prevention: Mapped[str] = mapped_column(Text, default="")
    opt_detection: Mapped[str] = mapped_column(Text, default="")
    opt_responsible: Mapped[str] = mapped_column(String(128), default="")
    opt_target_date: Mapped[str] = mapped_column(String(32), default="")
    opt_status: Mapped[str] = mapped_column(String(32), default="")
    opt_occurrence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opt_detection_rating: Mapped[int | None] = mapped_column(Integer, nullable=True)
    opt_action_priority: Mapped[str] = mapped_column(String(1), default="")
    remarks: Mapped[str] = mapped_column(Text, default="")
    manually_edited: Mapped[bool] = mapped_column(Boolean, default=False)

    document: Mapped[FmeaDocument] = relationship(back_populates="rows")


class FmeaRequirement(Base):
    """Abgeleitete Anforderung (Halbzeug/Bauteil) je Bauteil – Kopie der Regel zum Generierungszeitpunkt."""

    __tablename__ = "fmea_requirements"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("fmea_documents.id", ondelete="CASCADE"), index=True)
    component_id: Mapped[int | None] = mapped_column(ForeignKey("components.id", ondelete="SET NULL"))
    component_label: Mapped[str] = mapped_column(String(256), default="")
    sc_level: Mapped[int] = mapped_column(Integer, default=0)
    requirement_code: Mapped[str] = mapped_column(String(32))
    standard_code: Mapped[str] = mapped_column(String(64), default="")
    scope: Mapped[str] = mapped_column(String(16))
    category: Mapped[str] = mapped_column(String(64))
    text: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    document: Mapped[FmeaDocument] = relationship(back_populates="requirements")


# --------------------------------------------------------------------------------------------
# Auditlog
# --------------------------------------------------------------------------------------------


class AuditLog(Base):
    """Unveränderliches Protokoll. Jeder Eintrag enthält den Hash des Vorgängers (manipulationssicher)."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    username: Mapped[str] = mapped_column(String(64), default="system")
    action: Mapped[str] = mapped_column(String(32), index=True)
    entity_type: Mapped[str] = mapped_column(String(32), index=True)
    entity_id: Mapped[str] = mapped_column(String(64), default="", index=True)
    summary: Mapped[str] = mapped_column(Text, default="")
    details: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    prev_hash: Mapped[str] = mapped_column(String(64), default="")
    hash: Mapped[str] = mapped_column(String(64), default="")
