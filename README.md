# MackFMEA – automatisierte FMEA-Erstellung

Web-Applikation zur automatisierten Erstellung einer Design-FMEA (DFMEA nach AIAG & VDA) auf Basis einer
strukturierten Bauteilklassifikation durch den Konstrukteur. Werknormen, SC-Klassen-Logik, Schlüsseltabelle und
Maßnahmenkatalog sind als pflegbare Regeltabellen hinterlegt. Die Anzahl und Strenge der Anforderungen steigt
stufenweise mit der SC-Klasse (SC0 → SC4).

> **Hinweis:** Die ausgelieferten Werknormen (`WN 100` … `WN 500`), Anforderungsregeln und Maßnahmen sind
> **Musterdaten**, die die Funktionsweise zeigen. Sie sind im Admin-Bereich durch die gültigen Werknormen zu
> ersetzen.

## Inhalt

- [Schnellstart](#schnellstart)
- [Kernprozess](#kernprozess)
- [Regelwerk-Engine](#regelwerk-engine)
- [FMEA-Generierung](#fmea-generierung)
- [Rollen und Workflow](#rollen-und-workflow)
- [PDM-/CAD-Integration](#pdm-cad-integration)
- [Nachvollziehbarkeit](#nachvollziehbarkeit)
- [Architektur](#architektur)
- [Konfiguration](#konfiguration)
- [Entwicklung und Tests](#entwicklung-und-tests)
- [Produktivbetrieb](#produktivbetrieb)

## Schnellstart

### Docker

```bash
docker compose up --build
```

Die Anwendung läuft danach unter <http://localhost:8000>, die API-Dokumentation (OpenAPI) unter
<http://localhost:8000/docs>. Daten liegen im Volume `mackfmea-data`.

Hinter einem TLS-abfangenden Firmen-Proxy kann das Stammzertifikat beim Bauen übergeben werden:

```bash
docker build --secret id=ca,src=/pfad/firmen-ca.pem -t mackfmea .
```

### Lokal (Entwicklung)

Voraussetzungen: Python ≥ 3.11, Node.js ≥ 20.19.

```bash
# Backend
cd backend
python -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/uvicorn app.main:app --reload            # http://127.0.0.1:8000

# Frontend (zweites Terminal)
cd frontend
npm install
npm run dev                                         # http://localhost:5173 (leitet /api an Port 8000 weiter)
```

Alternativ `npm run build` im Ordner `frontend` – das Backend liefert die gebaute Oberfläche dann selbst unter
Port 8000 aus.

### Browser-Version (eine HTML-Datei)

Das komplette Tool lässt sich zusätzlich als **eine eigenständige HTML-Datei** bauen, die ohne Server läuft:

```bash
cd frontend
npm run build:standalone      # → dist-standalone/mackfmea.html (vollständiges Dokument)
                              #   dist-standalone/mackfmea.artifact.html (Inhalt für claude.ai-Artifacts)
```

Die Oberfläche ist dieselbe; statt FastAPI beantwortet ein eingebetteter Server (`frontend/src/standalone/`) alle
API-Aufrufe mit derselben Logik (Regelwerk-Engine, FMEA-Generator, Review-Workflow, Versionsvergleich, Auditlog,
CSV/XML-Import, Excel/PDF-Export).

| Betrieb                         | Datenhaltung                                                                     |
|---------------------------------|----------------------------------------------------------------------------------|
| als claude.ai-Artifact          | gemeinsamer Datenbestand aller, die die Seite öffnen (live synchronisiert)       |
| als lokale Datei im Browser     | nur in diesem Browser (`localStorage`)                                           |

Unterschiede zur Server-Version: Anmeldung per Benutzerauswahl ohne Passwort (der Zugriff wird über die Freigabe der
Seite gesteuert), Demo-PDM statt Keytech-Anbindung, die PDM-Rückspeicherung wird nur protokolliert, und für den
Export lädt die Seite ExcelJS und jsPDF von cdnjs nach (Internetverbindung nötig). Das Musterregelwerk kommt aus
`frontend/src/standalone/seed.json`; nach Änderungen an `backend/app/seed.py` mit
`backend/.venv/bin/python backend/scripts/export_standalone_seed.py` neu erzeugen.

### Demo-Zugänge

Im Demo-Modus (`MACKFMEA_SEED_DEMO=true`, Standard) werden angelegt:

| Benutzer       | Passwort       | Rolle                                    |
|----------------|----------------|------------------------------------------|
| `konstrukteur` | `konstrukteur` | Konstrukteur – Eingabe & Klassifikation  |
| `pruefer`      | `pruefer`      | Prüfer – Review & Freigabe               |
| `admin`        | `admin`        | Admin – Norm- und Katalogpflege          |

Außerdem wird die Demo-Baugruppe **BG-200100 „Laufwerk komplett“** mit sechs klassifizierten Bauteilen angelegt,
sodass sofort eine FMEA generiert werden kann. Eine zweite Baugruppe (**BG-300100 „Hubwerk 5 t“**) steht im
Demo-PDM zur Übernahme bereit. Beispieldateien für den Datei-Import liegen in [`examples/`](examples).

## Kernprozess

```
 Stückliste (PDM / CSV / XML)
        │
        ▼
 1. Bauteilklassifikation durch den Konstrukteur
    Liste 1 – Merkmale:       Bezeichnung, Bezeichnung 2, Funktion, Inspizierbarkeit, Schaden (Schadensbilder)
    Liste 2 – Klassifikation: Bauteilart, Geometrie, Material, Belastung, Spannungsspiele, SC-Klasse (SC0–SC4)
        │
        ▼
 2. Regelbasierte Anforderungsableitung (Regeltabelle je SC-Klasse und Merkmalskombination)
        │
        ▼
 3. Schlüsselgenerierung: Merkmalsausprägung + SC-Klasse → generischer Code, z. B. BA-GUSS-SC3
        │
        ▼
 4. Maßnahmenableitung: Schlüssel → Prüf- und Sicherungsmaßnahmen (Umfang/Tiefe je SC-Klasse)
        │
        ▼
 5. Datenzusammenführung → FMEA-Formblatt (AIAG & VDA Schritte 2–6) + Anforderungsliste
        │
        ▼
 6. Review (Vier-Augen-Prinzip) → Export Excel/PDF → Rückspeicherung ins PDM
```

Das Klassifikationsformular zeigt bereits während der Eingabe live, welche Anforderungen, Schlüssel und Maßnahmen
sich ergeben, und wie stark der Anforderungsumfang mit der SC-Klasse wächst. Die Materialausprägung wird aus den
PDM-Stammdaten vorgeschlagen (z. B. `42CrMo4+QT` → „Vergütungsstahl“).

## Regelwerk-Engine

Alle Regeln liegen in Datenbanktabellen und werden im Admin-Bereich gepflegt:

| Tabelle                | Inhalt                                                                                                   |
|------------------------|----------------------------------------------------------------------------------------------------------|
| **SC-Klassen**         | SC0–SC4 mit Sicherheitsrelevanz, Anforderungsniveau und Bedeutung (B) für die FMEA                       |
| **Merkmalslisten**     | Merkmale der Listen 1 und 2 mit ihren Ausprägungen; je Ausprägung Fehlerursache bzw. Fehlerfolge         |
| **Werknormen**         | Referenzierte Werk- und Fachnormen                                                                       |
| **Anforderungsregeln** | Anforderung an Halbzeug oder Bauteil, Kategorie, gültig von `SC min` bis `SC max`, optionale Bedingungen |
| **Maßnahmenkatalog**   | Vermeidungs- (A) und Entdeckungsmaßnahmen (E) mit erreichbarer Bewertung 1–10                            |
| **Schlüsseltabelle**   | Ein Schlüssel je Ausprägung × SC-Klasse mit zugeordneten Maßnahmen inkl. Umfang/Tiefe                    |

**Anforderungsregeln:** Eine Regel gilt für ein Bauteil, wenn seine SC-Klasse im Bereich `sc_min … sc_max` liegt
und alle Bedingungen erfüllt sind (je Merkmal ODER, zwischen Merkmalen UND – z. B. „Bauteilart = Guss“). Strengere
Regeln können eine schwächere ab einer SC-Klasse ersetzen (z. B. Werkszeugnis 2.2 → Abnahmeprüfzeugnis 3.1 → 3.2
nach EN 10204).

**Halbzeug:** Werkstoffzertifikate, Prüfumfang, Liefervorschriften.
**Bauteil:** Prüfmerkmale, Toleranzklassen, Nachweisführung, Freigabe/Zertifizierung.

**Konsistenzprüfung:** Die Seite *SC-Klassen* prüft, dass der Umfang in keiner Regelgruppe und in keinem Schlüssel
mit steigender SC-Klasse abnimmt. Im Musterregelwerk ergeben sich z. B. für ein Zerspanungsteil aus Baustahl
4 → 7 → 11 → 16 → 23 Anforderungen (SC0 → SC4); ein Test prüft dies für alle 9 000 Merkmalskombinationen des Musterregelwerks.

**Schlüsseltabelle:** Wird eine neue Ausprägung angelegt, entstehen automatisch fünf Schlüssel (SC0–SC4). Beim
Zuordnen einer Maßnahme kann sie in einem Schritt auch allen höheren SC-Klassen zugeordnet werden.

## FMEA-Generierung

Für jedes klassifizierte Bauteil der Stückliste und jedes gewählte Schadensbild (= Fehlerart) entsteht je
relevanter Fehlerursache eine Zeile:

| Formblatt-Spalte (AIAG & VDA)          | Herkunft                                                                              |
|----------------------------------------|---------------------------------------------------------------------------------------|
| Nächsthöhere Ebene / Funktion          | Baugruppe bzw. übergeordnete Stücklistenposition                                      |
| Betrachtetes Element / Funktion        | Bauteil, Bezeichnung (2) und Funktion aus Liste 1                                     |
| Nächstniedrigere Ebene / Merkmal       | Merkmalsausprägung, die die Ursache liefert, mit Verweis auf zugehörige Anforderungen |
| Fehlerfolge, Fehlerart                 | Schadensbild (Liste 1)                                                                |
| Bedeutung (B)                          | Bedeutung der SC-Klasse                                                               |
| Fehlerursache                          | Ursache der Merkmalsausprägung (z. B. Gussfehler, Kerbwirkung, Wärmebehandlung)       |
| Vermeidungs-/Entdeckungsmaßnahmen      | Maßnahmen der Schlüssel von Schadensbild, Ursache und allgemeinen Merkmalen           |
| Auftreten (A) / Entdeckung (E)         | beste Bewertung der jeweiligen Maßnahmen                                              |
| Aufgabenpriorität (AP)                 | AP-Tabelle des AIAG-&-VDA-FMEA-Handbuchs (H/M/L); RPZ nur informativ                  |
| Besondere Merkmale                     | SC-Klasse                                                                             |
| Optimierung                            | Bei AP H/M: Vorschläge wirksamerer Maßnahmen derselben Merkmale aus höheren SC-Klassen |

Liefert kein Merkmal eine passende Ursache, wird die generische Ursache des Schadensbildes verwendet. Jede
Generierung erzeugt eine neue Version mit einem Snapshot aller Eingangsdaten (Klassifikationsversionen,
Schlüssel, Maßnahmen, Anforderungen) und dem Fingerprint des Regelwerksstands.

**Ausgabe:**

- **Excel** (`.xlsx`): Blätter *DFMEA* (Formblatt mit Kopfdaten und Schritten 2–6), *Anforderungen*,
  *Klassifikation* und *Rückverfolgbarkeit*.
- **PDF** (A3 quer): Formblatt und Anforderungsliste.

## Rollen und Workflow

| Rolle            | Rechte                                                                                                        |
|------------------|---------------------------------------------------------------------------------------------------------------|
| **Konstrukteur** | Baugruppen anlegen/importieren, Bauteile klassifizieren, FMEA generieren, Entwürfe bearbeiten und einreichen  |
| **Prüfer**       | FMEAs in Prüfung bearbeiten, freigeben oder zurückweisen; Auditlog einsehen                                   |
| **Admin**        | Regelwerk und Benutzer pflegen; alle Rechte                                                                   |

Status einer FMEA: `Entwurf` → `In Prüfung` → `Freigegeben` (bzw. `Abgelehnt` → erneut einreichen). Eine neue
Freigabe setzt die vorherige freigegebene Version auf `Ersetzt`. Regeln:

- **Vier-Augen-Prinzip:** Der Ersteller darf die eigene FMEA nicht freigeben.
- Zeilen mit **AP = H** benötigen vor der Freigabe einen Verantwortlichen für die Optimierung.
- Freigegebene FMEAs sind schreibgeschützt.
- Ab SC2 und bei jeder Änderung der SC-Klasse ist eine Begründung Pflicht.
- Ändert sich nach der Generierung eine Klassifikation, kennzeichnet die FMEA die betroffenen Bauteile als
  veraltet und bietet die Generierung einer neuen Version an. Versionen lassen sich vergleichen.

## PDM-/CAD-Integration

Die Anbindung ist als austauschbarer Konnektor umgesetzt (`backend/app/services/pdm.py`):

| Funktion                         | Umsetzung                                                                       |
|----------------------------------|---------------------------------------------------------------------------------|
| Suche nach Zeichnungsnummern     | `GET /api/pdm/search?q=`                                                         |
| Bauteilstammdaten                | `GET /api/pdm/items/{nummer}`                                                    |
| Stückliste übernehmen            | `POST /api/pdm/import` (alle Strukturebenen)                                     |
| Stückliste abgleichen            | `POST /api/assemblies/{id}/pdm-refresh` (Klassifikationen bleiben erhalten)      |
| Rückspeicherung FMEA-Blatt       | `POST /api/fmea/{id}/pdm-store` (Excel + PDF mit Metadaten und Inhalts-Hash)    |

**Konnektoren:**

- `demo` (Standard): eingebauter Beispieldatenbestand, Rückspeicherung ins Dateisystem
  (`MACKFMEA_PDM_STORE_DIR`).
- `keytech`: REST-Adapter für die keytech Web API. Pfade (`MACKFMEA_KEYTECH_*_PATH`) und Zugangsdaten sind
  konfigurierbar; Antworten werden tolerant ausgewertet (flache JSON-Objekte oder `KeyValueList`-Attribute).
  **Der Adapter wurde nicht gegen ein reales keytech-System getestet** – Endpunkte und Feldnamen sind bei der
  Inbetriebnahme mit der eingesetzten keytech-Version abzugleichen.

**Autodesk Inventor:** Stücklisten werden über den Inventor-Export (*Stückliste → Exportieren → CSV/Text*)
importiert. Erkannt werden u. a. die Spalten `Pos.`, `Bauteilnummer`, `Beschreibung`, `Menge`, `Material`;
strukturierte Positionsnummern (`1.2`) ergeben die Strukturstufen. Außerdem werden generische CSV- (`;`, `,`, Tab)
und XML-Formate unterstützt (siehe [`examples/`](examples)).

## Nachvollziehbarkeit

- **Auditlog** aller Klassifikationsentscheidungen (inkl. Begründung, Feld-Diff, abgeleiteter Anforderungen und
  Schlüssel), Regelwerksänderungen, Generierungen, Bearbeitungen, Statuswechsel, Exporte, PDM-Vorgänge und
  Anmeldungen.
- **Hash-Kette:** Jeder Eintrag enthält den SHA-256-Hash seines Inhalts und des Vorgängers. *Auditlog →
  Integrität prüfen* erkennt nachträgliche Manipulationen.
- **Versionierung:** Klassifikationen und FMEAs werden nie überschrieben, sondern versioniert.
- **Inhalts-Hash** je FMEA (in Export und PDM-Metadaten) sowie **Regelwerks-Fingerprint** je Generierung.

## Architektur

```
frontend/   React 19 + TypeScript + Vite (SPA)
backend/    FastAPI + SQLAlchemy 2 (SQLite, über DATABASE_URL austauschbar)
  app/models.py              Datenmodell
  app/services/rules.py      Regelwerk-Engine (Anforderungen, Schlüssel, Maßnahmen, Konsistenz)
  app/services/fmea_generator.py   FMEA-Generierung
  app/services/ap.py         Aufgabenpriorität nach AIAG & VDA
  app/services/export_excel.py / export_pdf.py
  app/services/bom_import.py CSV-/XML-Import
  app/services/pdm.py        PDM-Konnektoren
  app/audit.py               Auditlog mit Hash-Kette
  app/seed.py                Musterregelwerk und Demodaten
  app/routers/               REST-API (/api/…)
examples/   Beispiel-Stücklisten
```

Die vollständige API ist unter `/docs` (Swagger UI) bzw. `/openapi.json` dokumentiert.

## Konfiguration

Alle Einstellungen über Umgebungsvariablen:

| Variable                       | Standard                         | Bedeutung                                                  |
|--------------------------------|----------------------------------|------------------------------------------------------------|
| `MACKFMEA_DATA_DIR`            | `backend/data`                   | Datenverzeichnis (SQLite-DB, Secret, Demo-PDM-Ablage)      |
| `MACKFMEA_DATABASE_URL`        | `sqlite:///<DATA_DIR>/mackfmea.db` | SQLAlchemy-URL                                           |
| `MACKFMEA_SECRET_KEY`          | wird erzeugt und gespeichert     | Signaturschlüssel der Anmelde-Tokens                       |
| `MACKFMEA_TOKEN_EXPIRE_MINUTES`| `480`                            | Gültigkeit einer Anmeldung                                 |
| `MACKFMEA_SEED_DEMO`           | `true`                           | Demo-Benutzer und Demo-Baugruppe anlegen                   |
| `MACKFMEA_ADMIN_PASSWORD`      | –                                | Initiales Admin-Passwort (sonst `admin` bzw. zufällig)     |
| `MACKFMEA_COMPANY_NAME`        | –                                | Unternehmen im Formblattkopf                               |
| `MACKFMEA_CORS_ORIGINS`        | `http://localhost:5173,…`        | Erlaubte Origins (Entwicklung)                             |
| `MACKFMEA_PDM_CONNECTOR`       | `demo`                           | `demo` oder `keytech`                                      |
| `MACKFMEA_PDM_STORE_DIR`       | `<DATA_DIR>/pdm_store`           | Ablage des Demo-Konnektors                                 |
| `MACKFMEA_KEYTECH_BASE_URL`    | –                                | Basis-URL der keytech Web API                              |
| `MACKFMEA_KEYTECH_USER` / `_PASSWORD` | –                         | Zugangsdaten (Basic Auth)                                  |
| `MACKFMEA_KEYTECH_ITEM_PATH`   | `/elements/{key}`                | Pfad Stammdaten                                            |
| `MACKFMEA_KEYTECH_BOM_PATH`    | `/elements/{key}/bom`            | Pfad Stückliste                                            |
| `MACKFMEA_KEYTECH_UPLOAD_PATH` | `/elements/{key}/files`          | Pfad Dokument-Upload                                       |
| `MACKFMEA_KEYTECH_SEARCH_PATH` | `/search?q={number}`             | Pfad Suche                                                 |
| `MACKFMEA_PDF_FONT`            | DejaVu Sans, falls vorhanden     | TrueType-Schrift für den PDF-Export                        |

## Entwicklung und Tests

```bash
cd backend
.venv/bin/python -m pytest          # Regelwerk, AP-Tabelle, Import, Auditlog, API-Workflow
.venv/bin/ruff check app tests

cd ../frontend
npm run typecheck
npm run build
```

## Produktivbetrieb

- `MACKFMEA_SEED_DEMO=false` setzen und `MACKFMEA_ADMIN_PASSWORD` sowie `MACKFMEA_SECRET_KEY` vorgeben.
- Musterregelwerk durch die gültigen Werknormen ersetzen (Admin-Bereich). `GET /api/catalog/export` liefert den
  vollständigen Regelwerksstand als JSON (Sicherung).
- Für den Mehrbenutzerbetrieb eine Server-Datenbank (z. B. PostgreSQL) über `MACKFMEA_DATABASE_URL` anbinden
  (Treiber, z. B. `psycopg`, ergänzen). Die Tabellen werden beim Start angelegt; für spätere Schemaänderungen
  empfiehlt sich die Einführung von Alembic-Migrationen.
- Betrieb hinter einem Reverse Proxy mit TLS.
- Anbindung an den Unternehmens-Verzeichnisdienst (LDAP/SSO) ist nicht enthalten; die Benutzerverwaltung erfolgt
  in der Anwendung.
