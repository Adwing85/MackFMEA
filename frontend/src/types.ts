export type Role = "konstrukteur" | "pruefer" | "admin";
export type FmeaStatus = "entwurf" | "in_pruefung" | "freigegeben" | "abgelehnt" | "ersetzt";
export type AP = "H" | "M" | "L";

export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role: Role;
  is_active: boolean;
}

export interface ScClass {
  level: number;
  code: string;
  name: string;
  requirement_level: string;
  description: string;
  default_severity: number;
  color: string;
}

export interface AttributeOption {
  id: number;
  attribute_id: number;
  code: string;
  label: string;
  description: string;
  failure_cause: string;
  failure_effect: string;
  relevant_damages: string[];
  sort_order: number;
  active: boolean;
}

export interface Attribute {
  id: number;
  code: string;
  name: string;
  list_no: 1 | 2;
  multi: boolean;
  required: boolean;
  is_failure_mode: boolean;
  description: string;
  sort_order: number;
  active: boolean;
  options: AttributeOption[];
}

export interface Standard {
  id: number;
  code: string;
  title: string;
  revision: string;
  description: string;
  active: boolean;
}

export interface Requirement {
  id: number;
  code: string;
  standard_id: number | null;
  standard_code: string;
  scope: "halbzeug" | "bauteil";
  category: string;
  text: string;
  sc_min: number;
  sc_max: number;
  conditions: Record<string, string[]>;
  sort_order: number;
  active: boolean;
}

export interface Measure {
  id: number;
  code: string;
  title: string;
  description: string;
  measure_type: "V" | "E";
  rating: number;
  standard_id: number | null;
  standard_code: string;
  active: boolean;
}

export interface KeyMeasure {
  measure_id: number;
  code: string;
  title: string;
  measure_type: "V" | "E";
  extent: string;
  rating: number | null;
  effective_rating: number;
}

export interface KeyEntry {
  id: number;
  code: string;
  option_id: number;
  attribute_code: string;
  option_code: string;
  option_label: string;
  sc_level: number;
  description: string;
  active: boolean;
  measures: KeyMeasure[];
}

export interface Classification {
  id: number;
  component_id: number;
  version: number;
  is_current: boolean;
  designation: string;
  designation2: string;
  function: string;
  sc_level: number;
  values: Record<string, string | string[]>;
  justification: string;
  created_by_name: string;
  created_at: string;
}

export interface Component {
  id: number;
  assembly_id: number;
  position: string;
  level: number;
  drawing_number: string;
  name: string;
  name2: string;
  quantity: number;
  unit: string;
  material_pdm: string;
  pdm_ref: string;
  sort_order: number;
  classification: Classification | null;
}

export interface FmeaSummary {
  id: number;
  fmea_number: string;
  version: number;
  status: FmeaStatus;
  title: string;
  created_at: string;
  created_by: string;
  reviewed_by: string;
  rows: number;
  ap_counts: Record<AP, number>;
  assembly_id: number;
  assembly_name: string;
  assembly_drawing_number: string;
}

export interface Assembly {
  id: number;
  drawing_number: string;
  name: string;
  revision: string;
  function: string;
  description: string;
  source: string;
  pdm_ref: string;
  created_at: string;
  updated_at: string;
  created_by_name: string;
  component_count: number;
  classified_count: number;
}

export interface AssemblyDetail extends Assembly {
  components: Component[];
  fmeas: FmeaSummary[];
}

export interface FmeaRow {
  id: number;
  component_id: number | null;
  sort_order: number;
  higher_level: string;
  focus_element: string;
  lower_level: string;
  function_higher: string;
  function_focus: string;
  function_lower: string;
  failure_effect: string;
  severity: number;
  failure_mode: string;
  failure_cause: string;
  prevention_controls: string;
  occurrence: number;
  detection_controls: string;
  detection: number;
  action_priority: AP;
  special_characteristic: string;
  key_codes: string[];
  measure_codes: string[];
  opt_prevention: string;
  opt_detection: string;
  opt_responsible: string;
  opt_target_date: string;
  opt_status: string;
  opt_occurrence: number | null;
  opt_detection_rating: number | null;
  opt_action_priority: string;
  remarks: string;
  manually_edited: boolean;
  rpn: number;
}

export interface FmeaRequirement {
  id: number;
  component_id: number | null;
  component_label: string;
  sc_level: number;
  requirement_code: string;
  standard_code: string;
  scope: "halbzeug" | "bauteil";
  category: string;
  text: string;
}

export interface SnapshotComponent {
  component_id: number;
  position: string;
  drawing_number: string;
  label: string;
  classification_id: number;
  classification_version: number;
  sc_level: number;
  liste1: Record<string, string | string[]>;
  liste2: Record<string, string | string[]>;
  keys: string[];
  measures: string[];
  requirements: string[];
  rows: number;
}

export interface FmeaSnapshot {
  generator_version: string;
  generated_at: string;
  generated_by: string;
  ruleset_fingerprint: string;
  assembly: Record<string, string | number>;
  process: { step: number; name: string; result: string }[];
  ap_counts: Record<AP, number>;
  components: SnapshotComponent[];
  skipped: { component_id: number; label: string; reason: string }[];
}

export interface FmeaDetail {
  id: number;
  assembly_id: number;
  assembly_name: string;
  assembly_drawing_number: string;
  fmea_number: string;
  version: number;
  status: FmeaStatus;
  title: string;
  team: string;
  responsible: string;
  confidentiality: string;
  created_at: string;
  created_by: string;
  created_by_id: number | null;
  submitted_at: string | null;
  reviewed_by: string;
  reviewed_at: string | null;
  review_comment: string;
  snapshot: FmeaSnapshot;
  warnings: string[];
  content_hash: string;
  pdm_status: string;
  pdm_ref: string;
  pdm_synced_at: string | null;
  rows: FmeaRow[];
  requirements: FmeaRequirement[];
  outdated_components: string[];
}

export interface AuditEntry {
  id: number;
  timestamp: string;
  user_id: number | null;
  username: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  details: Record<string, unknown>;
  hash: string;
}

export interface PreviewMeasure {
  id: number;
  code: string;
  title: string;
  measure_type: "V" | "E";
  rating: number;
  extent: string;
  keys: string[];
}

export interface PreviewKey {
  code: string;
  attribute_code: string;
  attribute_name: string;
  list_no: number;
  option_code: string;
  option_label: string;
  exists: boolean;
  measures: { code: string; title: string; measure_type: "V" | "E"; extent: string; rating: number }[];
}

export interface Preview {
  sc_level: number;
  sc_class: { code: string; name: string; requirement_level: string; default_severity: number } | null;
  requirements: Requirement[];
  keys: PreviewKey[];
  measures: PreviewMeasure[];
  per_level: { sc_level: number; requirements: number; halbzeug: number; bauteil: number; measures: number }[];
}

export interface PdmItem {
  number: string;
  name: string;
  name2: string;
  revision: string;
  material: string;
  pdm_ref: string;
  description: string;
}

export interface Dashboard {
  assemblies: number;
  components: number;
  classified: number;
  sc_distribution: Record<string, number>;
  fmea_status: Partial<Record<FmeaStatus, number>>;
  action_priority: Record<AP, number>;
  pending_reviews: { id: number; fmea_number: string; version: number; assembly_name: string; submitted_at: string }[];
  recent_activity: AuditEntry[];
}
