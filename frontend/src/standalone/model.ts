/** Datenmodell der Browser-Version – entspricht backend/app/models.py. */

export type Id = number;
export type Json = Record<string, unknown>;

export interface UserRec {
  id: Id;
  username: string;
  full_name: string;
  email: string;
  role: "konstrukteur" | "pruefer" | "admin";
  is_active: boolean;
  created_at: string;
}

export interface ScClassRec {
  level: number;
  code: string;
  name: string;
  requirement_level: string;
  description: string;
  default_severity: number;
  color: string;
}

export interface OptionRec {
  id: Id;
  attribute_id: Id;
  code: string;
  label: string;
  description: string;
  failure_cause: string;
  failure_effect: string;
  relevant_damages: string[];
  sort_order: number;
  active: boolean;
}

export interface AttributeRec {
  id: Id;
  code: string;
  name: string;
  list_no: 1 | 2;
  multi: boolean;
  required: boolean;
  is_failure_mode: boolean;
  description: string;
  sort_order: number;
  active: boolean;
  options: OptionRec[];
}

export interface StandardRec {
  id: Id;
  code: string;
  title: string;
  revision: string;
  description: string;
  active: boolean;
}

export interface RequirementRec {
  id: Id;
  code: string;
  standard_id: Id | null;
  scope: "halbzeug" | "bauteil";
  category: string;
  text: string;
  sc_min: number;
  sc_max: number;
  conditions: Record<string, string[]>;
  sort_order: number;
  active: boolean;
}

export interface MeasureRec {
  id: Id;
  code: string;
  title: string;
  description: string;
  measure_type: "V" | "E";
  rating: number;
  standard_id: Id | null;
  active: boolean;
}

export interface KeyMeasureRec {
  measure_id: Id;
  extent: string;
  rating: number | null;
}

export interface KeyRec {
  id: Id;
  code: string;
  option_id: Id;
  sc_level: number;
  description: string;
  active: boolean;
  measures: KeyMeasureRec[];
}

export interface AssemblyRec {
  id: Id;
  drawing_number: string;
  name: string;
  revision: string;
  function: string;
  description: string;
  source: string;
  pdm_ref: string;
  created_by_id: Id | null;
  created_at: string;
  updated_at: string;
}

export interface ClassificationRec {
  id: Id;
  component_id: Id;
  version: number;
  is_current: boolean;
  designation: string;
  designation2: string;
  function: string;
  sc_level: number;
  values: Record<string, string | string[]>;
  justification: string;
  created_by_id: Id | null;
  created_at: string;
}

export interface ComponentRec {
  id: Id;
  assembly_id: Id;
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
  classifications: ClassificationRec[];
}

export interface FmeaRowRec {
  id: Id;
  component_id: Id | null;
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
  action_priority: string;
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
}

export interface FmeaReqRec {
  id: Id;
  component_id: Id | null;
  component_label: string;
  sc_level: number;
  requirement_code: string;
  standard_code: string;
  scope: string;
  category: string;
  text: string;
  sort_order: number;
}

export interface FmeaRec {
  id: Id;
  assembly_id: Id;
  fmea_number: string;
  version: number;
  status: "entwurf" | "in_pruefung" | "freigegeben" | "abgelehnt" | "ersetzt";
  title: string;
  team: string;
  responsible: string;
  confidentiality: string;
  created_by_id: Id | null;
  created_at: string;
  submitted_at: string | null;
  reviewed_by_id: Id | null;
  reviewed_at: string | null;
  review_comment: string;
  snapshot: Json;
  warnings: string[];
  content_hash: string;
  pdm_status: string;
  pdm_ref: string;
  pdm_synced_at: string | null;
  rows: FmeaRowRec[];
  requirements: FmeaReqRec[];
}

export interface AuditRec {
  id: Id;
  timestamp: string;
  user_id: Id | null;
  username: string;
  action: string;
  entity_type: string;
  entity_id: string;
  summary: string;
  details: Json;
  prev_hash: string;
  hash: string;
  session: string;
  page: number;
}

export interface PdmEntry {
  number: string;
  name: string;
  name2?: string;
  revision?: string;
  material?: string;
  description?: string;
  pdm_ref?: string;
  bom?: { position?: string; number: string; quantity?: number; unit?: string }[];
}

export interface Store {
  users: UserRec[];
  sc_classes: ScClassRec[];
  attributes: AttributeRec[];
  standards: StandardRec[];
  requirements: RequirementRec[];
  measures: MeasureRec[];
  keys: KeyRec[];
  assemblies: AssemblyRec[];
  components: ComponentRec[];
  fmeas: FmeaRec[];
  audit: AuditRec[];
  pdm: { items: PdmEntry[] };
}

let lastId = 0;
/** Zeitbasierte, praktisch kollisionsfreie numerische IDs (mehrere Nutzer schreiben gleichzeitig). */
export function newId(): Id {
  const candidate = Date.now() * 1000 + Math.floor(Math.random() * 1000);
  lastId = Math.max(lastId + 1, candidate);
  return lastId;
}

export const nowIso = () => new Date().toISOString();

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** JSON mit sortierten Schlüsseln – für Vergleiche und Hashes. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}
