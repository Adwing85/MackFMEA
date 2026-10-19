from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

RoleName = Literal["konstrukteur", "pruefer", "admin"]
ScopeName = Literal["halbzeug", "bauteil"]
MeasureTypeName = Literal["V", "E"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------ Auth / Benutzer


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(ORM):
    id: int
    username: str
    full_name: str
    email: str
    role: RoleName
    is_active: bool


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8)


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=64, pattern=r"^[A-Za-z0-9._-]+$")
    full_name: str = ""
    email: str = ""
    role: RoleName = "konstrukteur"
    password: str = Field(min_length=8)


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    role: RoleName | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


# ------------------------------------------------------------------ Regelwerk


class ScClassOut(ORM):
    level: int
    code: str
    name: str
    requirement_level: str
    description: str
    default_severity: int
    color: str


class ScClassUpdate(BaseModel):
    name: str | None = None
    requirement_level: str | None = None
    description: str | None = None
    default_severity: int | None = Field(default=None, ge=1, le=10)
    color: str | None = None


class OptionBase(BaseModel):
    code: str = Field(min_length=1, max_length=16, pattern=r"^[A-Z0-9_]+$")
    label: str = Field(min_length=1)
    description: str = ""
    failure_cause: str = ""
    failure_effect: str = ""
    relevant_damages: list[str] = []
    sort_order: int = 0
    active: bool = True


class OptionCreate(OptionBase):
    pass


class OptionUpdate(BaseModel):
    label: str | None = None
    description: str | None = None
    failure_cause: str | None = None
    failure_effect: str | None = None
    relevant_damages: list[str] | None = None
    sort_order: int | None = None
    active: bool | None = None


class OptionOut(ORM, OptionBase):
    id: int
    attribute_id: int


class AttributeBase(BaseModel):
    code: str = Field(min_length=1, max_length=16, pattern=r"^[A-Z0-9_]+$")
    name: str = Field(min_length=1)
    list_no: Literal[1, 2] = 2
    multi: bool = False
    required: bool = True
    is_failure_mode: bool = False
    description: str = ""
    sort_order: int = 0
    active: bool = True


class AttributeCreate(AttributeBase):
    pass


class AttributeUpdate(BaseModel):
    name: str | None = None
    list_no: Literal[1, 2] | None = None
    multi: bool | None = None
    required: bool | None = None
    is_failure_mode: bool | None = None
    description: str | None = None
    sort_order: int | None = None
    active: bool | None = None


class AttributeOut(ORM, AttributeBase):
    id: int
    options: list[OptionOut] = []


class StandardBase(BaseModel):
    code: str = Field(min_length=1)
    title: str = Field(min_length=1)
    revision: str = ""
    description: str = ""
    active: bool = True


class StandardOut(ORM, StandardBase):
    id: int


class StandardUpdate(BaseModel):
    code: str | None = None
    title: str | None = None
    revision: str | None = None
    description: str | None = None
    active: bool | None = None


class RequirementBase(BaseModel):
    code: str = Field(min_length=1)
    standard_id: int | None = None
    scope: ScopeName = "bauteil"
    category: str = Field(min_length=1)
    text: str = Field(min_length=1)
    sc_min: int = Field(default=0, ge=0, le=4)
    sc_max: int = Field(default=4, ge=0, le=4)
    conditions: dict[str, list[str]] = {}
    sort_order: int = 0
    active: bool = True


class RequirementOut(ORM, RequirementBase):
    id: int
    standard_code: str = ""


class RequirementUpdate(BaseModel):
    code: str | None = None
    standard_id: int | None = None
    scope: ScopeName | None = None
    category: str | None = None
    text: str | None = None
    sc_min: int | None = Field(default=None, ge=0, le=4)
    sc_max: int | None = Field(default=None, ge=0, le=4)
    conditions: dict[str, list[str]] | None = None
    sort_order: int | None = None
    active: bool | None = None


class MeasureBase(BaseModel):
    code: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str = ""
    measure_type: MeasureTypeName = "V"
    rating: int = Field(default=5, ge=1, le=10)
    standard_id: int | None = None
    active: bool = True


class MeasureOut(ORM, MeasureBase):
    id: int
    standard_code: str = ""


class MeasureUpdate(BaseModel):
    code: str | None = None
    title: str | None = None
    description: str | None = None
    measure_type: MeasureTypeName | None = None
    rating: int | None = Field(default=None, ge=1, le=10)
    standard_id: int | None = None
    active: bool | None = None


class KeyMeasureOut(BaseModel):
    measure_id: int
    code: str
    title: str
    measure_type: str
    extent: str
    rating: int | None
    effective_rating: int


class KeyOut(BaseModel):
    id: int
    code: str
    option_id: int
    attribute_code: str
    option_code: str
    option_label: str
    sc_level: int
    description: str
    active: bool
    measures: list[KeyMeasureOut]


class KeyUpdate(BaseModel):
    description: str | None = None
    active: bool | None = None


class KeyMeasureAssign(BaseModel):
    measure_id: int
    extent: str = ""
    rating: int | None = Field(default=None, ge=1, le=10)
    propagate_up: bool = False


class KeyMeasureUpdate(BaseModel):
    extent: str | None = None
    rating: int | None = Field(default=None, ge=1, le=10)
    clear_rating: bool = False


class PreviewRequest(BaseModel):
    values: dict[str, Any] = {}
    sc_level: int = Field(ge=0, le=4)


# ------------------------------------------------------------------ Baugruppen / Bauteile


class ComponentBase(BaseModel):
    position: str = ""
    level: int = Field(default=1, ge=1, le=20)
    drawing_number: str = ""
    name: str = Field(min_length=1)
    name2: str = ""
    quantity: float = 1.0
    unit: str = "Stk"
    material_pdm: str = ""
    pdm_ref: str = ""
    sort_order: int | None = None


class ComponentCreate(ComponentBase):
    pass


class ComponentUpdate(BaseModel):
    position: str | None = None
    level: int | None = Field(default=None, ge=1, le=20)
    drawing_number: str | None = None
    name: str | None = None
    name2: str | None = None
    quantity: float | None = None
    unit: str | None = None
    material_pdm: str | None = None
    sort_order: int | None = None


class ClassificationIn(BaseModel):
    designation: str = ""
    designation2: str = ""
    function: str = ""
    sc_level: int = Field(ge=0, le=4)
    values: dict[str, Any] = {}
    justification: str = ""


class ClassificationOut(ORM):
    id: int
    component_id: int
    version: int
    is_current: bool
    designation: str
    designation2: str
    function: str
    sc_level: int
    values: dict[str, Any]
    justification: str
    created_by_name: str = ""
    created_at: datetime


class ComponentOut(ORM, ComponentBase):
    id: int
    assembly_id: int
    sort_order: int
    classification: ClassificationOut | None = None


class AssemblyBase(BaseModel):
    drawing_number: str = Field(min_length=1)
    name: str = Field(min_length=1)
    revision: str = ""
    function: str = ""
    description: str = ""


class AssemblyCreate(AssemblyBase):
    components: list[ComponentCreate] = []


class AssemblyUpdate(BaseModel):
    drawing_number: str | None = None
    name: str | None = None
    revision: str | None = None
    function: str | None = None
    description: str | None = None


class FmeaSummary(BaseModel):
    id: int
    fmea_number: str
    version: int
    status: str
    title: str
    created_at: datetime
    created_by: str
    reviewed_by: str
    rows: int
    ap_counts: dict[str, int]
    assembly_id: int
    assembly_name: str = ""
    assembly_drawing_number: str = ""


class AssemblyOut(ORM, AssemblyBase):
    id: int
    source: str
    pdm_ref: str
    created_at: datetime
    updated_at: datetime
    created_by_name: str = ""
    component_count: int = 0
    classified_count: int = 0


class AssemblyDetail(AssemblyOut):
    components: list[ComponentOut] = []
    fmeas: list[FmeaSummary] = []


class PdmImportRequest(BaseModel):
    drawing_number: str = Field(min_length=1)
    function: str = ""


# ------------------------------------------------------------------ FMEA


class GenerateRequest(BaseModel):
    title: str = ""
    team: str = ""
    responsible: str = ""
    confidentiality: str = "Intern"


class FmeaHeaderUpdate(BaseModel):
    title: str | None = None
    team: str | None = None
    responsible: str | None = None
    confidentiality: str | None = None


class FmeaRowOut(ORM):
    id: int
    component_id: int | None
    sort_order: int
    higher_level: str
    focus_element: str
    lower_level: str
    function_higher: str
    function_focus: str
    function_lower: str
    failure_effect: str
    severity: int
    failure_mode: str
    failure_cause: str
    prevention_controls: str
    occurrence: int
    detection_controls: str
    detection: int
    action_priority: str
    special_characteristic: str
    key_codes: list[str]
    measure_codes: list[str]
    opt_prevention: str
    opt_detection: str
    opt_responsible: str
    opt_target_date: str
    opt_status: str
    opt_occurrence: int | None
    opt_detection_rating: int | None
    opt_action_priority: str
    remarks: str
    manually_edited: bool
    rpn: int = 0


class FmeaRowUpdate(BaseModel):
    failure_effect: str | None = None
    severity: int | None = Field(default=None, ge=1, le=10)
    failure_mode: str | None = None
    failure_cause: str | None = None
    prevention_controls: str | None = None
    occurrence: int | None = Field(default=None, ge=1, le=10)
    detection_controls: str | None = None
    detection: int | None = Field(default=None, ge=1, le=10)
    opt_prevention: str | None = None
    opt_detection: str | None = None
    opt_responsible: str | None = None
    opt_target_date: str | None = None
    opt_status: str | None = None
    opt_occurrence: int | None = Field(default=None, ge=1, le=10)
    opt_detection_rating: int | None = Field(default=None, ge=1, le=10)
    remarks: str | None = None
    change_reason: str = ""

    @field_validator("opt_status")
    @classmethod
    def _status(cls, v: str | None) -> str | None:
        allowed = {"", "offen", "in Bearbeitung", "umgesetzt", "verworfen"}
        if v is not None and v not in allowed:
            raise ValueError(f"Status muss einer von {sorted(allowed)} sein")
        return v


class FmeaRequirementOut(ORM):
    id: int
    component_id: int | None
    component_label: str
    sc_level: int
    requirement_code: str
    standard_code: str
    scope: str
    category: str
    text: str


class FmeaDetail(BaseModel):
    id: int
    assembly_id: int
    assembly_name: str
    assembly_drawing_number: str
    fmea_number: str
    version: int
    status: str
    title: str
    team: str
    responsible: str
    confidentiality: str
    created_at: datetime
    created_by: str
    created_by_id: int | None
    submitted_at: datetime | None
    reviewed_by: str
    reviewed_at: datetime | None
    review_comment: str
    snapshot: dict[str, Any]
    warnings: list[str]
    content_hash: str
    pdm_status: str
    pdm_ref: str
    pdm_synced_at: datetime | None
    rows: list[FmeaRowOut]
    requirements: list[FmeaRequirementOut]


class ReviewDecision(BaseModel):
    comment: str = ""


# ------------------------------------------------------------------ Audit


class AuditOut(ORM):
    id: int
    timestamp: datetime
    user_id: int | None
    username: str
    action: str
    entity_type: str
    entity_id: str
    summary: str
    details: dict[str, Any]
    hash: str


class AuditPage(BaseModel):
    total: int
    items: list[AuditOut]
