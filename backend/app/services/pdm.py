"""Anbindung an PDM/CAD-Systeme.

* ``DemoPdmConnector`` – eingebauter Demo-Datenbestand (offline), Rückspeicherung ins lokale Dateisystem.
* ``KeytechConnector`` – REST-Adapter für die keytech Web API. Pfade und Feldnamen sind über
  Umgebungsvariablen konfigurierbar, da sie je nach keytech-Version/Konfiguration variieren.

Autodesk Inventor liefert Stücklisten über den Dateiexport (CSV/XML) – siehe ``bom_import``.
"""

from __future__ import annotations

import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from ..config import Settings, settings

DEMO_DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "demo_pdm.json"


class PdmError(RuntimeError):
    pass


@dataclass
class PdmItem:
    number: str
    name: str
    name2: str = ""
    revision: str = ""
    material: str = ""
    pdm_ref: str = ""
    description: str = ""

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()


@dataclass
class PdmBom:
    assembly: PdmItem
    items: list[dict[str, Any]] = field(default_factory=list)


class PdmConnector(ABC):
    name = "abstract"

    @abstractmethod
    def status(self) -> dict[str, Any]: ...

    @abstractmethod
    def search(self, query: str) -> list[PdmItem]: ...

    @abstractmethod
    def get_item(self, number: str) -> PdmItem: ...

    @abstractmethod
    def get_bom(self, number: str) -> PdmBom: ...

    @abstractmethod
    def store_document(self, number: str, filename: str, content: bytes, metadata: dict[str, Any]) -> str:
        """Speichert ein Dokument am PDM-Objekt und liefert eine Dokumentreferenz."""


def _safe_name(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("_") or "unbenannt"


class DemoPdmConnector(PdmConnector):
    name = "demo"

    def __init__(self, cfg: Settings, data_file: Path = DEMO_DATA_FILE):
        self.cfg = cfg
        self.store_dir = cfg.pdm_store_dir or (cfg.data_dir / "pdm_store")
        self._data = json.loads(data_file.read_text(encoding="utf-8"))

    def _items(self) -> dict[str, dict[str, Any]]:
        return {i["number"]: i for i in self._data.get("items", [])}

    @staticmethod
    def _to_item(raw: dict[str, Any]) -> PdmItem:
        return PdmItem(
            number=raw["number"],
            name=raw.get("name", ""),
            name2=raw.get("name2", ""),
            revision=raw.get("revision", ""),
            material=raw.get("material", ""),
            pdm_ref=raw.get("pdm_ref", f"DEMO:{raw['number']}"),
            description=raw.get("description", ""),
        )

    def status(self) -> dict[str, Any]:
        return {
            "connector": self.name,
            "connected": True,
            "message": "Demo-PDM (lokaler Datenbestand, Rückspeicherung ins Dateisystem)",
            "store_dir": str(self.store_dir),
        }

    def search(self, query: str) -> list[PdmItem]:
        q = query.lower().strip()
        return [
            self._to_item(raw)
            for raw in self._items().values()
            if not q or q in raw["number"].lower() or q in raw.get("name", "").lower()
        ]

    def get_item(self, number: str) -> PdmItem:
        raw = self._items().get(number)
        if raw is None:
            raise PdmError(f"Objekt {number} im PDM nicht gefunden")
        return self._to_item(raw)

    def get_bom(self, number: str) -> PdmBom:
        items = self._items()
        if number not in items:
            raise PdmError(f"Baugruppe {number} im PDM nicht gefunden")
        bom_items: list[dict[str, Any]] = []

        def walk(parent: str, level: int) -> None:
            for entry in items[parent].get("bom", []):
                child = items.get(entry["number"])
                if child is None:
                    continue
                bom_items.append(
                    {
                        "position": entry.get("position", ""),
                        "level": level,
                        "drawing_number": child["number"],
                        "name": child.get("name", ""),
                        "name2": child.get("name2", ""),
                        "quantity": float(entry.get("quantity", 1)),
                        "unit": entry.get("unit", "Stk"),
                        "material_pdm": child.get("material", ""),
                        "pdm_ref": child.get("pdm_ref", f"DEMO:{child['number']}"),
                    }
                )
                if child.get("bom"):
                    walk(child["number"], level + 1)

        walk(number, 1)
        if not bom_items:
            raise PdmError(f"{number} besitzt keine Stückliste")
        return PdmBom(self._to_item(items[number]), bom_items)

    def store_document(self, number: str, filename: str, content: bytes, metadata: dict[str, Any]) -> str:
        target_dir = self.store_dir / _safe_name(number)
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / _safe_name(filename)
        target.write_bytes(content)
        meta = {**metadata, "stored_at": datetime.now(UTC).isoformat(), "file": target.name}
        (target_dir / f"{target.name}.meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
        )
        return f"demo-pdm://{_safe_name(number)}/{target.name}"


class KeytechConnector(PdmConnector):
    """REST-Adapter für keytech. Die Antwortstruktur wird tolerant ausgewertet
    (flache JSON-Objekte oder keytech-typische ``KeyValueList``-Attributlisten)."""

    name = "keytech"

    NUMBER_FIELDS = ("as_mi__number", "number", "Nummer", "DrawingNumber", "PartNumber", "Key")
    NAME_FIELDS = ("as_mi__name", "DisplayName", "name", "Name", "Benennung", "Description")
    NAME2_FIELDS = ("as_mi__name2", "name2", "Benennung2", "Bezeichnung2")
    REV_FIELDS = ("as_mi__version", "Version", "revision", "Revision", "Index")
    MAT_FIELDS = ("as_mi__material", "material", "Material", "Werkstoff")
    QTY_FIELDS = ("as_sdd__quantity", "quantity", "Quantity", "Menge")
    POS_FIELDS = ("as_sdd__position", "position", "Position", "Pos")

    def __init__(self, cfg: Settings, client: httpx.Client | None = None):
        self.cfg = cfg
        if not cfg.keytech_base_url and client is None:
            raise PdmError("MACKFMEA_KEYTECH_BASE_URL ist nicht konfiguriert")
        self.client = client or httpx.Client(
            base_url=cfg.keytech_base_url.rstrip("/"),
            auth=(cfg.keytech_user, cfg.keytech_password) if cfg.keytech_user else None,
            verify=cfg.keytech_verify_tls,
            timeout=30.0,
            headers={"Accept": "application/json"},
        )

    @staticmethod
    def _flatten(obj: dict[str, Any]) -> dict[str, Any]:
        flat = dict(obj)
        for list_key in ("KeyValueList", "keyValueList", "Attributes"):
            for kv in obj.get(list_key, []) or []:
                if isinstance(kv, dict) and "Key" in kv:
                    flat.setdefault(kv["Key"], kv.get("Value"))
        for nested in ("SimpleElement", "Element", "element"):
            if isinstance(obj.get(nested), dict):
                for k, v in KeytechConnector._flatten(obj[nested]).items():
                    flat.setdefault(k, v)
        return flat

    @staticmethod
    def _pick(data: dict[str, Any], names: tuple[str, ...], default: Any = "") -> Any:
        for name in names:
            if data.get(name) not in (None, ""):
                return data[name]
        return default

    @staticmethod
    def _first_element(payload: Any) -> dict[str, Any]:
        if isinstance(payload, list):
            payload = payload[0] if payload else {}
        if isinstance(payload, dict):
            for list_key in ("ElementList", "elements", "items"):
                if isinstance(payload.get(list_key), list) and payload[list_key]:
                    return payload[list_key][0]
        return payload if isinstance(payload, dict) else {}

    def _get(self, path: str) -> Any:
        try:
            response = self.client.get(path)
        except httpx.HTTPError as exc:
            raise PdmError(f"keytech nicht erreichbar: {exc}") from exc
        if response.status_code == 404:
            raise PdmError("Objekt im keytech nicht gefunden")
        if response.status_code >= 400:
            raise PdmError(f"keytech-Fehler {response.status_code}: {response.text[:200]}")
        return response.json()

    def _to_item(self, raw: dict[str, Any], fallback_number: str = "") -> PdmItem:
        data = self._flatten(raw)
        return PdmItem(
            number=str(self._pick(data, self.NUMBER_FIELDS, fallback_number)),
            name=str(self._pick(data, self.NAME_FIELDS)),
            name2=str(self._pick(data, self.NAME2_FIELDS)),
            revision=str(self._pick(data, self.REV_FIELDS)),
            material=str(self._pick(data, self.MAT_FIELDS)),
            pdm_ref=str(data.get("Key", fallback_number)),
            description=str(data.get("Description", "")),
        )

    def status(self) -> dict[str, Any]:
        try:
            response = self.client.get("/")
            connected = response.status_code < 500
            message = f"HTTP {response.status_code}"
        except httpx.HTTPError as exc:
            connected, message = False, str(exc)
        return {"connector": self.name, "connected": connected, "message": message, "base_url": self.cfg.keytech_base_url}

    def search(self, query: str) -> list[PdmItem]:
        payload = self._get(self.cfg.keytech_search_path.format(number=query, key=query))
        elements = payload.get("ElementList", payload) if isinstance(payload, dict) else payload
        return [self._to_item(e) for e in (elements or []) if isinstance(e, dict)]

    def get_item(self, number: str) -> PdmItem:
        payload = self._get(self.cfg.keytech_item_path.format(key=number, number=number))
        return self._to_item(self._first_element(payload), number)

    def get_bom(self, number: str) -> PdmBom:
        assembly = self.get_item(number)
        payload = self._get(self.cfg.keytech_bom_path.format(key=assembly.pdm_ref or number, number=number))
        if isinstance(payload, dict):
            entries = payload.get("BomElementList") or payload.get("items") or payload.get("ElementList") or []
        else:
            entries = payload or []
        items = []
        for idx, entry in enumerate(entries, start=1):
            data = self._flatten(entry)
            item = self._to_item(entry)
            items.append(
                {
                    "position": str(self._pick(data, self.POS_FIELDS, idx * 10)),
                    "level": int(data.get("level", data.get("Level", 1)) or 1),
                    "drawing_number": item.number,
                    "name": item.name or item.number,
                    "name2": item.name2,
                    "quantity": float(str(self._pick(data, self.QTY_FIELDS, 1)).replace(",", ".") or 1),
                    "unit": "Stk",
                    "material_pdm": item.material,
                    "pdm_ref": item.pdm_ref,
                }
            )
        if not items:
            raise PdmError(f"Keine Stückliste zu {number} im keytech gefunden")
        return PdmBom(assembly, items)

    def store_document(self, number: str, filename: str, content: bytes, metadata: dict[str, Any]) -> str:
        path = self.cfg.keytech_upload_path.format(key=number, number=number)
        try:
            response = self.client.post(
                path,
                files={"file": (filename, content, "application/octet-stream")},
                data={"metadata": json.dumps(metadata, default=str)},
            )
        except httpx.HTTPError as exc:
            raise PdmError(f"keytech nicht erreichbar: {exc}") from exc
        if response.status_code >= 400:
            raise PdmError(f"Rückspeicherung fehlgeschlagen ({response.status_code}): {response.text[:200]}")
        try:
            ref = response.json().get("Key") or response.json().get("id")
        except ValueError:
            ref = None
        return str(ref or f"keytech://{number}/{filename}")


_connector: PdmConnector | None = None


def get_connector() -> PdmConnector:
    global _connector
    if _connector is None:
        if settings.pdm_connector == "keytech":
            _connector = KeytechConnector(settings)
        else:
            _connector = DemoPdmConnector(settings)
    return _connector


def set_connector(connector: PdmConnector | None) -> None:
    """Für Tests: Konnektor austauschen."""
    global _connector
    _connector = connector
