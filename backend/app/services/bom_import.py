"""Import von Stücklisten (BOM) aus CSV- und XML-Dateien.

Unterstützt u. a. die Spaltenbezeichnungen der Autodesk-Inventor-Stücklistenexporte (Pos., Bauteilnummer,
Menge, Beschreibung, Material) sowie gängige PDM-Exporte. Strukturstufen werden aus einer Ebenen-Spalte,
aus der Positionsnummer (1.2.3) oder – bei XML – aus der Verschachtelung abgeleitet.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from typing import Any
from xml.etree.ElementTree import Element

from defusedxml import ElementTree as SafeET

FIELD_SYNONYMS: dict[str, tuple[str, ...]] = {
    "position": ("pos", "position", "posnr", "positionsnummer", "artikel", "item", "item number", "find number"),
    "level": ("ebene", "stufe", "level", "strukturstufe", "strukturebene"),
    "drawing_number": (
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
    ),
    "name": ("benennung", "bezeichnung", "beschreibung", "description", "name", "titel", "title"),
    "name2": (
        "benennung 2",
        "benennung2",
        "bezeichnung 2",
        "bezeichnung2",
        "zusatzbenennung",
        "beschreibung 2",
        "description 2",
        "name2",
    ),
    "quantity": ("menge", "anzahl", "stückzahl", "stueckzahl", "qty", "quantity", "anz"),
    "unit": ("einheit", "me", "mengeneinheit", "unit", "uom"),
    "material": ("material", "werkstoff", "werkstoffbezeichnung"),
    "pdm_ref": ("pdm-id", "pdm id", "pdmid", "element key", "elementkey", "key", "id"),
}

ITEM_TAGS = {"item", "position", "bauteil", "part", "component", "row", "bomitem", "element"}
ROOT_TAGS = {"bom", "stueckliste", "stückliste", "assembly", "baugruppe", "structure"}


class BomImportError(ValueError):
    pass


@dataclass
class ParsedBom:
    drawing_number: str = ""
    name: str = ""
    revision: str = ""
    items: list[dict[str, Any]] = field(default_factory=list)
    source: str = ""


def _normalize_header(header: str) -> str:
    h = header.strip().lower().replace("_", " ").replace("-", " ")
    h = re.sub(r"[.:]", "", h)
    return re.sub(r"\s+", " ", h).strip()


def _lookup() -> dict[str, str]:
    table: dict[str, str] = {}
    for target, synonyms in FIELD_SYNONYMS.items():
        for synonym in synonyms:
            table[_normalize_header(synonym)] = target
    return table


_HEADER_LOOKUP = _lookup()


def map_field(name: str) -> str | None:
    normalized = _normalize_header(name)
    if normalized in _HEADER_LOOKUP:
        return _HEADER_LOOKUP[normalized]
    compact = normalized.replace(" ", "")
    for key, target in _HEADER_LOOKUP.items():
        if key.replace(" ", "") == compact:
            return target
    return None


def _parse_quantity(raw: Any) -> float:
    if raw in (None, ""):
        return 1.0
    text = str(raw).strip().replace(" ", "")
    text = re.sub(r"[^0-9,.\-]", "", text)
    if "," in text and "." in text:
        text = text.replace(".", "").replace(",", ".")
    else:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return 1.0


def _finalize(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = []
    for idx, raw in enumerate(items, start=1):
        name = (raw.get("name") or "").strip()
        number = (raw.get("drawing_number") or "").strip()
        if not name and not number:
            continue
        position = (raw.get("position") or "").strip() or str(idx * 10)
        level_raw = raw.get("level")
        if level_raw not in (None, ""):
            try:
                level = max(1, int(float(str(level_raw).replace(",", "."))))
            except ValueError:
                level = 1
        elif re.fullmatch(r"\d+(\.\d+)+", position):
            level = position.count(".") + 1
        else:
            level = 1
        result.append(
            {
                "position": position,
                "level": level,
                "drawing_number": number,
                "name": name or number,
                "name2": (raw.get("name2") or "").strip(),
                "quantity": _parse_quantity(raw.get("quantity")),
                "unit": (raw.get("unit") or "Stk").strip() or "Stk",
                "material_pdm": (raw.get("material") or "").strip(),
                "pdm_ref": (raw.get("pdm_ref") or "").strip(),
            }
        )
    if not result:
        raise BomImportError("Die Datei enthält keine verwertbaren Stücklistenpositionen")
    return result


def _decode(content: bytes) -> str:
    for encoding in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise BomImportError("Zeichenkodierung der Datei nicht erkannt")


def parse_csv(content: bytes) -> ParsedBom:
    text = _decode(content)
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        raise BomImportError("Die CSV-Datei ist leer")
    sample = "\n".join(lines[:10])
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=";,\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ";" if sample.count(";") >= sample.count(",") else ","
    reader = csv.reader(io.StringIO("\n".join(lines)), delimiter=delimiter)
    rows = list(reader)
    header_idx = None
    mapping: dict[int, str] = {}
    # Kopfzeile innerhalb der ersten Zeilen suchen (Inventor-Exporte haben teils Vorspann)
    for idx, row in enumerate(rows[:15]):
        candidate = {i: map_field(col) for i, col in enumerate(row)}
        candidate = {i: f for i, f in candidate.items() if f}
        if set(candidate.values()) & {"name", "drawing_number"}:
            header_idx, mapping = idx, candidate
            break
    if header_idx is None:
        raise BomImportError(
            "Keine Kopfzeile erkannt. Erwartet werden z. B. die Spalten Pos;Zeichnungsnummer;Benennung;Menge;Material"
        )
    # Bei doppelter Zuordnung gewinnt die erste Spalte
    seen: set[str] = set()
    mapping = {i: f for i, f in sorted(mapping.items()) if not (f in seen or seen.add(f))}
    items = []
    for row in rows[header_idx + 1 :]:
        item = {target: row[i] for i, target in mapping.items() if i < len(row)}
        items.append(item)
    return ParsedBom(items=_finalize(items), source="csv")


def _local(tag: str) -> str:
    return tag.split("}", 1)[-1].lower()


def _is_item(element: Element) -> bool:
    """<Item>/<Position>/… mit Attributen oder Kindelementen ist eine Stücklistenposition;
    ein reines Textelement wie <Position>30</Position> ist dagegen ein Feld."""
    return _local(element.tag) in ITEM_TAGS and (len(element) > 0 or bool(element.attrib))


def _fields_of(element: Element) -> dict[str, Any]:
    data: dict[str, Any] = {}
    for attr, value in element.attrib.items():
        target = map_field(attr)
        if target:
            data.setdefault(target, value)
    for child in element:
        if _is_item(child) or len(child):
            continue
        target = map_field(_local(child.tag))
        if target and child.text:
            data.setdefault(target, child.text.strip())
    return data


def _collect_items(element: Element, level: int, out: list[dict[str, Any]]) -> None:
    for child in element:
        if _is_item(child):
            item = _fields_of(child)
            item.setdefault("level", level)
            out.append(item)
            _collect_items(child, level + 1, out)
        elif len(child):
            _collect_items(child, level, out)


def parse_xml(content: bytes) -> ParsedBom:
    try:
        root = SafeET.fromstring(content)
    except Exception as exc:  # defusedxml wirft verschiedene Fehlertypen
        raise BomImportError(f"XML-Datei konnte nicht gelesen werden: {exc}") from exc
    # Kopfdaten am Wurzelelement oder an einem eingebetteten <Assembly>/<Baugruppe>-Element
    header_element = root
    if _local(root.tag) not in ROOT_TAGS:
        header_element = next((c for c in root if _local(c.tag) in ROOT_TAGS), root)
    header = _fields_of(header_element)
    attrs = {k.lower(): v for k, v in header_element.attrib.items()}
    revision = attrs.get("revision") or attrs.get("rev") or attrs.get("index") or attrs.get("aenderungsindex", "")
    items: list[dict[str, Any]] = []
    _collect_items(root, 1, items)
    return ParsedBom(
        drawing_number=str(header.get("drawing_number", "")),
        name=str(header.get("name", "")),
        revision=revision,
        items=_finalize(items),
        source="xml",
    )


def parse_bom_file(filename: str, content: bytes) -> ParsedBom:
    lower = filename.lower()
    if lower.endswith(".xml"):
        return parse_xml(content)
    if lower.endswith((".csv", ".txt", ".tsv")):
        return parse_csv(content)
    stripped = content.lstrip()
    if stripped.startswith((b"<", b"\xef\xbb\xbf<")):
        return parse_xml(content)
    return parse_csv(content)
