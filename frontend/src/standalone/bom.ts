/** Stücklisten-Import (CSV/XML) – Portierung von backend/app/services/bom_import.py. */

export class BomImportError extends Error {}

export interface BomItem {
  position: string;
  level: number;
  drawing_number: string;
  name: string;
  name2: string;
  quantity: number;
  unit: string;
  material_pdm: string;
  pdm_ref: string;
}

export interface ParsedBom {
  drawing_number: string;
  name: string;
  revision: string;
  items: BomItem[];
  source: "csv" | "xml";
}

const FIELD_SYNONYMS: Record<string, string[]> = {
  position: ["pos", "position", "posnr", "positionsnummer", "artikel", "item", "item number", "find number"],
  level: ["ebene", "stufe", "level", "strukturstufe", "strukturebene"],
  drawing_number: [
    "zeichnungsnummer",
    "zeichnungsnr",
    "zeichnung",
    "bauteilnummer",
    "teilenummer",
    "teilnummer",
    "sachnummer",
    "artikelnummer",
    "part number",
    "partnumber",
    "drawing number",
    "drawingnumber",
    "nummer",
    "number",
  ],
  name: ["benennung", "bezeichnung", "beschreibung", "description", "name", "titel", "title"],
  name2: ["benennung 2", "benennung2", "bezeichnung 2", "bezeichnung2", "zusatzbenennung", "beschreibung 2", "description 2", "name2"],
  quantity: ["menge", "anzahl", "stückzahl", "stueckzahl", "qty", "quantity", "anz"],
  unit: ["einheit", "me", "mengeneinheit", "unit", "uom"],
  material: ["material", "werkstoff", "werkstoffbezeichnung"],
  pdm_ref: ["pdm-id", "pdm id", "pdmid", "element key", "elementkey", "key", "id"],
};

const ITEM_TAGS = new Set(["item", "position", "bauteil", "part", "component", "row", "bomitem", "element"]);
const ROOT_TAGS = new Set(["bom", "stueckliste", "stückliste", "assembly", "baugruppe", "structure"]);

const normalizeHeader = (h: string) =>
  h
    .trim()
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/[.:]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const LOOKUP = new Map<string, string>();
for (const [target, synonyms] of Object.entries(FIELD_SYNONYMS)) for (const s of synonyms) LOOKUP.set(normalizeHeader(s), target);

export function mapField(name: string): string | null {
  const n = normalizeHeader(name);
  if (LOOKUP.has(n)) return LOOKUP.get(n)!;
  const compact = n.replace(/ /g, "");
  for (const [key, target] of LOOKUP) if (key.replace(/ /g, "") === compact) return target;
  return null;
}

function parseQuantity(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 1;
  let text = String(raw).trim().replace(/ /g, "").replace(/[^0-9,.-]/g, "");
  text = text.includes(",") && text.includes(".") ? text.replace(/\./g, "").replace(",", ".") : text.replace(",", ".");
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : 1;
}

function finalize(items: Record<string, unknown>[]): BomItem[] {
  const result: BomItem[] = [];
  items.forEach((raw, idx) => {
    const name = String(raw.name ?? "").trim();
    const number = String(raw.drawing_number ?? "").trim();
    if (!name && !number) return;
    const position = String(raw.position ?? "").trim() || String((idx + 1) * 10);
    let level = 1;
    if (raw.level !== undefined && raw.level !== null && raw.level !== "") {
      const parsed = Number.parseFloat(String(raw.level).replace(",", "."));
      level = Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1;
    } else if (/^\d+(\.\d+)+$/.test(position)) {
      level = position.split(".").length;
    }
    result.push({
      position,
      level,
      drawing_number: number,
      name: name || number,
      name2: String(raw.name2 ?? "").trim(),
      quantity: parseQuantity(raw.quantity),
      unit: String(raw.unit ?? "Stk").trim() || "Stk",
      material_pdm: String(raw.material ?? "").trim(),
      pdm_ref: String(raw.pdm_ref ?? "").trim(),
    });
  });
  if (!result.length) throw new BomImportError("Die Datei enthält keine verwertbaren Stücklistenpositionen");
  return result;
}

export function decode(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text: string): ParsedBom {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new BomImportError("Die CSV-Datei ist leer");
  const sample = lines.slice(0, 10).join("\n");
  const delimiter = [";", "\t", ",", "|"].reduce((best, d) => (sample.split(d).length > sample.split(best).length ? d : best), ";");
  const rows = lines.map((l) => splitCsvLine(l, delimiter));
  let headerIdx = -1;
  let mapping = new Map<number, string>();
  for (let idx = 0; idx < Math.min(rows.length, 15); idx++) {
    const candidate = new Map<number, string>();
    rows[idx].forEach((col, i) => {
      const f = mapField(col);
      if (f) candidate.set(i, f);
    });
    const values = new Set(candidate.values());
    if (values.has("name") || values.has("drawing_number")) {
      headerIdx = idx;
      mapping = candidate;
      break;
    }
  }
  if (headerIdx < 0)
    throw new BomImportError("Keine Kopfzeile erkannt. Erwartet werden z. B. die Spalten Pos;Zeichnungsnummer;Benennung;Menge;Material");
  const seen = new Set<string>();
  const unique = new Map<number, string>();
  [...mapping.entries()].sort((a, b) => a[0] - b[0]).forEach(([i, f]) => {
    if (!seen.has(f)) {
      seen.add(f);
      unique.set(i, f);
    }
  });
  const items = rows.slice(headerIdx + 1).map((row) => {
    const item: Record<string, unknown> = {};
    unique.forEach((target, i) => {
      if (i < row.length) item[target] = row[i];
    });
    return item;
  });
  return { drawing_number: "", name: "", revision: "", items: finalize(items), source: "csv" };
}

const local = (el: Element) => el.localName.toLowerCase();
const isItem = (el: Element) => ITEM_TAGS.has(local(el)) && (el.children.length > 0 || el.attributes.length > 0);

function fieldsOf(el: Element): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const attr of Array.from(el.attributes)) {
    const target = mapField(attr.name);
    if (target && !(target in data)) data[target] = attr.value;
  }
  for (const child of Array.from(el.children)) {
    if (isItem(child) || child.children.length) continue;
    const target = mapField(local(child));
    if (target && child.textContent && !(target in data)) data[target] = child.textContent.trim();
  }
  return data;
}

function collectItems(el: Element, level: number, out: Record<string, unknown>[]) {
  for (const child of Array.from(el.children)) {
    if (isItem(child)) {
      const item = fieldsOf(child);
      if (!("level" in item)) item.level = level;
      out.push(item);
      collectItems(child, level + 1, out);
    } else if (child.children.length) {
      collectItems(child, level, out);
    }
  }
}

export function parseXml(text: string): ParsedBom {
  if (/<!DOCTYPE[^>]*\[/i.test(text) || /<!ENTITY/i.test(text))
    throw new BomImportError("XML-Datei konnte nicht gelesen werden: DTD/Entitäten sind nicht erlaubt");
  const xml = new DOMParser().parseFromString(text, "application/xml");
  const error = xml.getElementsByTagName("parsererror")[0];
  if (error) throw new BomImportError(`XML-Datei konnte nicht gelesen werden: ${error.textContent?.trim().split("\n")[0] ?? ""}`);
  const root = xml.documentElement;
  let headerEl: Element = root;
  if (!ROOT_TAGS.has(local(root))) headerEl = Array.from(root.children).find((c) => ROOT_TAGS.has(local(c))) ?? root;
  const header = fieldsOf(headerEl);
  const attrs = Object.fromEntries(Array.from(headerEl.attributes).map((a) => [a.name.toLowerCase(), a.value]));
  const items: Record<string, unknown>[] = [];
  collectItems(root, 1, items);
  return {
    drawing_number: String(header.drawing_number ?? ""),
    name: String(header.name ?? ""),
    revision: attrs.revision || attrs.rev || attrs.index || attrs.aenderungsindex || "",
    items: finalize(items),
    source: "xml",
  };
}

export function parseBomFile(filename: string, text: string): ParsedBom {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xml")) return parseXml(text);
  if (lower.endsWith(".csv") || lower.endsWith(".txt") || lower.endsWith(".tsv")) return parseCsv(text);
  return text.trimStart().startsWith("<") ? parseXml(text) : parseCsv(text);
}
