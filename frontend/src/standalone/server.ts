/**
 * REST-API der Browser-Version – bildet backend/app/routers/* nach (gleiche Pfade, Antworten, Rollen und
 * Statusregeln). Alle Handler arbeiten synchron auf `persistence.store`; die Transport-Schicht speichert danach.
 */

import {
  ClassificationError,
  EDITABLE_ROW_FIELDS,
  computeContentHash,
  consistencyReport,
  currentClassification,
  deriveRequirements,
  ensureKeys,
  generateFmea,
  loadRuleset,
  preview,
  recalculateRow,
  requirementDict,
  resolveKeys,
  sortedOptions,
  validateClassification,
} from "./engine";
import { buildPdf, buildWorkbook } from "./exports";
import {
  clone,
  newId,
  nowIso,
  stableStringify,
  type AssemblyRec,
  type AttributeRec,
  type AuditRec,
  type ClassificationRec,
  type ComponentRec,
  type FmeaRec,
  type FmeaRowRec,
  type Json,
  type KeyRec,
  type MeasureRec,
  type OptionRec,
  type PdmEntry,
  type RequirementRec,
  type StandardRec,
  type Store,
  type UserRec,
} from "./model";
import { AUDIT_PAGE_SIZE, SESSION, persistence } from "./persistence";
import { sha256Hex } from "./sha256";
import { BomImportError, parseBomFile, type BomItem } from "./bom";

export class HttpError extends Error {
  constructor(
    public status: number,
    public detail: string | string[],
  ) {
    super(Array.isArray(detail) ? detail.join("; ") : detail);
  }
}

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Req {
  method: string;
  query: URLSearchParams;
  params: string[];
  body: Body;
  user: UserRec | null;
}
type Role = UserRec["role"];

const S = () => persistence.store;
const notFound = (what: string) => new HttpError(404, `${what} nicht gefunden`);

function requireUser(req: Req): UserRec {
  if (!req.user) throw new HttpError(401, "Nicht angemeldet");
  return req.user;
}
function requireRole(req: Req, ...roles: Role[]): UserRec {
  const user = requireUser(req);
  if (!roles.includes(user.role)) throw new HttpError(403, "Keine Berechtigung für diese Aktion");
  return user;
}
const admin = (req: Req) => requireRole(req, "admin");
const designer = (req: Req) => requireRole(req, "konstrukteur", "admin");
const reviewer = (req: Req) => requireRole(req, "pruefer", "admin");

// ---------------------------------------------------------------- Validierung (wie Pydantic-Schemas)

function check(errors: string[]) {
  if (errors.length) throw new HttpError(422, errors);
}
const str = (v: unknown, fallback = "") => (v === undefined || v === null ? fallback : String(v));
const isInt = (v: unknown) => typeof v === "number" && Number.isInteger(v);
function rangeErrors(body: Body, fields: [string, number, number][], allowNull = false): string[] {
  const errors: string[] = [];
  for (const [field, min, max] of fields) {
    if (!(field in body)) continue;
    const v = body[field];
    if (v === null && allowNull) continue;
    if (!isInt(v) || v < min || v > max) errors.push(`${field}: Wert zwischen ${min} und ${max} erwartet`);
  }
  return errors;
}
function pick<T extends object>(body: Body, fields: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const f of fields) if (f in body && body[f as string] !== undefined) (out as Body)[f as string] = body[f as string];
  return out;
}

// ---------------------------------------------------------------- Auditlog

function normalizeJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? {}, (_k, v) => (v === undefined ? null : v)));
}

function auditHash(e: Omit<AuditRec, "hash">): string {
  return sha256Hex(
    stableStringify({
      prev: e.prev_hash,
      ts: e.timestamp,
      user_id: e.user_id,
      username: e.username,
      action: e.action,
      entity_type: e.entity_type,
      entity_id: e.entity_id,
      summary: e.summary,
      details: e.details,
    }),
  );
}

function audit(user: UserRec | null, action: string, entityType: string, entityId: unknown, summary: string, details: unknown = {}) {
  const store = S();
  const own = store.audit.filter((e) => e.session === SESSION).length;
  const entry: Omit<AuditRec, "hash"> = {
    id: newId(),
    timestamp: nowIso(),
    user_id: user?.id ?? null,
    username: user?.username ?? "system",
    action,
    entity_type: entityType,
    entity_id: entityId === null || entityId === undefined ? "" : String(entityId),
    summary,
    details: normalizeJson(details),
    prev_hash: store.audit.length ? store.audit[store.audit.length - 1].hash : "",
    session: SESSION,
    page: Math.floor(own / AUDIT_PAGE_SIZE),
  };
  store.audit.push({ ...entry, hash: auditHash(entry) });
}

function diff(before: Body, after: Body): Json {
  const changes: Json = {};
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (stableStringify(before[key] ?? null) !== stableStringify(after[key] ?? null)) changes[key] = { alt: before[key] ?? null, neu: after[key] ?? null };
  }
  return normalizeJson(changes);
}

function verifyChain() {
  const entries = [...S().audit].sort((a, b) => a.id - b.id);
  const hashes = new Set(entries.map((e) => e.hash));
  for (const e of entries) {
    const { hash, ...rest } = e;
    if (auditHash(rest) !== hash || (e.prev_hash && !hashes.has(e.prev_hash))) return { valid: false, checked: entries.length, first_invalid_id: e.id };
  }
  return { valid: true, checked: entries.length, first_invalid_id: null };
}

// ---------------------------------------------------------------- Ausgabeformate (serializers.py)

const userById = (id: number | null | undefined) => (id ? S().users.find((u) => u.id === id) : undefined);
const userOut = (u: UserRec) => ({ id: u.id, username: u.username, full_name: u.full_name, email: u.email, role: u.role, is_active: u.is_active });
const classificationOut = (c: ClassificationRec | null) => (c ? { ...c, created_by_name: userById(c.created_by_id)?.username ?? "" } : null);

function componentOut(c: ComponentRec) {
  const { classifications, ...rest } = c;
  void classifications;
  return { ...rest, classification: classificationOut(currentClassification(c)) };
}
const componentsOf = (assemblyId: number) =>
  S()
    .components.filter((c) => c.assembly_id === assemblyId)
    .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);

function assemblyOut(a: AssemblyRec) {
  const comps = componentsOf(a.id);
  return {
    ...a,
    created_by_name: userById(a.created_by_id)?.username ?? "",
    component_count: comps.length,
    classified_count: comps.filter((c) => currentClassification(c)).length,
  };
}

function fmeaSummary(d: FmeaRec) {
  const assembly = S().assemblies.find((a) => a.id === d.assembly_id);
  return {
    id: d.id,
    fmea_number: d.fmea_number,
    version: d.version,
    status: d.status,
    title: d.title,
    created_at: d.created_at,
    created_by: userById(d.created_by_id)?.username ?? "",
    reviewed_by: userById(d.reviewed_by_id)?.username ?? "",
    rows: d.rows.length,
    ap_counts: Object.fromEntries(["H", "M", "L"].map((ap) => [ap, d.rows.filter((r) => r.action_priority === ap).length])),
    assembly_id: d.assembly_id,
    assembly_name: assembly?.name ?? "",
    assembly_drawing_number: assembly?.drawing_number ?? "",
  };
}

function assemblyDetail(a: AssemblyRec) {
  return {
    ...assemblyOut(a),
    components: componentsOf(a.id).map(componentOut),
    fmeas: S()
      .fmeas.filter((f) => f.assembly_id === a.id)
      .sort((x, y) => y.version - x.version)
      .map(fmeaSummary),
  };
}

const rowOut = (r: FmeaRowRec) => ({ ...r, rpn: r.severity * r.occurrence * r.detection });

function outdated(doc: FmeaRec): string[] {
  const snap = new Map(((doc.snapshot.components as Body[]) ?? []).map((c) => [c.component_id, c.classification_id]));
  const out: string[] = [];
  for (const c of componentsOf(doc.assembly_id)) {
    const cls = currentClassification(c);
    if (cls && snap.get(c.id) !== cls.id) out.push(`${c.drawing_number} ${cls.designation || c.name}`.trim());
  }
  return out;
}

function fmeaDetail(d: FmeaRec) {
  const assembly = S().assemblies.find((a) => a.id === d.assembly_id);
  const { rows, requirements, ...header } = d;
  return {
    ...header,
    assembly_name: assembly?.name ?? "",
    assembly_drawing_number: assembly?.drawing_number ?? "",
    created_by: userById(d.created_by_id)?.username ?? "",
    reviewed_by: userById(d.reviewed_by_id)?.username ?? "",
    rows: rows.map(rowOut),
    requirements,
    outdated_components: d.status === "ersetzt" ? [] : outdated(d),
  };
}

function optionInfo(optionId: number): { attribute: AttributeRec; option: OptionRec } | null {
  for (const attribute of S().attributes) {
    const option = attribute.options.find((o) => o.id === optionId);
    if (option) return { attribute, option };
  }
  return null;
}

function keyOut(k: KeyRec) {
  const info = optionInfo(k.option_id);
  const measures = new Map(S().measures.map((m) => [m.id, m]));
  return {
    id: k.id,
    code: k.code,
    option_id: k.option_id,
    attribute_code: info?.attribute.code ?? "",
    option_code: info?.option.code ?? "",
    option_label: info?.option.label ?? "",
    sc_level: k.sc_level,
    description: k.description,
    active: k.active,
    measures: k.measures
      .filter((km) => measures.has(km.measure_id))
      .map((km) => {
        const m = measures.get(km.measure_id)!;
        return { measure_id: m.id, code: m.code, title: m.title, measure_type: m.measure_type, extent: km.extent, rating: km.rating, effective_rating: km.rating || m.rating };
      }),
  };
}

const stdCode = (id: number | null) => (id ? (S().standards.find((s) => s.id === id)?.code ?? "") : "");
const measureOut = (m: MeasureRec) => ({ ...m, standard_code: stdCode(m.standard_id) });
const requirementOut = (r: RequirementRec) => ({ ...r, standard_code: stdCode(r.standard_id) });
function attributeOut(a: AttributeRec, includeInactive: boolean) {
  const options = sortedOptions(a).filter((o) => includeInactive || o.active);
  return { ...a, options };
}

// ---------------------------------------------------------------- Anmeldung / Benutzer

function login(req: Req) {
  const username = str(req.body.username);
  const user = S().users.find((u) => u.username === username);
  if (!user || !user.is_active) {
    audit(null, "LOGIN_FAILED", "user", user?.id ?? "", `Fehlgeschlagene Anmeldung: ${username.slice(0, 64)}`);
    throw new HttpError(401, "Benutzer unbekannt oder deaktiviert");
  }
  audit(user, "LOGIN", "user", user.id, `Anmeldung ${user.username}`);
  return { access_token: `local:${user.id}`, token_type: "bearer", user: userOut(user) };
}

const ROLES = ["konstrukteur", "pruefer", "admin"];

function createUser(req: Req) {
  const actor = admin(req);
  const b = req.body;
  const errors: string[] = [];
  if (!/^[A-Za-z0-9._-]{2,64}$/.test(str(b.username))) errors.push("username: 2–64 Zeichen, nur Buchstaben, Ziffern, . _ -");
  if (b.role !== undefined && !ROLES.includes(b.role)) errors.push("role: unbekannte Rolle");
  check(errors);
  if (S().users.some((u) => u.username === b.username)) throw new HttpError(409, "Benutzername bereits vergeben");
  const user: UserRec = {
    id: newId(),
    username: b.username,
    full_name: str(b.full_name),
    email: str(b.email),
    role: b.role ?? "konstrukteur",
    is_active: true,
    created_at: nowIso(),
  };
  S().users.push(user);
  audit(actor, "CREATE", "user", user.id, `Benutzer ${user.username} (${user.role}) angelegt`);
  return userOut(user);
}

function updateUser(req: Req) {
  const actor = admin(req);
  const user = S().users.find((u) => u.id === Number(req.params[0]));
  if (!user) throw notFound("Benutzer");
  const changes = pick<UserRec>(req.body, ["full_name", "email", "role", "is_active"]);
  if (changes.role !== undefined && !ROLES.includes(changes.role)) check(["role: unbekannte Rolle"]);
  if (user.id === actor.id && ((changes.role ?? "admin") !== "admin" || changes.is_active === false))
    throw new HttpError(400, "Eigene Admin-Rechte können nicht entzogen werden");
  const before = { full_name: user.full_name, email: user.email, role: user.role, is_active: user.is_active };
  Object.assign(user, changes);
  audit(actor, "UPDATE", "user", user.id, `Benutzer ${user.username} geändert`, diff(before, { full_name: user.full_name, email: user.email, role: user.role, is_active: user.is_active }));
  return userOut(user);
}

// ---------------------------------------------------------------- Regelwerk (catalog.py)

function updateWithAudit<T extends object>(actor: UserRec, obj: T, changes: Partial<T>, entity: string, ident: unknown, label: string) {
  const fields = Object.keys(changes) as (keyof T)[];
  const before = Object.fromEntries(fields.map((f) => [f, (obj as Body)[f as string]]));
  Object.assign(obj, changes);
  const after = Object.fromEntries(fields.map((f) => [f, (obj as Body)[f as string]]));
  const details = diff(before, after);
  if (Object.keys(details).length) audit(actor, "UPDATE", entity, ident, `${label} geändert`, details);
}

function validateDamages(codes: string[]) {
  if (!codes?.length) return;
  const valid = new Set(S().attributes.filter((a) => a.is_failure_mode).flatMap((a) => a.options.map((o) => o.code)));
  const unknown = codes.filter((c) => !valid.has(c)).sort();
  if (unknown.length) throw new HttpError(422, `Unbekannte Schadensbilder: ${unknown.join(", ")}`);
}

function validateRequirement(data: Body) {
  if ((data.sc_min ?? 0) > (data.sc_max ?? 4)) throw new HttpError(422, "SC min darf nicht größer als SC max sein");
  for (const [attrCode, codes] of Object.entries((data.conditions ?? {}) as Record<string, string[]>)) {
    const attr = S().attributes.find((a) => a.code === attrCode);
    if (!attr) throw new HttpError(422, `Unbekanntes Merkmal in Bedingung: ${attrCode}`);
    const valid = new Set(attr.options.map((o) => o.code));
    const unknown = codes.filter((c) => !valid.has(c)).sort();
    if (unknown.length) throw new HttpError(422, `Unbekannte Ausprägung(en) für ${attrCode}: ${unknown.join(", ")}`);
  }
  if (data.standard_id !== null && data.standard_id !== undefined && !S().standards.some((s) => s.id === data.standard_id))
    throw new HttpError(422, "Werknorm nicht gefunden");
}

function requirementErrors(b: Body, partial: boolean): string[] {
  const errors = rangeErrors(b, [
    ["sc_min", 0, 4],
    ["sc_max", 0, 4],
  ]);
  for (const f of ["code", "category", "text"]) if ((!partial || f in b) && !str(b[f]).trim()) errors.push(`${f}: Angabe erforderlich`);
  if ("scope" in b && !["halbzeug", "bauteil"].includes(b.scope)) errors.push("scope: halbzeug oder bauteil");
  return errors;
}

function measureErrors(b: Body, partial: boolean): string[] {
  const errors = rangeErrors(b, [["rating", 1, 10]]);
  for (const f of ["code", "title"]) if ((!partial || f in b) && !str(b[f]).trim()) errors.push(`${f}: Angabe erforderlich`);
  if ("measure_type" in b && !["V", "E"].includes(b.measure_type)) errors.push("measure_type: V oder E");
  return errors;
}

const codeUnique = <T extends { id: number; code: string }>(list: T[], code: string, exceptId?: number) => {
  if (list.some((x) => x.code === code && x.id !== exceptId)) throw new HttpError(409, "Eintrag verletzt Eindeutigkeit (Code bereits vorhanden?)");
};

function keyTargets(key: KeyRec, propagate: boolean): KeyRec[] {
  if (!propagate) return [key];
  return S()
    .keys.filter((k) => k.option_id === key.option_id && k.sc_level >= key.sc_level)
    .sort((a, b) => a.sc_level - b.sc_level);
}

// ---------------------------------------------------------------- Baugruppen (assemblies.py)

const COMPONENT_FIELDS = ["position", "level", "drawing_number", "name", "name2", "quantity", "unit", "material_pdm", "sort_order", "pdm_ref"] as const;

function newComponent(assemblyId: number, item: Body, sort: number): ComponentRec {
  return {
    id: newId(),
    assembly_id: assemblyId,
    position: str(item.position),
    level: Number(item.level ?? 1) || 1,
    drawing_number: str(item.drawing_number),
    name: str(item.name),
    name2: str(item.name2),
    quantity: Number(item.quantity ?? 1),
    unit: str(item.unit, "Stk") || "Stk",
    material_pdm: str(item.material_pdm),
    pdm_ref: str(item.pdm_ref),
    sort_order: item.sort_order ?? sort,
    classifications: [],
  };
}

function createAssembly(user: UserRec, meta: Body, items: Body[], source: string): AssemblyRec {
  const now = nowIso();
  const assembly: AssemblyRec = {
    id: newId(),
    drawing_number: str(meta.drawing_number),
    name: str(meta.name),
    revision: str(meta.revision),
    function: str(meta.function),
    description: str(meta.description),
    source,
    pdm_ref: str(meta.pdm_ref),
    created_by_id: user.id,
    created_at: now,
    updated_at: now,
  };
  S().assemblies.push(assembly);
  items.forEach((item, idx) => S().components.push(newComponent(assembly.id, item, idx * 10)));
  return assembly;
}

const getAssembly = (id: string) => {
  const a = S().assemblies.find((x) => x.id === Number(id));
  if (!a) throw notFound("Baugruppe");
  return a;
};
const getComponent = (id: string) => {
  const c = S().components.find((x) => x.id === Number(id));
  if (!c) throw notFound("Bauteil");
  return c;
};
const getFmea = (id: string) => {
  const d = S().fmeas.find((x) => x.id === Number(id));
  if (!d) throw notFound("FMEA");
  return d;
};

function componentErrors(b: Body, partial: boolean): string[] {
  const errors = rangeErrors(b, [["level", 1, 20]]);
  if ((!partial || "name" in b) && !str(b.name).trim()) errors.push("name: Angabe erforderlich");
  return errors;
}

// ---------------------------------------------------------------- Demo-PDM (pdm.py, DemoPdmConnector)

const pdmItems = () => new Map(S().pdm.items.map((i) => [i.number, i]));
const toPdmItem = (raw: PdmEntry) => ({
  number: raw.number,
  name: raw.name ?? "",
  name2: raw.name2 ?? "",
  revision: raw.revision ?? "",
  material: raw.material ?? "",
  pdm_ref: raw.pdm_ref ?? `DEMO:${raw.number}`,
  description: raw.description ?? "",
});

function pdmBom(number: string) {
  const items = pdmItems();
  const root = items.get(number);
  if (!root) throw new HttpError(404, `Baugruppe ${number} im PDM nicht gefunden`);
  const out: BomItem[] = [];
  const walk = (parent: string, level: number) => {
    for (const entry of items.get(parent)?.bom ?? []) {
      const child = items.get(entry.number);
      if (!child) continue;
      out.push({
        position: entry.position ?? "",
        level,
        drawing_number: child.number,
        name: child.name ?? "",
        name2: child.name2 ?? "",
        quantity: Number(entry.quantity ?? 1),
        unit: entry.unit ?? "Stk",
        material_pdm: child.material ?? "",
        pdm_ref: child.pdm_ref ?? `DEMO:${child.number}`,
      });
      if (child.bom?.length) walk(child.number, level + 1);
    }
  };
  walk(number, 1);
  if (!out.length) throw new HttpError(404, `${number} besitzt keine Stückliste`);
  return { assembly: toPdmItem(root), items: out };
}

// ---------------------------------------------------------------- FMEA (fmea.py)

const EDITABLE_BY_DESIGNER = new Set(["entwurf", "abgelehnt"]);
const OPT_STATUS = new Set(["", "offen", "in Bearbeitung", "umgesetzt", "verworfen"]);

function approvalBlockers(doc: FmeaRec): string[] {
  return doc.rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.action_priority === "H" && !r.opt_responsible.trim())
    .map(({ r, i }) => `Zeile ${i + 1} (${r.focus_element} / ${r.failure_mode}): AP hoch ohne Verantwortlichen für die Optimierung`);
}

export const fileName = (doc: FmeaRec, ext: string) => `${`${doc.fmea_number}_V${doc.version}`.replace(/[^A-Za-z0-9._-]+/g, "_")}.${ext}`;

// ---------------------------------------------------------------- Routen

type Handler = (req: Req) => unknown;
const routes: [string, RegExp, Handler][] = [];
const route = (method: string, pattern: string, handler: Handler) =>
  routes.push([method, new RegExp(`^${pattern.replace(/\{[a-z_]+\}/g, "([^/]+)")}$`), handler]);

// Anmeldung
route("POST", "/api/auth/login", login);
route("GET", "/api/auth/me", (req) => userOut(requireUser(req)));
route("GET", "/api/auth/login-users", () =>
  S()
    .users.filter((u) => u.is_active)
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role) || a.username.localeCompare(b.username))
    .map((u) => ({ username: u.username, full_name: u.full_name, role: u.role })),
);
route("POST", "/api/auth/change-password", () => undefined);

// Benutzer
route("GET", "/api/users", (req) => {
  admin(req);
  return [...S().users].sort((a, b) => a.username.localeCompare(b.username)).map(userOut);
});
route("POST", "/api/users", createUser);
route("PUT", "/api/users/{id}", updateUser);

// SC-Klassen
route("GET", "/api/catalog/sc-classes", (req) => {
  requireUser(req);
  return [...S().sc_classes].sort((a, b) => a.level - b.level);
});
route("PUT", "/api/catalog/sc-classes/{level}", (req) => {
  const actor = admin(req);
  const sc = S().sc_classes.find((s) => s.level === Number(req.params[0]));
  if (!sc) throw notFound("SC-Klasse");
  check(rangeErrors(req.body, [["default_severity", 1, 10]]));
  updateWithAudit(actor, sc, pick(req.body, ["name", "requirement_level", "description", "default_severity", "color"]), "sc_class", sc.level, `SC-Klasse ${sc.code}`);
  return sc;
});

// Merkmale
route("GET", "/api/catalog/attributes", (req) => {
  requireUser(req);
  const include = req.query.get("include_inactive") === "true";
  return S()
    .attributes.filter((a) => include || a.active)
    .sort((a, b) => a.list_no - b.list_no || a.sort_order - b.sort_order)
    .map((a) => attributeOut(a, include));
});
route("POST", "/api/catalog/attributes", (req) => {
  const actor = admin(req);
  const b = req.body;
  const errors: string[] = [];
  if (!/^[A-Z0-9_]{1,16}$/.test(str(b.code))) errors.push("code: 1–16 Zeichen A–Z, 0–9, _");
  if (!str(b.name).trim()) errors.push("name: Angabe erforderlich");
  if (b.list_no !== undefined && ![1, 2].includes(b.list_no)) errors.push("list_no: 1 oder 2");
  check(errors);
  if (S().attributes.some((a) => a.code === b.code)) throw new HttpError(409, "Eintrag verletzt Eindeutigkeit (Code bereits vorhanden?)");
  const attribute: AttributeRec = {
    id: newId(),
    code: b.code,
    name: b.name,
    list_no: b.list_no ?? 2,
    multi: !!b.multi,
    required: b.required ?? true,
    is_failure_mode: !!b.is_failure_mode,
    description: str(b.description),
    sort_order: b.sort_order ?? 0,
    active: b.active ?? true,
    options: [],
  };
  S().attributes.push(attribute);
  audit(actor, "CREATE", "attribute", attribute.id, `Merkmal ${attribute.code} „${attribute.name}“ angelegt`, b);
  return attributeOut(attribute, true);
});
route("PUT", "/api/catalog/attributes/{id}", (req) => {
  const actor = admin(req);
  const attribute = S().attributes.find((a) => a.id === Number(req.params[0]));
  if (!attribute) throw notFound("Merkmal");
  updateWithAudit(
    actor,
    attribute,
    pick(req.body, ["name", "list_no", "multi", "required", "is_failure_mode", "description", "sort_order", "active"]),
    "attribute",
    attribute.id,
    `Merkmal ${attribute.code}`,
  );
  return attributeOut(attribute, true);
});
route("POST", "/api/catalog/attributes/{id}/options", (req) => {
  const actor = admin(req);
  const attribute = S().attributes.find((a) => a.id === Number(req.params[0]));
  if (!attribute) throw notFound("Merkmal");
  const b = req.body;
  const errors: string[] = [];
  if (!/^[A-Z0-9_]{1,16}$/.test(str(b.code))) errors.push("code: 1–16 Zeichen A–Z, 0–9, _");
  if (!str(b.label).trim()) errors.push("label: Angabe erforderlich");
  check(errors);
  validateDamages(b.relevant_damages ?? []);
  if (attribute.options.some((o) => o.code === b.code)) throw new HttpError(409, "Eintrag verletzt Eindeutigkeit (Code bereits vorhanden?)");
  const option: OptionRec = {
    id: newId(),
    attribute_id: attribute.id,
    code: b.code,
    label: b.label,
    description: str(b.description),
    failure_cause: str(b.failure_cause),
    failure_effect: str(b.failure_effect),
    relevant_damages: b.relevant_damages ?? [],
    sort_order: b.sort_order ?? 0,
    active: b.active ?? true,
  };
  attribute.options.push(option);
  const created = ensureKeys(S());
  audit(actor, "CREATE", "attribute_option", option.id, `Ausprägung ${attribute.code}-${option.code} „${option.label}“ angelegt, ${created} Schlüssel erzeugt`, b);
  return option;
});
route("PUT", "/api/catalog/options/{id}", (req) => {
  const actor = admin(req);
  const info = optionInfo(Number(req.params[0]));
  if (!info) throw notFound("Ausprägung");
  const changes = pick<OptionRec>(req.body, ["label", "description", "failure_cause", "failure_effect", "relevant_damages", "sort_order", "active"]);
  if (changes.relevant_damages) validateDamages(changes.relevant_damages);
  updateWithAudit(actor, info.option, changes, "attribute_option", info.option.id, `Ausprägung ${info.attribute.code}-${info.option.code}`);
  return info.option;
});

// Werknormen
route("GET", "/api/catalog/standards", (req) => {
  requireUser(req);
  return [...S().standards].sort((a, b) => a.code.localeCompare(b.code));
});
route("POST", "/api/catalog/standards", (req) => {
  const actor = admin(req);
  const b = req.body;
  check([...(!str(b.code).trim() ? ["code: Angabe erforderlich"] : []), ...(!str(b.title).trim() ? ["title: Angabe erforderlich"] : [])]);
  codeUnique(S().standards, b.code);
  const standard: StandardRec = { id: newId(), code: b.code, title: b.title, revision: str(b.revision), description: str(b.description), active: b.active ?? true };
  S().standards.push(standard);
  audit(actor, "CREATE", "standard", standard.id, `Werknorm ${standard.code} angelegt`, b);
  return standard;
});
route("PUT", "/api/catalog/standards/{id}", (req) => {
  const actor = admin(req);
  const standard = S().standards.find((s) => s.id === Number(req.params[0]));
  if (!standard) throw notFound("Werknorm");
  const changes = pick<StandardRec>(req.body, ["code", "title", "revision", "description", "active"]);
  if (changes.code) codeUnique(S().standards, changes.code, standard.id);
  updateWithAudit(actor, standard, changes, "standard", standard.id, `Werknorm ${standard.code}`);
  return standard;
});
route("DELETE", "/api/catalog/standards/{id}", (req) => {
  const actor = admin(req);
  const id = Number(req.params[0]);
  const standard = S().standards.find((s) => s.id === id);
  if (!standard) throw notFound("Werknorm");
  if (S().requirements.some((r) => r.standard_id === id) || S().measures.some((m) => m.standard_id === id))
    throw new HttpError(409, "Werknorm wird noch referenziert – bitte deaktivieren statt löschen");
  audit(actor, "DELETE", "standard", id, `Werknorm ${standard.code} gelöscht`, { code: standard.code, title: standard.title });
  S().standards = S().standards.filter((s) => s.id !== id);
});

// Anforderungsregeln
route("GET", "/api/catalog/requirements", (req) => {
  requireUser(req);
  const scope = req.query.get("scope");
  const level = req.query.get("sc_level");
  const includeInactive = req.query.get("include_inactive") !== "false";
  return S()
    .requirements.filter((r) => (!scope || r.scope === scope) && (level === null || level === "" || (r.sc_min <= Number(level) && r.sc_max >= Number(level))) && (includeInactive || r.active))
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.sort_order - b.sort_order || a.code.localeCompare(b.code))
    .map(requirementOut);
});
route("POST", "/api/catalog/requirements", (req) => {
  const actor = admin(req);
  const b = req.body;
  check(requirementErrors(b, false));
  const data: RequirementRec = {
    id: newId(),
    code: b.code,
    standard_id: b.standard_id ?? null,
    scope: b.scope ?? "bauteil",
    category: b.category,
    text: b.text,
    sc_min: b.sc_min ?? 0,
    sc_max: b.sc_max ?? 4,
    conditions: b.conditions ?? {},
    sort_order: b.sort_order ?? 0,
    active: b.active ?? true,
  };
  validateRequirement(data);
  codeUnique(S().requirements, data.code);
  S().requirements.push(data);
  audit(actor, "CREATE", "requirement", data.id, `Anforderung ${data.code} angelegt`, data);
  return requirementOut(data);
});
route("PUT", "/api/catalog/requirements/{id}", (req) => {
  const actor = admin(req);
  const requirement = S().requirements.find((r) => r.id === Number(req.params[0]));
  if (!requirement) throw notFound("Anforderung");
  check(requirementErrors(req.body, true));
  const changes = pick<RequirementRec>(req.body, ["code", "standard_id", "scope", "category", "text", "sc_min", "sc_max", "conditions", "sort_order", "active"]);
  validateRequirement({ ...requirement, ...changes });
  if (changes.code) codeUnique(S().requirements, changes.code, requirement.id);
  updateWithAudit(actor, requirement, changes, "requirement", requirement.id, `Anforderung ${requirement.code}`);
  return requirementOut(requirement);
});
route("DELETE", "/api/catalog/requirements/{id}", (req) => {
  const actor = admin(req);
  const requirement = S().requirements.find((r) => r.id === Number(req.params[0]));
  if (!requirement) throw notFound("Anforderung");
  audit(actor, "DELETE", "requirement", requirement.id, `Anforderung ${requirement.code} gelöscht`, requirementDict(loadRuleset(S()), requirement));
  S().requirements = S().requirements.filter((r) => r.id !== requirement.id);
});

// Maßnahmenkatalog
route("GET", "/api/catalog/measures", (req) => {
  requireUser(req);
  return [...S().measures].sort((a, b) => b.measure_type.localeCompare(a.measure_type) || a.code.localeCompare(b.code)).map(measureOut);
});
route("POST", "/api/catalog/measures", (req) => {
  const actor = admin(req);
  const b = req.body;
  check(measureErrors(b, false));
  codeUnique(S().measures, b.code);
  const measure: MeasureRec = {
    id: newId(),
    code: b.code,
    title: b.title,
    description: str(b.description),
    measure_type: b.measure_type ?? "V",
    rating: b.rating ?? 5,
    standard_id: b.standard_id ?? null,
    active: b.active ?? true,
  };
  S().measures.push(measure);
  audit(actor, "CREATE", "measure", measure.id, `Maßnahme ${measure.code} angelegt`, b);
  return measureOut(measure);
});
route("PUT", "/api/catalog/measures/{id}", (req) => {
  const actor = admin(req);
  const measure = S().measures.find((m) => m.id === Number(req.params[0]));
  if (!measure) throw notFound("Maßnahme");
  check(measureErrors(req.body, true));
  const changes = pick<MeasureRec>(req.body, ["code", "title", "description", "measure_type", "rating", "standard_id", "active"]);
  if (changes.code) codeUnique(S().measures, changes.code, measure.id);
  updateWithAudit(actor, measure, changes, "measure", measure.id, `Maßnahme ${measure.code}`);
  return measureOut(measure);
});
route("DELETE", "/api/catalog/measures/{id}", (req) => {
  const actor = admin(req);
  const id = Number(req.params[0]);
  const measure = S().measures.find((m) => m.id === id);
  if (!measure) throw notFound("Maßnahme");
  if (S().keys.some((k) => k.measures.some((km) => km.measure_id === id)))
    throw new HttpError(409, "Maßnahme ist Schlüsseln zugeordnet – bitte deaktivieren oder Zuordnungen entfernen");
  audit(actor, "DELETE", "measure", id, `Maßnahme ${measure.code} gelöscht`, { code: measure.code, title: measure.title });
  S().measures = S().measures.filter((m) => m.id !== id);
});

// Schlüsseltabelle
route("GET", "/api/catalog/keys", (req) => {
  requireUser(req);
  const attributeCode = req.query.get("attribute_code");
  const level = req.query.get("sc_level");
  const optionId = req.query.get("option_id");
  const rows = S()
    .keys.map((k) => ({ k, info: optionInfo(k.option_id) }))
    .filter(({ info }) => info !== null)
    .filter(
      ({ k, info }) =>
        (!attributeCode || info!.attribute.code === attributeCode) &&
        (level === null || level === "" || k.sc_level === Number(level)) &&
        (optionId === null || optionId === "" || k.option_id === Number(optionId)),
    );
  rows.sort(
    (a, b) =>
      a.info!.attribute.list_no - b.info!.attribute.list_no ||
      a.info!.attribute.sort_order - b.info!.attribute.sort_order ||
      a.info!.option.sort_order - b.info!.option.sort_order ||
      a.k.sc_level - b.k.sc_level,
  );
  return rows.map(({ k }) => keyOut(k));
});
route("POST", "/api/catalog/keys/regenerate", (req) => {
  const actor = admin(req);
  const created = ensureKeys(S());
  audit(actor, "GENERATE", "key_table", "", `Schlüsseltabelle aktualisiert: ${created} neue Schlüssel`);
  return { created };
});
const getKey = (id: string) => {
  const key = S().keys.find((k) => k.id === Number(id));
  if (!key) throw notFound("Schlüssel");
  return key;
};
route("PUT", "/api/catalog/keys/{id}", (req) => {
  const actor = admin(req);
  const key = getKey(req.params[0]);
  updateWithAudit(actor, key, pick<KeyRec>(req.body, ["description", "active"]), "key", key.id, `Schlüssel ${key.code}`);
  return keyOut(key);
});
route("POST", "/api/catalog/keys/{id}/measures", (req) => {
  const actor = admin(req);
  const key = getKey(req.params[0]);
  const measure = S().measures.find((m) => m.id === Number(req.body.measure_id));
  if (!measure) throw notFound("Maßnahme");
  check(rangeErrors(req.body, [["rating", 1, 10]], true));
  const touched: string[] = [];
  for (const target of keyTargets(key, !!req.body.propagate_up)) {
    if (target.measures.some((km) => km.measure_id === measure.id)) continue;
    target.measures.push({ measure_id: measure.id, extent: str(req.body.extent), rating: req.body.rating ?? null });
    touched.push(target.code);
  }
  if (!touched.length) throw new HttpError(409, "Maßnahme ist bereits zugeordnet");
  audit(actor, "UPDATE", "key", key.id, `Maßnahme ${measure.code} zugeordnet: ${touched.join(", ")}`, {
    measure: measure.code,
    keys: touched,
    extent: str(req.body.extent),
    rating: req.body.rating ?? null,
  });
  return keyOut(key);
});
route("PUT", "/api/catalog/keys/{id}/measures/{mid}", (req) => {
  const actor = admin(req);
  const key = getKey(req.params[0]);
  const link = key.measures.find((km) => km.measure_id === Number(req.params[1]));
  if (!link) throw new HttpError(404, "Zuordnung nicht gefunden");
  check(rangeErrors(req.body, [["rating", 1, 10]], true));
  const changes: Partial<typeof link> = {};
  if (req.body.extent !== undefined && req.body.extent !== null) changes.extent = String(req.body.extent);
  if (req.body.clear_rating) changes.rating = null;
  else if (req.body.rating !== undefined && req.body.rating !== null) changes.rating = req.body.rating;
  const measure = S().measures.find((m) => m.id === link.measure_id);
  updateWithAudit(actor, link, changes, "key", key.id, `Zuordnung ${key.code} → ${measure?.code ?? link.measure_id}`);
  return keyOut(key);
});
route("DELETE", "/api/catalog/keys/{id}/measures/{mid}", (req) => {
  const actor = admin(req);
  const key = getKey(req.params[0]);
  const measureId = Number(req.params[1]);
  const removed: string[] = [];
  for (const target of keyTargets(key, req.query.get("propagate_up") === "true")) {
    const before = target.measures.length;
    target.measures = target.measures.filter((km) => km.measure_id !== measureId);
    if (target.measures.length !== before) removed.push(target.code);
  }
  if (!removed.length) throw new HttpError(404, "Zuordnung nicht gefunden");
  const measure = S().measures.find((m) => m.id === measureId);
  audit(actor, "UPDATE", "key", key.id, `Maßnahme ${measure?.code ?? measureId} entfernt: ${removed.join(", ")}`, { measure_id: measureId, keys: removed });
  return keyOut(key);
});
route("GET", "/api/catalog/consistency", (req) => {
  requireUser(req);
  return consistencyReport(loadRuleset(S()));
});
route("POST", "/api/rules/preview", (req) => {
  requireUser(req);
  check(rangeErrors(req.body, [["sc_level", 0, 4]]));
  return preview(loadRuleset(S()), req.body.values ?? {}, req.body.sc_level);
});

// Baugruppen
route("GET", "/api/assemblies", (req) => {
  requireUser(req);
  return [...S().assemblies].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map(assemblyOut);
});
route("POST", "/api/assemblies", (req) => {
  const user = designer(req);
  const b = req.body;
  check([...(!str(b.drawing_number).trim() ? ["drawing_number: Angabe erforderlich"] : []), ...(!str(b.name).trim() ? ["name: Angabe erforderlich"] : [])]);
  const { components = [], ...meta } = b;
  const assembly = createAssembly(user, meta, components, "manuell");
  audit(user, "CREATE", "assembly", assembly.id, `Baugruppe ${assembly.drawing_number} manuell angelegt`, meta);
  return assemblyDetail(assembly);
});
route("POST", "/api/assemblies/import", (req) => {
  const user = designer(req);
  const { file, fields } = req.body as { file: { name: string; text: string } | null; fields: Record<string, string> };
  if (!file) throw new HttpError(422, "Bitte eine Datei auswählen");
  let parsed;
  try {
    parsed = parseBomFile(file.name, file.text);
  } catch (err) {
    if (err instanceof BomImportError) throw new HttpError(422, err.message);
    throw err;
  }
  const stem = file.name.replace(/\.[^.]+$/, "");
  const meta = {
    drawing_number: fields.drawing_number || parsed.drawing_number || stem,
    name: fields.name || parsed.name || stem,
    revision: fields.revision || parsed.revision,
    function: fields.function ?? "",
  };
  const assembly = createAssembly(user, meta, parsed.items as unknown as Body[], parsed.source);
  audit(user, "IMPORT", "assembly", assembly.id, `Stückliste ${file.name} importiert (${parsed.items.length} Positionen)`, {
    ...meta,
    file: file.name,
    format: parsed.source,
    positions: parsed.items.length,
  });
  return assemblyDetail(assembly);
});
route("GET", "/api/assemblies/{id}", (req) => {
  requireUser(req);
  return assemblyDetail(getAssembly(req.params[0]));
});
route("PUT", "/api/assemblies/{id}", (req) => {
  const user = designer(req);
  const assembly = getAssembly(req.params[0]);
  const changes = pick<AssemblyRec>(req.body, ["drawing_number", "name", "revision", "function", "description"]);
  const before = Object.fromEntries(Object.keys(changes).map((k) => [k, (assembly as unknown as Body)[k]]));
  Object.assign(assembly, changes, { updated_at: nowIso() });
  audit(user, "UPDATE", "assembly", assembly.id, `Baugruppe ${assembly.drawing_number} geändert`, diff(before, changes));
  return assemblyDetail(assembly);
});
route("DELETE", "/api/assemblies/{id}", (req) => {
  const actor = admin(req);
  const assembly = getAssembly(req.params[0]);
  if (S().fmeas.some((f) => f.assembly_id === assembly.id && f.status === "freigegeben"))
    throw new HttpError(409, "Baugruppe besitzt freigegebene FMEAs und kann nicht gelöscht werden");
  audit(actor, "DELETE", "assembly", assembly.id, `Baugruppe ${assembly.drawing_number} gelöscht`, {
    drawing_number: assembly.drawing_number,
    name: assembly.name,
    components: componentsOf(assembly.id).length,
  });
  const store = S();
  store.assemblies = store.assemblies.filter((a) => a.id !== assembly.id);
  store.components = store.components.filter((c) => c.assembly_id !== assembly.id);
  store.fmeas = store.fmeas.filter((f) => f.assembly_id !== assembly.id);
});

// Bauteile
route("POST", "/api/assemblies/{id}/components", (req) => {
  const user = designer(req);
  const assembly = getAssembly(req.params[0]);
  check(componentErrors(req.body, false));
  const data = pick<ComponentRec>(req.body, [...COMPONENT_FIELDS]);
  const sort = data.sort_order ?? Math.max(0, ...componentsOf(assembly.id).map((c) => c.sort_order)) + 10;
  const component = newComponent(assembly.id, { ...data, sort_order: sort }, sort);
  S().components.push(component);
  audit(user, "CREATE", "component", component.id, `Bauteil ${component.drawing_number} ${component.name} zu ${assembly.drawing_number} hinzugefügt`, data);
  return componentOut(component);
});
route("GET", "/api/components/{id}", (req) => {
  requireUser(req);
  return componentOut(getComponent(req.params[0]));
});
route("PUT", "/api/components/{id}", (req) => {
  const user = designer(req);
  const component = getComponent(req.params[0]);
  check(componentErrors(req.body, true));
  const changes = pick<ComponentRec>(req.body, ["position", "level", "drawing_number", "name", "name2", "quantity", "unit", "material_pdm", "sort_order"]);
  const before = Object.fromEntries(Object.keys(changes).map((k) => [k, (component as unknown as Body)[k]]));
  Object.assign(component, changes);
  audit(user, "UPDATE", "component", component.id, `Bauteil ${component.drawing_number} geändert`, diff(before, changes));
  return componentOut(component);
});
route("DELETE", "/api/components/{id}", (req) => {
  const user = designer(req);
  const component = getComponent(req.params[0]);
  const current = currentClassification(component);
  audit(user, "DELETE", "component", component.id, `Bauteil ${component.drawing_number} ${component.name} gelöscht`, {
    drawing_number: component.drawing_number,
    name: component.name,
    classification_versions: component.classifications.length,
    last_classification: current ? { sc_level: current.sc_level, values: current.values } : null,
  });
  S().components = S().components.filter((c) => c.id !== component.id);
  for (const f of S().fmeas) for (const r of f.rows) if (r.component_id === component.id) r.component_id = null;
});

// Klassifikation
route("GET", "/api/components/{id}/classifications", (req) => {
  requireUser(req);
  return [...getComponent(req.params[0]).classifications].sort((a, b) => b.version - a.version).map(classificationOut);
});
route("POST", "/api/components/{id}/classifications", (req) => {
  const user = designer(req);
  const component = getComponent(req.params[0]);
  const b = req.body;
  check(rangeErrors(b, [["sc_level", 0, 4]]));
  const rs = loadRuleset(S());
  let normalized: Record<string, string[]>;
  try {
    normalized = validateClassification(rs, b.values ?? {}, b.sc_level);
  } catch (err) {
    if (err instanceof ClassificationError) throw new HttpError(422, err.errors);
    throw err;
  }
  const previous = currentClassification(component);
  const scChanged = previous !== null && previous.sc_level !== b.sc_level;
  if ((b.sc_level >= 2 || scChanged) && !str(b.justification).trim())
    throw new HttpError(422, ["Begründung der SC-Klasse erforderlich (ab SC2 bzw. bei Änderung der SC-Klasse)"]);
  const stored: Record<string, string | string[]> = {};
  for (const a of rs.attributes) {
    const selected = normalized[a.code] ?? [];
    if (selected.length) stored[a.code] = a.multi ? selected : selected[0];
  }
  for (const c of component.classifications) c.is_current = false;
  const classification: ClassificationRec = {
    id: newId(),
    component_id: component.id,
    version: Math.max(0, ...component.classifications.map((c) => c.version)) + 1,
    is_current: true,
    designation: str(b.designation) || component.name,
    designation2: str(b.designation2) || component.name2,
    function: str(b.function),
    sc_level: b.sc_level,
    values: stored,
    justification: str(b.justification),
    created_by_id: user.id,
    created_at: nowIso(),
  };
  component.classifications.push(classification);
  const snapshot = (c: ClassificationRec | null) =>
    c
      ? { sc_level: c.sc_level, designation: c.designation, designation2: c.designation2, function: c.function, values: c.values, justification: c.justification }
      : {};
  audit(
    user,
    "CLASSIFY",
    "component",
    component.id,
    `${component.drawing_number} ${classification.designation}: Klassifikation v${classification.version} – SC${b.sc_level}` +
      (scChanged && previous ? ` (vorher SC${previous.sc_level})` : ""),
    {
      classification_id: classification.id,
      version: classification.version,
      changes: diff(snapshot(previous), snapshot(classification)),
      derived_requirements: deriveRequirements(rs, normalized, b.sc_level).map((r) => r.code),
      keys: resolveKeys(rs, normalized, b.sc_level).map((k) => k.code),
    },
  );
  return classificationOut(classification);
});

// PDM (Demo-Datenbestand)
route("GET", "/api/pdm/status", (req) => {
  requireUser(req);
  return { connector: "demo", connected: true, message: "Demo-PDM im Browser (Beispieldaten, Rückspeicherung wird protokolliert)" };
});
route("GET", "/api/pdm/search", (req) => {
  requireUser(req);
  const q = (req.query.get("q") ?? "").toLowerCase().trim();
  return S()
    .pdm.items.filter((i) => !q || i.number.toLowerCase().includes(q) || (i.name ?? "").toLowerCase().includes(q))
    .map(toPdmItem);
});
route("GET", "/api/pdm/items/{number}", (req) => {
  requireUser(req);
  const item = pdmItems().get(decodeURIComponent(req.params[0]));
  if (!item) throw new HttpError(404, `Objekt ${req.params[0]} im PDM nicht gefunden`);
  return toPdmItem(item);
});
route("POST", "/api/pdm/import", (req) => {
  const user = designer(req);
  const bom = pdmBom(str(req.body.drawing_number));
  const meta = {
    drawing_number: bom.assembly.number,
    name: bom.assembly.name || bom.assembly.number,
    revision: bom.assembly.revision,
    function: str(req.body.function),
    description: bom.assembly.description,
    pdm_ref: bom.assembly.pdm_ref,
  };
  const assembly = createAssembly(user, meta, bom.items as unknown as Body[], "pdm:demo");
  audit(user, "IMPORT", "assembly", assembly.id, `Baugruppe ${assembly.drawing_number} aus PDM (demo) übernommen, ${bom.items.length} Positionen`, {
    ...meta,
    positions: bom.items.length,
  });
  return assemblyDetail(assembly);
});
route("POST", "/api/assemblies/{id}/pdm-refresh", (req) => {
  const user = designer(req);
  const assembly = getAssembly(req.params[0]);
  const bom = pdmBom(assembly.drawing_number);
  const existing = new Map(componentsOf(assembly.id).map((c) => [`${c.drawing_number}|${c.position}`, c]));
  const added: string[] = [];
  const updated: string[] = [];
  const seen = new Set<string>();
  let sort = Math.max(0, ...componentsOf(assembly.id).map((c) => c.sort_order)) + 10;
  for (const item of bom.items) {
    const key = `${item.drawing_number}|${item.position}`;
    seen.add(key);
    const component = existing.get(key);
    if (!component) {
      S().components.push(newComponent(assembly.id, item as unknown as Body, sort));
      sort += 10;
      added.push(item.drawing_number);
      continue;
    }
    let changed = false;
    for (const f of ["name", "name2", "quantity", "unit", "material_pdm", "level", "pdm_ref"] as const) {
      if ((component as unknown as Body)[f] !== (item as unknown as Body)[f]) {
        (component as unknown as Body)[f] = (item as unknown as Body)[f];
        changed = true;
      }
    }
    if (changed) updated.push(component.drawing_number);
  }
  const removed = [...existing.entries()].filter(([k]) => !seen.has(k)).map(([, c]) => c.drawing_number);
  assembly.updated_at = nowIso();
  audit(
    user,
    "PDM_SYNC",
    "assembly",
    assembly.id,
    `Stückliste ${assembly.drawing_number} aus PDM aktualisiert: ${added.length} neu, ${updated.length} geändert, ${removed.length} entfallen`,
    { added, updated, removed_in_pdm: removed },
  );
  return assemblyDetail(assembly);
});

// FMEA
route("POST", "/api/assemblies/{id}/fmea/generate", (req) => {
  const user = designer(req);
  const assembly = getAssembly(req.params[0]);
  let doc: FmeaRec;
  try {
    doc = generateFmea(S(), assembly.id, user, req.body);
  } catch (err) {
    throw new HttpError(422, (err as Error).message);
  }
  S().fmeas.push(doc);
  const snap = doc.snapshot as Body;
  audit(user, "GENERATE", "fmea", doc.id, `${doc.fmea_number} Version ${doc.version} generiert: ${doc.rows.length} Zeilen, ${doc.requirements.length} Anforderungen`, {
    assembly: assembly.drawing_number,
    version: doc.version,
    ruleset_fingerprint: snap.ruleset_fingerprint,
    classifications: Object.fromEntries((snap.components as Body[]).map((c) => [c.label, `v${c.classification_version} SC${c.sc_level}`])),
    ap_counts: snap.ap_counts,
    warnings: doc.warnings,
    content_hash: doc.content_hash,
  });
  return fmeaDetail(doc);
});
route("GET", "/api/fmea", (req) => {
  requireUser(req);
  const status = req.query.get("status");
  const assemblyId = req.query.get("assembly_id");
  return S()
    .fmeas.filter((f) => (!status || status.split(",").includes(f.status)) && (!assemblyId || f.assembly_id === Number(assemblyId)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map(fmeaSummary);
});
route("GET", "/api/fmea/{id}", (req) => {
  requireUser(req);
  return fmeaDetail(getFmea(req.params[0]));
});
route("PUT", "/api/fmea/{id}", (req) => {
  const user = designer(req);
  const doc = getFmea(req.params[0]);
  if (!EDITABLE_BY_DESIGNER.has(doc.status)) throw new HttpError(409, "Kopfdaten sind nur im Entwurf änderbar");
  const changes = pick<FmeaRec>(req.body, ["title", "team", "responsible", "confidentiality"]);
  const before = Object.fromEntries(Object.keys(changes).map((k) => [k, (doc as unknown as Body)[k]]));
  Object.assign(doc, changes);
  audit(user, "UPDATE", "fmea", doc.id, `${doc.fmea_number} V${doc.version}: Kopfdaten geändert`, diff(before, changes));
  return fmeaDetail(doc);
});
route("DELETE", "/api/fmea/{id}", (req) => {
  const user = designer(req);
  const doc = getFmea(req.params[0]);
  if (!EDITABLE_BY_DESIGNER.has(doc.status)) throw new HttpError(409, "Nur Entwürfe können gelöscht werden");
  if (user.role !== "admin" && doc.created_by_id !== user.id) throw new HttpError(403, "Nur der Ersteller oder ein Admin kann den Entwurf löschen");
  audit(user, "DELETE", "fmea", doc.id, `Entwurf ${doc.fmea_number} V${doc.version} gelöscht`, {
    version: doc.version,
    rows: doc.rows.length,
    content_hash: doc.content_hash,
  });
  S().fmeas = S().fmeas.filter((f) => f.id !== doc.id);
});
route("PUT", "/api/fmea/{id}/rows/{rid}", (req) => {
  const user = requireUser(req);
  const doc = getFmea(req.params[0]);
  let allowed: Role[];
  if (EDITABLE_BY_DESIGNER.has(doc.status)) allowed = ["konstrukteur", "admin"];
  else if (doc.status === "in_pruefung") allowed = ["pruefer", "admin"];
  else throw new HttpError(409, "Freigegebene bzw. ersetzte FMEAs sind schreibgeschützt");
  if (!allowed.includes(user.role)) throw new HttpError(403, "Keine Berechtigung, diese FMEA im aktuellen Status zu bearbeiten");
  const row = doc.rows.find((r) => r.id === Number(req.params[1]));
  if (!row) throw new HttpError(404, "Zeile nicht gefunden");
  const b = req.body;
  const errors = rangeErrors(
    b,
    [
      ["severity", 1, 10],
      ["occurrence", 1, 10],
      ["detection", 1, 10],
    ],
    false,
  ).concat(
    rangeErrors(
      b,
      [
        ["opt_occurrence", 1, 10],
        ["opt_detection_rating", 1, 10],
      ],
      true,
    ),
  );
  if ("opt_status" in b && b.opt_status !== null && !OPT_STATUS.has(b.opt_status)) errors.push("opt_status: unbekannter Status");
  check(errors);
  const before = Object.fromEntries(EDITABLE_ROW_FIELDS.map((f) => [f, row[f]]));
  for (const f of EDITABLE_ROW_FIELDS) if (f in b && b[f] !== undefined) (row as unknown as Body)[f] = b[f];
  recalculateRow(row);
  const details = diff(before, Object.fromEntries(EDITABLE_ROW_FIELDS.map((f) => [f, row[f]])));
  if (!Object.keys(details).length) return rowOut(row);
  row.manually_edited = true;
  doc.content_hash = computeContentHash(doc);
  audit(user, "UPDATE", "fmea", doc.id, `${doc.fmea_number} V${doc.version}: Zeile ${row.focus_element} / ${row.failure_mode} bearbeitet (AP ${row.action_priority})`, {
    row_id: row.id,
    changes: details,
    reason: str(b.change_reason),
  });
  return rowOut(row);
});
route("POST", "/api/fmea/{id}/submit", (req) => {
  const user = designer(req);
  const doc = getFmea(req.params[0]);
  if (!EDITABLE_BY_DESIGNER.has(doc.status)) throw new HttpError(409, "Nur Entwürfe können zur Prüfung eingereicht werden");
  doc.status = "in_pruefung";
  doc.submitted_at = nowIso();
  audit(user, "SUBMIT", "fmea", doc.id, `${doc.fmea_number} V${doc.version} zur Prüfung eingereicht`, { content_hash: doc.content_hash });
  return fmeaDetail(doc);
});
route("POST", "/api/fmea/{id}/approve", (req) => {
  const user = reviewer(req);
  const doc = getFmea(req.params[0]);
  if (doc.status !== "in_pruefung") throw new HttpError(409, "Nur FMEAs im Status „In Prüfung“ können freigegeben werden");
  if (doc.created_by_id === user.id) throw new HttpError(403, "Vier-Augen-Prinzip: Der Ersteller darf die eigene FMEA nicht freigeben");
  const blockers = approvalBlockers(doc);
  if (blockers.length) throw new HttpError(422, blockers);
  for (const old of S().fmeas.filter((f) => f.assembly_id === doc.assembly_id && f.status === "freigegeben" && f.id !== doc.id)) {
    old.status = "ersetzt";
    audit(user, "SUPERSEDE", "fmea", old.id, `${old.fmea_number} V${old.version} durch V${doc.version} ersetzt`);
  }
  doc.status = "freigegeben";
  doc.reviewed_by_id = user.id;
  doc.reviewed_at = nowIso();
  doc.review_comment = str(req.body.comment);
  doc.content_hash = computeContentHash(doc);
  audit(user, "APPROVE", "fmea", doc.id, `${doc.fmea_number} V${doc.version} freigegeben`, { comment: doc.review_comment, content_hash: doc.content_hash });
  return fmeaDetail(doc);
});
route("POST", "/api/fmea/{id}/reject", (req) => {
  const user = reviewer(req);
  const doc = getFmea(req.params[0]);
  if (doc.status !== "in_pruefung") throw new HttpError(409, "Nur FMEAs im Status „In Prüfung“ können zurückgewiesen werden");
  if (!str(req.body.comment).trim()) throw new HttpError(422, "Bitte Begründung für die Zurückweisung angeben");
  doc.status = "abgelehnt";
  doc.reviewed_by_id = user.id;
  doc.reviewed_at = nowIso();
  doc.review_comment = str(req.body.comment);
  audit(user, "REJECT", "fmea", doc.id, `${doc.fmea_number} V${doc.version} zurückgewiesen`, { comment: doc.review_comment });
  return fmeaDetail(doc);
});
route("POST", "/api/fmea/{id}/pdm-store", (req) => {
  const user = requireUser(req);
  const doc = getFmea(req.params[0]);
  if (doc.status !== "freigegeben") throw new HttpError(409, "Nur freigegebene FMEAs werden ins PDM zurückgespeichert");
  const assembly = S().assemblies.find((a) => a.id === doc.assembly_id)!;
  const target = assembly.pdm_ref || assembly.drawing_number;
  const refs = ["xlsx", "pdf"].map((ext) => `demo-pdm://${target.replace(/[^A-Za-z0-9._-]+/g, "_")}/${fileName(doc, ext)}`);
  doc.pdm_status = "gespeichert";
  doc.pdm_ref = refs.join("; ");
  doc.pdm_synced_at = nowIso();
  audit(user, "PDM_STORE", "fmea", doc.id, `${doc.fmea_number} V${doc.version} im PDM (demo, Browser-Version) vermerkt`, {
    refs,
    fmea_number: doc.fmea_number,
    version: doc.version,
    content_hash: doc.content_hash,
    assembly: assembly.drawing_number,
  });
  return fmeaDetail(doc);
});
route("GET", "/api/fmea/{id}/history", (req) => {
  requireUser(req);
  const id = String(Number(req.params[0]));
  return S()
    .audit.filter((a) => a.entity_type === "fmea" && a.entity_id === id)
    .sort((a, b) => b.id - a.id);
});
route("GET", "/api/fmea/{id}/compare/{other}", (req) => {
  requireUser(req);
  const current = getFmea(req.params[0]);
  const base = getFmea(req.params[1]);
  if (current.assembly_id !== base.assembly_id) throw new HttpError(422, "Nur Versionen derselben Baugruppe sind vergleichbar");
  const fields = ["severity", "occurrence", "detection", "action_priority", "prevention_controls", "detection_controls", "failure_cause", "failure_effect", "special_characteristic"] as const;
  const keyOf = (r: FmeaRowRec) => JSON.stringify([r.component_id, r.failure_mode, r.lower_level]);
  const baseRows = new Map(base.rows.map((r) => [keyOf(r), r]));
  const currentRows = new Map(current.rows.map((r) => [keyOf(r), r]));
  const changed = [];
  for (const [k, row] of currentRows) {
    const old = baseRows.get(k);
    if (!old) continue;
    const d = Object.fromEntries(fields.filter((f) => old[f] !== row[f]).map((f) => [f, { alt: old[f], neu: row[f] }]));
    if (Object.keys(d).length) changed.push({ focus_element: row.focus_element, failure_mode: row.failure_mode, lower_level: row.lower_level, changes: d });
  }
  const reqKeys = (d: FmeaRec) => new Set(d.requirements.map((r) => `${r.component_label}: ${r.requirement_code}`));
  const baseReqs = reqKeys(base);
  const currentReqs = reqKeys(current);
  return {
    base: { id: base.id, version: base.version },
    current: { id: current.id, version: current.version },
    rows_added: [...currentRows].filter(([k]) => !baseRows.has(k)).map(([, r]) => rowOut(r)),
    rows_removed: [...baseRows].filter(([k]) => !currentRows.has(k)).map(([, r]) => rowOut(r)),
    rows_changed: changed,
    requirements_added: [...currentReqs].filter((r) => !baseReqs.has(r)).sort(),
    requirements_removed: [...baseReqs].filter((r) => !currentReqs.has(r)).sort(),
    fingerprint_changed: (base.snapshot as Body).ruleset_fingerprint !== (current.snapshot as Body).ruleset_fingerprint,
  };
});

// Auditlog
route("GET", "/api/audit", (req) => {
  reviewer(req);
  const q = req.query;
  const actions = q.get("action")?.split(",");
  const text = q.get("q")?.toLowerCase();
  const items = S()
    .audit.filter(
      (a) =>
        (!q.get("entity_type") || a.entity_type === q.get("entity_type")) &&
        (!q.get("entity_id") || a.entity_id === q.get("entity_id")) &&
        (!actions || actions.includes(a.action)) &&
        (!q.get("username") || a.username === q.get("username")) &&
        (!text || a.summary.toLowerCase().includes(text)),
    )
    .sort((a, b) => b.id - a.id);
  const limit = Math.min(500, Math.max(1, Number(q.get("limit") ?? 50)));
  const offset = Math.max(0, Number(q.get("offset") ?? 0));
  return { total: items.length, items: items.slice(offset, offset + limit) };
});
route("GET", "/api/audit/verify", (req) => {
  reviewer(req);
  return verifyChain();
});

// Übersicht
route("GET", "/api/dashboard", (req) => {
  const user = requireUser(req);
  const store = S();
  const current = store.components.map(currentClassification).filter((c): c is ClassificationRec => c !== null);
  const statusCounts: Record<string, number> = {};
  for (const f of store.fmeas) statusCounts[f.status] = (statusCounts[f.status] ?? 0) + 1;
  const ap = { H: 0, M: 0, L: 0 } as Record<string, number>;
  for (const f of store.fmeas) if (f.status !== "ersetzt") for (const r of f.rows) ap[r.action_priority] = (ap[r.action_priority] ?? 0) + 1;
  const recent = [...store.audit]
    .filter((a) => user.role !== "konstrukteur" || a.user_id === user.id)
    .sort((a, b) => b.id - a.id)
    .slice(0, 8);
  return {
    assemblies: store.assemblies.length,
    components: store.components.length,
    classified: current.length,
    sc_distribution: Object.fromEntries([0, 1, 2, 3, 4].map((l) => [`SC${l}`, current.filter((c) => c.sc_level === l).length])),
    fmea_status: statusCounts,
    action_priority: { H: ap.H, M: ap.M, L: ap.L },
    pending_reviews: store.fmeas
      .filter((f) => f.status === "in_pruefung")
      .sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""))
      .map((d) => ({
        id: d.id,
        fmea_number: d.fmea_number,
        version: d.version,
        assembly_name: store.assemblies.find((a) => a.id === d.assembly_id)?.name ?? "",
        submitted_at: d.submitted_at,
      })),
    recent_activity: recent,
  };
});

// ---------------------------------------------------------------- Einstiegspunkte

export function recordSeed() {
  audit(null, "SEED", "catalog", "", "Datenbestand mit Musterregelwerk und Demodaten angelegt (Browser-Version)");
}

export function currentUser(token: string | null): UserRec | null {
  const match = /^local:(\d+)$/.exec(token ?? "");
  if (!match) return null;
  const user = S().users.find((u) => u.id === Number(match[1]));
  return user && user.is_active ? user : null;
}

export function handle(method: string, rawPath: string, body: unknown, token: string | null): unknown {
  const url = new URL(rawPath, "http://local");
  const user = currentUser(token);
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const match = pattern.exec(url.pathname);
    if (!match) continue;
    const result = handler({ method, query: url.searchParams, params: match.slice(1), body: (body ?? {}) as Body, user });
    return result === undefined ? undefined : clone(result);
  }
  throw new HttpError(404, `Unbekannter API-Pfad: ${url.pathname}`);
}

/** Export-Dateien: gibt Dateiname und Inhalt zurück (Audit-Eintrag inklusive). */
export async function exportFile(rawPath: string, token: string | null): Promise<{ filename: string; blob: Blob }> {
  const user = currentUser(token);
  if (!user) throw new HttpError(401, "Nicht angemeldet");
  const match = /^\/api\/fmea\/(\d+)\/export\.(xlsx|pdf)$/.exec(new URL(rawPath, "http://local").pathname);
  if (!match) throw new HttpError(404, "Unbekannter Export");
  const doc = clone(getFmea(match[1]));
  const store: Store = persistence.store;
  const blob = match[2] === "xlsx" ? await buildWorkbook(store, doc) : await buildPdf(store, doc);
  const live = S().fmeas.find((f) => f.id === doc.id);
  if (live) audit(user, "EXPORT", "fmea", live.id, `${live.fmea_number} V${live.version} als ${match[2] === "xlsx" ? "Excel" : "PDF"} exportiert`);
  return { filename: fileName(doc, match[2]), blob };
}
