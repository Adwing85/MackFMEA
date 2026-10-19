/**
 * Regelwerk-Engine und FMEA-Generator – Portierung von backend/app/services/{ap,rules,fmea_generator}.py.
 */

import {
  newId,
  nowIso,
  stableStringify,
  type AttributeRec,
  type ClassificationRec,
  type ComponentRec,
  type FmeaRec,
  type FmeaReqRec,
  type FmeaRowRec,
  type Json,
  type KeyRec,
  type MeasureRec,
  type OptionRec,
  type RequirementRec,
  type ScClassRec,
  type StandardRec,
  type Store,
  type UserRec,
} from "./model";
import { sha256Hex } from "./sha256";

export const SC_LEVELS = [0, 1, 2, 3, 4];

// ---------------------------------------------------------------- Aufgabenpriorität (AIAG & VDA)

const AP_TABLE: Record<string, string[]> = {
  "9-10": ["HHHH", "HHHH", "HHHM", "HMLL", "LLLL"],
  "7-8": ["HHHH", "HHHM", "HMMM", "MMLL", "LLLL"],
  "4-6": ["HHMM", "MMML", "MLLL", "LLLL", "LLLL"],
  "2-3": ["MMLL", "LLLL", "LLLL", "LLLL", "LLLL"],
};
const clamp = (v: number) => Math.max(1, Math.min(10, Math.round(v)));

export function actionPriority(severity: number, occurrence: number, detection: number): string {
  const s = clamp(severity);
  const o = clamp(occurrence);
  const d = clamp(detection);
  if (s === 1) return "L";
  const sb = s >= 9 ? "9-10" : s >= 7 ? "7-8" : s >= 4 ? "4-6" : "2-3";
  const oi = o >= 8 ? 0 : o >= 6 ? 1 : o >= 4 ? 2 : o >= 2 ? 3 : 4;
  const di = d >= 7 ? 0 : d >= 5 ? 1 : d >= 2 ? 2 : 3;
  return AP_TABLE[sb][oi][di];
}

// ---------------------------------------------------------------- Regelwerk

export const keyCode = (attributeCode: string, optionCode: string, level: number) => `${attributeCode}-${optionCode}-SC${level}`;

export interface RuleSet {
  sc: Map<number, ScClassRec>;
  attributes: AttributeRec[];
  options: Map<number, OptionRec[]>;
  requirements: RequirementRec[];
  keys: Map<string, KeyRec>;
  measures: Map<number, MeasureRec>;
  standards: Map<number, StandardRec>;
}

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

export function loadRuleset(store: Store): RuleSet {
  const attributes = store.attributes
    .filter((a) => a.active)
    .sort((a, b) => cmp(a.list_no, b.list_no) || cmp(a.sort_order, b.sort_order) || cmp(a.id, b.id));
  return {
    sc: new Map(store.sc_classes.map((s) => [s.level, s])),
    attributes,
    options: new Map(attributes.map((a) => [a.id, sortedOptions(a).filter((o) => o.active)])),
    requirements: store.requirements
      .filter((r) => r.active)
      .sort((a, b) => cmp(a.scope, b.scope) || cmp(a.sort_order, b.sort_order) || cmp(a.code, b.code)),
    keys: new Map(store.keys.map((k) => [`${k.option_id}:${k.sc_level}`, k])),
    measures: new Map(store.measures.map((m) => [m.id, m])),
    standards: new Map(store.standards.map((s) => [s.id, s])),
  };
}

export const sortedOptions = (a: AttributeRec) => [...a.options].sort((x, y) => cmp(x.sort_order, y.sort_order) || cmp(x.id, y.id));
export const standardCode = (rs: RuleSet, id: number | null) => (id ? (rs.standards.get(id)?.code ?? "") : "");

export function fingerprint(rs: RuleSet): string {
  const data = {
    sc: [...rs.sc.values()].map((s) => [s.level, s.default_severity]),
    attributes: rs.attributes.map((a) => [
      a.code,
      (rs.options.get(a.id) ?? []).map((o) => [o.code, o.failure_cause, o.failure_effect, [...o.relevant_damages].sort()]),
    ]),
    requirements: rs.requirements.map((r) => [r.code, r.scope, r.category, r.text, r.sc_min, r.sc_max, r.conditions]),
    keys: [...rs.keys.values()]
      .filter((k) => k.active)
      .map((k) => [
        k.code,
        k.measures
          .filter((km) => rs.measures.get(km.measure_id)?.active)
          .map((km) => [rs.measures.get(km.measure_id)!.code, km.extent, km.rating])
          .sort((a, b) => cmp(String(a[0]), String(b[0]))),
      ])
      .sort((a, b) => cmp(String(a[0]), String(b[0]))),
  };
  return sha256Hex(stableStringify(data));
}

export const asList = (v: unknown): string[] =>
  v === undefined || v === null || v === "" ? [] : Array.isArray(v) ? v.map(String).filter((x) => x !== "") : [String(v)];

export function normalizeValues(rs: RuleSet, values: Record<string, unknown> | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const a of rs.attributes) out[a.code] = asList(values?.[a.code]);
  return out;
}

export class ClassificationError extends Error {
  constructor(public errors: string[]) {
    super(errors.join("; "));
  }
}

export function validateClassification(rs: RuleSet, values: Record<string, unknown>, sc: number): Record<string, string[]> {
  const errors: string[] = [];
  if (!rs.sc.has(sc)) errors.push(`Unbekannte SC-Klasse: ${sc}`);
  const normalized = normalizeValues(rs, values);
  for (const a of rs.attributes) {
    const selected = normalized[a.code];
    const valid = new Set((rs.options.get(a.id) ?? []).map((o) => o.code));
    const unknown = selected.filter((c) => !valid.has(c));
    if (unknown.length) errors.push(`${a.name}: unbekannte Ausprägung(en) ${unknown.join(", ")}`);
    if (a.required && !selected.length) errors.push(`${a.name}: Angabe erforderlich`);
    if (!a.multi && selected.length > 1) errors.push(`${a.name}: nur eine Ausprägung zulässig`);
  }
  const known = new Set(rs.attributes.map((a) => a.code));
  const unknownAttrs = Object.keys(values ?? {}).filter((k) => !known.has(k));
  if (unknownAttrs.length) errors.push(`Unbekannte Merkmale: ${unknownAttrs.sort().join(", ")}`);
  if (errors.length) throw new ClassificationError(errors);
  return normalized;
}

export function conditionsMatch(conditions: Record<string, string[]> | undefined, values: Record<string, string[]>): boolean {
  return Object.entries(conditions ?? {}).every(
    ([attr, allowed]) => !allowed.length || (values[attr] ?? []).some((c) => allowed.includes(c)),
  );
}

export const deriveRequirements = (rs: RuleSet, values: Record<string, string[]>, sc: number) =>
  rs.requirements.filter((r) => r.sc_min <= sc && sc <= r.sc_max && conditionsMatch(r.conditions, values));

export interface ResolvedKey {
  attribute: AttributeRec;
  option: OptionRec;
  key: KeyRec | null;
  code: string;
}

export function resolveKeys(rs: RuleSet, values: Record<string, string[]>, sc: number): ResolvedKey[] {
  const out: ResolvedKey[] = [];
  for (const attribute of rs.attributes) {
    const options = new Map((rs.options.get(attribute.id) ?? []).map((o) => [o.code, o]));
    for (const code of values[attribute.code] ?? []) {
      const option = options.get(code);
      if (!option) continue;
      let key = rs.keys.get(`${option.id}:${sc}`) ?? null;
      if (key && !key.active) key = null;
      out.push({ attribute, option, key, code: key ? key.code : keyCode(attribute.code, code, sc) });
    }
  }
  return out;
}

export interface DerivedMeasure {
  measure: MeasureRec;
  extent: string;
  rating: number;
  keys: string[];
}

export function mergeMeasures(rs: RuleSet, keys: ResolvedKey[]): DerivedMeasure[] {
  const merged = new Map<number, DerivedMeasure>();
  for (const resolved of keys) {
    if (!resolved.key) continue;
    for (const km of resolved.key.measures) {
      const measure = rs.measures.get(km.measure_id);
      if (!measure?.active) continue;
      const rating = km.rating || measure.rating;
      const existing = merged.get(measure.id);
      if (!existing) {
        merged.set(measure.id, { measure, extent: km.extent, rating, keys: [resolved.code] });
        continue;
      }
      existing.rating = Math.min(existing.rating, rating);
      if (km.extent && !existing.extent.split(" / ").includes(km.extent))
        existing.extent = existing.extent ? `${existing.extent} / ${km.extent}` : km.extent;
      if (!existing.keys.includes(resolved.code)) existing.keys.push(resolved.code);
    }
  }
  return [...merged.values()].sort(
    (a, b) => cmp(a.measure.measure_type, b.measure.measure_type) || cmp(a.rating, b.rating) || cmp(a.measure.code, b.measure.code),
  );
}

export const requirementDict = (rs: RuleSet, r: RequirementRec) => ({
  id: r.id,
  code: r.code,
  scope: r.scope,
  category: r.category,
  text: r.text,
  sc_min: r.sc_min,
  sc_max: r.sc_max,
  standard_code: standardCode(rs, r.standard_id),
  conditions: r.conditions ?? {},
});

export function preview(rs: RuleSet, values: Record<string, unknown>, scLevel: number) {
  const normalized = normalizeValues(rs, values);
  const requirements = deriveRequirements(rs, normalized, scLevel);
  const keys = resolveKeys(rs, normalized, scLevel);
  const measures = mergeMeasures(rs, keys);
  const perLevel = SC_LEVELS.filter((l) => rs.sc.has(l)).map((level) => {
    const reqs = deriveRequirements(rs, normalized, level);
    return {
      sc_level: level,
      requirements: reqs.length,
      halbzeug: reqs.filter((r) => r.scope === "halbzeug").length,
      bauteil: reqs.filter((r) => r.scope === "bauteil").length,
      measures: mergeMeasures(rs, resolveKeys(rs, normalized, level)).length,
    };
  });
  const sc = rs.sc.get(scLevel);
  return {
    sc_level: scLevel,
    sc_class: sc ? { code: sc.code, name: sc.name, requirement_level: sc.requirement_level, default_severity: sc.default_severity } : null,
    requirements: requirements.map((r) => requirementDict(rs, r)),
    keys: keys.map((k) => ({
      code: k.code,
      attribute_code: k.attribute.code,
      attribute_name: k.attribute.name,
      list_no: k.attribute.list_no,
      option_code: k.option.code,
      option_label: k.option.label,
      exists: k.key !== null,
      measures: (k.key?.measures ?? [])
        .map((km) => ({ km, m: rs.measures.get(km.measure_id) }))
        .filter(({ m }) => m?.active)
        .map(({ km, m }) => ({ code: m!.code, title: m!.title, measure_type: m!.measure_type, extent: km.extent, rating: km.rating || m!.rating })),
    })),
    measures: measures.map((m) => ({
      id: m.measure.id,
      code: m.measure.code,
      title: m.measure.title,
      measure_type: m.measure.measure_type,
      rating: m.rating,
      extent: m.extent,
      keys: m.keys,
    })),
    per_level: perLevel,
  };
}

/** Legt fehlende Schlüssel für alle Ausprägungen × SC-Klassen an. */
export function ensureKeys(store: Store): number {
  const levels = store.sc_classes.map((s) => s.level);
  const existing = new Set(store.keys.map((k) => `${k.option_id}:${k.sc_level}`));
  let created = 0;
  for (const a of store.attributes) {
    for (const o of a.options) {
      for (const level of levels.length ? levels : SC_LEVELS) {
        if (existing.has(`${o.id}:${level}`)) continue;
        store.keys.push({
          id: newId(),
          code: keyCode(a.code, o.code, level),
          option_id: o.id,
          sc_level: level,
          description: `${a.name}: ${o.label} – SC${level}`,
          active: true,
          measures: [],
        });
        created++;
      }
    }
  }
  return created;
}

export function consistencyReport(rs: RuleSet) {
  const issues: { type: string; ref: string; message: string; counts: number[] }[] = [];
  const levels = [...rs.sc.keys()].sort((a, b) => a - b);
  const activeCount = (k: KeyRec | undefined) => (k && k.active ? k.measures.filter((km) => rs.measures.get(km.measure_id)?.active).length : 0);
  for (const attribute of rs.attributes) {
    for (const option of rs.options.get(attribute.id) ?? []) {
      const counts = levels.map((l) => activeCount(rs.keys.get(`${option.id}:${l}`)));
      for (let i = 1; i < counts.length; i++) {
        if (counts[i] < counts[i - 1]) {
          issues.push({
            type: "schluessel",
            ref: `${attribute.code}-${option.code}`,
            message: `${attribute.name} „${option.label}“: Maßnahmenanzahl sinkt von SC${levels[i - 1]} (${counts[i - 1]}) auf SC${levels[i]} (${counts[i]})`,
            counts,
          });
          break;
        }
      }
    }
  }
  const groups = new Map<string, RequirementRec[]>();
  for (const r of rs.requirements) {
    const key = JSON.stringify([r.scope, r.category, stableStringify(r.conditions ?? {})]);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, reqs] of groups) {
    const [scope, category, signature] = JSON.parse(key) as [string, string, string];
    const counts = levels.map((l) => reqs.filter((r) => r.sc_min <= l && l <= r.sc_max).length);
    for (let i = 1; i < counts.length; i++) {
      if (counts[i] < counts[i - 1]) {
        const conditions = JSON.parse(signature) as Record<string, string[]>;
        const condText = Object.keys(conditions).length
          ? " für " + Object.entries(conditions).map(([k, v]) => `${k}=${v.join("/")}`).join(", ")
          : "";
        issues.push({
          type: "anforderung",
          ref: `${scope}/${category}`,
          message: `Anforderungen ${scope} / ${category}${condText}: Anzahl sinkt von SC${levels[i - 1]} (${counts[i - 1]}) auf SC${levels[i]} (${counts[i]})`,
          counts,
        });
        break;
      }
    }
  }
  const totals = levels.map((level) => ({
    sc_level: level,
    requirements: rs.requirements.filter((r) => r.sc_min <= level && level <= r.sc_max).length,
    key_measure_links: [...rs.keys.values()].filter((k) => k.sc_level === level && k.active).reduce((sum, k) => sum + activeCount(k), 0),
  }));
  return { consistent: issues.length === 0, issues, totals };
}

// ---------------------------------------------------------------- FMEA-Generierung

export const GENERATOR_VERSION = "1.0-browser";
const DEFAULT_OCCURRENCE = 8;
const DEFAULT_DETECTION = 10;

export const EDITABLE_ROW_FIELDS = [
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
] as const;

export const currentClassification = (c: ComponentRec): ClassificationRec | null => {
  const current = c.classifications.filter((cl) => cl.is_current);
  return current.length ? current[current.length - 1] : null;
};

export function componentLabel(c: ComponentRec, cls?: ClassificationRec | null): string {
  const name = (cls && cls.designation ? cls.designation : c.name) || "";
  return [c.drawing_number, name].filter(Boolean).join(" ") || `Pos. ${c.position}`;
}

export function formatMeasures(list: DerivedMeasure[]): string {
  return list.map((m) => `${m.measure.code} ${m.measure.title}${m.extent ? ` (${m.extent})` : ""}`).join("\n");
}

export function rowContent(r: FmeaRowRec) {
  return {
    component_id: r.component_id,
    focus_element: r.focus_element,
    lower_level: r.lower_level,
    failure_effect: r.failure_effect,
    severity: r.severity,
    failure_mode: r.failure_mode,
    failure_cause: r.failure_cause,
    prevention_controls: r.prevention_controls,
    occurrence: r.occurrence,
    detection_controls: r.detection_controls,
    detection: r.detection,
    action_priority: r.action_priority,
    opt_prevention: r.opt_prevention,
    opt_detection: r.opt_detection,
    opt_responsible: r.opt_responsible,
    opt_target_date: r.opt_target_date,
    opt_status: r.opt_status,
    opt_occurrence: r.opt_occurrence,
    opt_detection_rating: r.opt_detection_rating,
    opt_action_priority: r.opt_action_priority,
    remarks: r.remarks,
  };
}

export function computeContentHash(doc: FmeaRec): string {
  return sha256Hex(
    stableStringify({
      number: doc.fmea_number,
      version: doc.version,
      rows: doc.rows.map(rowContent),
      requirements: doc.requirements.map((r) => [r.component_id, r.requirement_code, r.text]),
    }),
  );
}

export function recalculateRow(row: FmeaRowRec) {
  row.action_priority = actionPriority(row.severity, row.occurrence, row.detection);
  row.opt_action_priority =
    row.opt_occurrence || row.opt_detection_rating
      ? actionPriority(row.severity, row.opt_occurrence || row.occurrence, row.opt_detection_rating || row.detection)
      : "";
}

interface Ctx {
  component: ComponentRec;
  classification: ClassificationRec;
  values: Record<string, string[]>;
  keys: ResolvedKey[];
  label: string;
}

function parentMap(components: ComponentRec[]): Map<number, ComponentRec> {
  const parents = new Map<number, ComponentRec>();
  const stack: ComponentRec[] = [];
  for (const c of components) {
    while (stack.length && stack[stack.length - 1].level >= c.level) stack.pop();
    if (stack.length) parents.set(c.id, stack[stack.length - 1]);
    stack.push(c);
  }
  return parents;
}

function suggestions(rs: RuleSet, sc: number, rowKeys: ResolvedKey[], current: DerivedMeasure[]): [DerivedMeasure[], DerivedMeasure[]] {
  const ids = new Set(current.map((m) => m.measure.id));
  const bestO = Math.min(11, ...current.filter((m) => m.measure.measure_type === "V").map((m) => m.rating));
  const bestD = Math.min(11, ...current.filter((m) => m.measure.measure_type === "E").map((m) => m.rating));
  const higher: ResolvedKey[] = [];
  for (const level of SC_LEVELS) {
    if (level <= sc) continue;
    for (const rk of rowKeys) {
      const key = rs.keys.get(`${rk.option.id}:${level}`);
      if (key && key.active) higher.push({ attribute: rk.attribute, option: rk.option, key, code: key.code });
    }
  }
  const candidates = mergeMeasures(rs, higher).filter((m) => !ids.has(m.measure.id));
  return [
    candidates.filter((m) => m.measure.measure_type === "V" && m.rating < bestO).slice(0, 3),
    candidates.filter((m) => m.measure.measure_type === "E" && m.rating < bestD).slice(0, 3),
  ];
}

function emptyRow(): Omit<FmeaRowRec, "id"> {
  return {
    component_id: null,
    sort_order: 0,
    higher_level: "",
    focus_element: "",
    lower_level: "",
    function_higher: "",
    function_focus: "",
    function_lower: "",
    failure_effect: "",
    severity: 1,
    failure_mode: "",
    failure_cause: "",
    prevention_controls: "",
    occurrence: 10,
    detection_controls: "",
    detection: 10,
    action_priority: "H",
    special_characteristic: "",
    key_codes: [],
    measure_codes: [],
    opt_prevention: "",
    opt_detection: "",
    opt_responsible: "",
    opt_target_date: "",
    opt_status: "",
    opt_occurrence: null,
    opt_detection_rating: null,
    opt_action_priority: "",
    remarks: "",
    manually_edited: false,
  };
}

function buildRows(
  rs: RuleSet,
  assembly: { drawing_number: string; name: string; function: string },
  ctx: Ctx,
  parent: Ctx | ComponentRec | null,
  warnings: string[],
): FmeaRowRec[] {
  const cls = ctx.classification;
  const sc = rs.sc.get(cls.sc_level)!;
  let higherLevel: string;
  let functionHigher: string;
  if (parent && "classification" in parent) {
    higherLevel = parent.label;
    functionHigher = parent.classification.function;
  } else if (parent) {
    higherLevel = componentLabel(parent);
    functionHigher = "";
  } else {
    higherLevel = [assembly.drawing_number, assembly.name].filter(Boolean).join(" ");
    functionHigher = assembly.function;
  }
  const focus = ctx.label + (cls.designation2 ? ` / ${cls.designation2}` : "");
  const failureModes = ctx.keys.filter((k) => k.attribute.is_failure_mode);
  const causeKeys = ctx.keys.filter((k) => !k.attribute.is_failure_mode && k.option.failure_cause);
  const generalKeys = ctx.keys.filter((k) => !k.attribute.is_failure_mode && !k.option.failure_cause);
  if (!failureModes.length) {
    warnings.push(`${ctx.label}: keine Schadensbilder (Fehlerarten) klassifiziert – keine FMEA-Zeilen erzeugt`);
    return [];
  }
  const requirements = deriveRequirements(rs, ctx.values, cls.sc_level);
  const rows: FmeaRowRec[] = [];
  for (const fm of failureModes) {
    const relevant = causeKeys.filter((k) => !k.option.relevant_damages.length || k.option.relevant_damages.includes(fm.option.code));
    const causes: (ResolvedKey | null)[] = relevant.length ? relevant : [null];
    if (!relevant.length && !fm.option.failure_cause)
      warnings.push(`${ctx.label}: für Schadensbild „${fm.option.label}“ ist keine Ursache hinterlegt – Ursache bitte manuell ergänzen`);
    for (const cause of causes) {
      const rowKeys = [fm, ...(cause ? [cause] : []), ...generalKeys];
      const measures = mergeMeasures(rs, rowKeys);
      const prevention = measures.filter((m) => m.measure.measure_type === "V");
      const detection = measures.filter((m) => m.measure.measure_type === "E");
      let lowerLevel: string;
      let functionLower: string;
      let failureCause: string;
      if (cause) {
        const refs = requirements.filter((r) => (r.conditions?.[cause.attribute.code] ?? []).includes(cause.option.code)).map((r) => r.code);
        lowerLevel = `${cause.attribute.name}: ${cause.option.label}`;
        functionLower = `${cause.option.label} gemäß ${sc.code}${refs.length ? ` (${refs.join(", ")})` : " (Anforderungsliste)"}`;
        failureCause = cause.option.failure_cause;
      } else {
        lowerLevel = `${fm.attribute.name}: ${fm.option.label} (generisch)`;
        functionLower = `Anforderungen gemäß ${sc.code} (Anforderungsliste)`;
        failureCause = fm.option.failure_cause || "Keine Ursache hinterlegt – bitte ergänzen";
      }
      const effect = fm.option.failure_effect || `Funktionsverlust ${ctx.label}`;
      const row: FmeaRowRec = {
        ...emptyRow(),
        id: newId(),
        component_id: ctx.component.id,
        higher_level: higherLevel,
        focus_element: focus,
        lower_level: lowerLevel,
        function_higher: functionHigher || "",
        function_focus: cls.function || "",
        function_lower: functionLower,
        failure_effect: `${effect} – Auswirkung auf ${higherLevel}`,
        severity: sc.default_severity,
        failure_mode: fm.option.label,
        failure_cause: failureCause,
        prevention_controls: formatMeasures(prevention) || "Keine Vermeidungsmaßnahme hinterlegt",
        occurrence: prevention.length ? Math.min(...prevention.map((m) => m.rating)) : DEFAULT_OCCURRENCE,
        detection_controls: formatMeasures(detection) || "Keine Entdeckungsmaßnahme hinterlegt",
        detection: detection.length ? Math.min(...detection.map((m) => m.rating)) : DEFAULT_DETECTION,
        special_characteristic: cls.sc_level > 0 ? sc.code : "",
        key_codes: rowKeys.map((k) => k.code),
        measure_codes: measures.map((m) => m.measure.code),
      };
      recalculateRow(row);
      if (row.action_priority === "H" || row.action_priority === "M") {
        const [v, e] = suggestions(rs, cls.sc_level, rowKeys, measures);
        row.opt_prevention = formatMeasures(v);
        row.opt_detection = formatMeasures(e);
        row.opt_status = row.action_priority === "H" ? "offen" : "";
        row.remarks =
          row.action_priority === "H" ? "AP hoch: Maßnahme festlegen oder Begründung dokumentieren" : "AP mittel: Maßnahme empfohlen";
      }
      rows.push(row);
    }
  }
  return rows;
}

export function generateFmea(
  store: Store,
  assemblyId: number,
  user: UserRec,
  header: { title?: string; team?: string; responsible?: string; confidentiality?: string },
): FmeaRec {
  const rs = loadRuleset(store);
  const assembly = store.assemblies.find((a) => a.id === assemblyId)!;
  const warnings: string[] = [];
  const components = store.components
    .filter((c) => c.assembly_id === assemblyId)
    .sort((a, b) => cmp(a.sort_order, b.sort_order) || cmp(a.id, b.id));
  const parents = parentMap(components);
  const contexts = new Map<number, Ctx>();
  const skipped: Json[] = [];
  for (const component of components) {
    const cls = currentClassification(component);
    if (!cls) {
      skipped.push({ component_id: component.id, label: componentLabel(component), reason: "nicht klassifiziert" });
      warnings.push(`${componentLabel(component)}: nicht klassifiziert – nicht in der FMEA enthalten`);
      continue;
    }
    if (!rs.sc.has(cls.sc_level)) {
      skipped.push({ component_id: component.id, label: componentLabel(component), reason: "SC-Klasse unbekannt" });
      warnings.push(`${componentLabel(component)}: SC-Klasse ${cls.sc_level} unbekannt`);
      continue;
    }
    const values = normalizeValues(rs, cls.values);
    const keys = resolveKeys(rs, values, cls.sc_level);
    const missing = keys.filter((k) => !k.key).map((k) => k.code);
    if (missing.length) warnings.push(`${componentLabel(component, cls)}: Schlüssel nicht vorhanden/inaktiv: ${missing.join(", ")}`);
    contexts.set(component.id, { component, classification: cls, values, keys, label: componentLabel(component, cls) });
  }
  if (!contexts.size) throw new Error("Keine klassifizierten Bauteile vorhanden – FMEA kann nicht generiert werden");

  const nextVersion = Math.max(0, ...store.fmeas.filter((f) => f.assembly_id === assemblyId).map((f) => f.version)) + 1;
  const createdAt = nowIso();
  const doc: FmeaRec = {
    id: newId(),
    assembly_id: assemblyId,
    fmea_number: `DFMEA-${assembly.drawing_number || assembly.id}`,
    version: nextVersion,
    status: "entwurf",
    title: header.title || `Design-FMEA ${assembly.name}`,
    team: header.team ?? "",
    responsible: header.responsible || user.full_name || user.username,
    confidentiality: header.confidentiality ?? "Intern",
    created_by_id: user.id,
    created_at: createdAt,
    submitted_at: null,
    reviewed_by_id: null,
    reviewed_at: null,
    review_comment: "",
    snapshot: {},
    warnings: [],
    content_hash: "",
    pdm_status: "",
    pdm_ref: "",
    pdm_synced_at: null,
    rows: [],
    requirements: [],
  };

  const componentSnapshots: Json[] = [];
  let sort = 0;
  let reqSort = 0;
  for (const component of components) {
    const ctx = contexts.get(component.id);
    if (!ctx) continue;
    const parentComponent = parents.get(component.id);
    const parent = parentComponent ? (contexts.get(parentComponent.id) ?? parentComponent) : null;
    const rows = buildRows(rs, assembly, ctx, parent, warnings);
    for (const row of rows) {
      sort += 10;
      row.sort_order = sort;
      doc.rows.push(row);
    }
    const requirements = deriveRequirements(rs, ctx.values, ctx.classification.sc_level);
    for (const req of requirements) {
      reqSort += 1;
      const r: FmeaReqRec = {
        id: newId(),
        component_id: component.id,
        component_label: ctx.label,
        sc_level: ctx.classification.sc_level,
        requirement_code: req.code,
        standard_code: standardCode(rs, req.standard_id),
        scope: req.scope,
        category: req.category,
        text: req.text,
        sort_order: reqSort,
      };
      doc.requirements.push(r);
    }
    const measures = mergeMeasures(rs, ctx.keys);
    const list = (n: 1 | 2) => Object.fromEntries(rs.attributes.filter((a) => a.list_no === n).map((a) => [a.code, ctx.values[a.code] ?? []]));
    componentSnapshots.push({
      component_id: component.id,
      position: component.position,
      drawing_number: component.drawing_number,
      label: ctx.label,
      classification_id: ctx.classification.id,
      classification_version: ctx.classification.version,
      sc_level: ctx.classification.sc_level,
      liste1: {
        bezeichnung: ctx.classification.designation,
        bezeichnung2: ctx.classification.designation2,
        funktion: ctx.classification.function,
        ...list(1),
      },
      liste2: { sc_klasse: `SC${ctx.classification.sc_level}`, ...list(2) },
      keys: ctx.keys.map((k) => k.code),
      measures: measures.map((m) => m.measure.code),
      requirements: requirements.map((r) => r.code),
      rows: rows.length,
    });
  }

  const apCounts = Object.fromEntries(["H", "M", "L"].map((ap) => [ap, doc.rows.filter((r) => r.action_priority === ap).length]));
  doc.warnings = warnings;
  doc.snapshot = {
    generator_version: GENERATOR_VERSION,
    generated_at: createdAt,
    generated_by: user.username,
    ruleset_fingerprint: fingerprint(rs),
    assembly: {
      id: assembly.id,
      drawing_number: assembly.drawing_number,
      name: assembly.name,
      revision: assembly.revision,
      source: assembly.source,
      pdm_ref: assembly.pdm_ref,
    },
    process: [
      { step: 1, name: "Abfrage Baugruppenstruktur (BOM)", result: `${components.length} Positionen` },
      { step: 2, name: "Merkmalsübergabe Liste 1 / Liste 2", result: `${contexts.size} klassifizierte Bauteile` },
      {
        step: 3,
        name: "Schlüsselgenerierung (Merkmal + SC-Klasse)",
        result: `${[...contexts.values()].reduce((s, c) => s + c.keys.length, 0)} Schlüssel`,
      },
      {
        step: 4,
        name: "Maßnahmenableitung aus Maßnahmenkatalog",
        result: `${componentSnapshots.reduce((s, c) => s + (c.measures as string[]).length, 0)} Maßnahmenzuordnungen`,
      },
      { step: 5, name: "Datenzusammenführung", result: `${doc.rows.length} FMEA-Zeilen, ${doc.requirements.length} Anforderungen` },
      { step: 6, name: "Ausgabe FMEA-Blatt", result: `${doc.fmea_number} Version ${nextVersion}` },
    ],
    ap_counts: apCounts,
    components: componentSnapshots,
    skipped,
  };
  doc.content_hash = computeContentHash(doc);
  return doc;
}
