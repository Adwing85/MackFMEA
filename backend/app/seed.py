"""Initialdaten.

Die Werknormen, Regeln und Maßnahmen sind **Musterdaten**, die die Funktionsweise des Regelwerks zeigen.
Sie sind im Admin-Bereich durch die tatsächlichen Werknormen zu ersetzen bzw. anzupassen.
"""

from __future__ import annotations

import logging
import secrets

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import audit
from .config import settings
from .models import (
    Assembly,
    Attribute,
    AttributeOption,
    Classification,
    Component,
    KeyEntry,
    KeyMeasure,
    Measure,
    Requirement,
    Role,
    ScClass,
    Standard,
    User,
)
from .security import hash_password
from .services.rules import ensure_keys

log = logging.getLogger("mackfmea.seed")

SC_CLASSES = [
    (0, "Keine besonderen Sicherheitsanforderungen", "Standardanforderungen", 3, "#6b7280"),
    (1, "Geringe Sicherheitsrelevanz", "Basisanforderungen gemäß Werknorm", 5, "#2563eb"),
    (2, "Mittlere Sicherheitsrelevanz", "Erhöhte Anforderungen an Halbzeug und Bauteil", 7, "#d97706"),
    (3, "Hohe Sicherheitsrelevanz", "Umfangreiche Prüf- und Nachweispflichten", 9, "#dc2626"),
    (
        4,
        "Höchste Sicherheitsrelevanz",
        "Maximale Anforderungen, erweiterte Zertifizierungs- und Freigabepflichten",
        10,
        "#7c3aed",
    ),
]

STANDARDS = [
    ("WN 100", "Sicherheitsklassifizierung von Bauteilen (SC0–SC4)"),
    ("WN 210", "Werkstoffe, Halbzeuge und Prüfbescheinigungen"),
    ("WN 220", "Gussteile – Gestaltung, Güte und Prüfung"),
    ("WN 230", "Schmiedeteile – Gestaltung, Güte und Prüfung"),
    ("WN 240", "Schweißkonstruktionen – Ausführung und Prüfung"),
    ("WN 300", "Zerstörungsfreie Prüfung (ZfP)"),
    ("WN 400", "Festigkeits- und Betriebsfestigkeitsnachweise"),
    ("WN 500", "Dokumentation, Rückverfolgbarkeit und Freigabe"),
    ("EN 10204", "Metallische Erzeugnisse – Arten von Prüfbescheinigungen"),
    ("ISO 2768", "Allgemeintoleranzen"),
    ("EN ISO 5817", "Schweißen – Bewertungsgruppen von Unregelmäßigkeiten"),
]

# (Code, Typ, Titel, Bewertung, Norm)
MEASURES = [
    ("M-V-01", "V", "Auslegung nach Stand der Technik / Erfahrungswerten", 6, None),
    ("M-V-02", "V", "Statischer Festigkeitsnachweis", 5, "WN 400"),
    ("M-V-03", "V", "Ermüdungsfestigkeitsnachweis (FKM-Richtlinie / EN 1993-1-9)", 4, "WN 400"),
    ("M-V-04", "V", "Betriebsfestigkeitsnachweis mit Lastkollektiv", 3, "WN 400"),
    ("M-V-05", "V", "FEM-Analyse kritischer Kerben und Querschnittsübergänge", 4, "WN 400"),
    ("M-V-06", "V", "Bruchmechanische Bewertung (Schadenstoleranz, Rissfortschritt)", 2, "WN 400"),
    ("M-V-07", "V", "Gießsimulation (Formfüllung, Erstarrung, Speisung)", 4, "WN 220"),
    ("M-V-08", "V", "Gussgerechte Gestaltung (Wanddickenübergänge, Radien, Entformung)", 5, "WN 220"),
    ("M-V-09", "V", "Schmiedegerechte Gestaltung, faserverlaufsgerechte Umformung", 4, "WN 230"),
    ("M-V-10", "V", "Schweißgerechte Konstruktion, Kerbfallzuordnung", 4, "WN 240"),
    ("M-V-11", "V", "Qualifizierte Schweißverfahren (WPQR, EN ISO 15614) und Schweißer (EN ISO 9606-1)", 3, "WN 240"),
    ("M-V-12", "V", "Schweißaufsicht nach EN ISO 14731, Schweißplan", 3, "WN 240"),
    ("M-V-13", "V", "Eindeutige Werkstoffspezifikation in Zeichnung und Bestellung", 5, "WN 210"),
    ("M-V-14", "V", "Festgelegte und überwachte Wärmebehandlung (Ofenprotokoll)", 3, "WN 210"),
    ("M-V-15", "V", "Korrosionsschutzkonzept nach EN ISO 12944", 4, None),
    ("M-V-16", "V", "Randschichtverfestigung (Kugelstrahlen, Festwalzen) an Kerbstellen", 3, None),
    ("M-V-17", "V", "Kerbarme Gestaltung (Übergangsradien, Entlastungskerben)", 4, None),
    ("M-V-18", "V", "Lieferantenqualifikation und Prozessfreigabe (Erstmusterfreigabe)", 4, "WN 500"),
    ("M-V-19", "V", "Toleranz- und Passungsauslegung (Toleranzanalyse)", 5, None),
    ("M-V-20", "V", "Verschleißschutz (Härtung, Beschichtung, Schmierkonzept)", 4, None),
    ("M-V-21", "V", "Dichtungskonzept und Spezifikation der Dichtflächen", 4, None),
    ("M-V-22", "V", "Design-Review mit Sicherheitsbewertung (4-Augen-Prinzip)", 3, "WN 100"),
    ("M-V-23", "V", "Safe-Life-Auslegung mit erhöhten Sicherheitsbeiwerten", 2, "WN 400"),
    ("M-V-24", "V", "Unabhängige Prüfung des Festigkeitsnachweises (Prüfingenieur)", 2, "WN 500"),
    ("M-V-25", "V", "Stabilitätsnachweis (Beulen, Knicken)", 4, "WN 400"),
    ("M-V-26", "V", "Korrosionsgerechte Werkstoff- und Detailgestaltung (Spaltfreiheit)", 4, None),
    ("M-E-01", "E", "Sichtprüfung (VT)", 8, "WN 300"),
    ("M-E-02", "E", "Maßprüfung", 7, None),
    ("M-E-03", "E", "Erstmusterprüfung mit vollständiger 3D-Vermessung", 5, "WN 500"),
    ("M-E-04", "E", "Eingangsprüfung Werkszeugnis 2.2 (EN 10204)", 7, "WN 210"),
    ("M-E-05", "E", "Eingangsprüfung Abnahmeprüfzeugnis 3.1 (EN 10204)", 5, "WN 210"),
    ("M-E-06", "E", "Abnahmeprüfzeugnis 3.2 mit Sachverständigenabnahme", 3, "WN 210"),
    ("M-E-07", "E", "Oberflächenrissprüfung (MT/PT)", 4, "WN 300"),
    ("M-E-08", "E", "Ultraschallprüfung (UT)", 3, "WN 300"),
    ("M-E-09", "E", "Durchstrahlungsprüfung (RT)", 3, "WN 300"),
    ("M-E-10", "E", "Härteprüfung", 5, None),
    ("M-E-11", "E", "Metallographische Gefüge-/Reinheitsgradprüfung", 4, None),
    ("M-E-12", "E", "Kerbschlagbiegeversuch (Charpy-V)", 4, None),
    ("M-E-13", "E", "Schichtdickenmessung Korrosionsschutz", 5, None),
    ("M-E-14", "E", "Dichtheitsprüfung (Druckprobe)", 3, None),
    ("M-E-15", "E", "Bauteilversuch auf Prüfstand (Betriebsfestigkeitsversuch)", 2, "WN 400"),
    ("M-E-16", "E", "Messtechnische Lastkollektivermittlung (DMS-Messung)", 3, "WN 400"),
    ("M-E-17", "E", "Wiederkehrende Inspektion im Betrieb gemäß Inspektionsplan", 4, "WN 500"),
    ("M-E-18", "E", "100 % Rissprüfung vor Einbau durch ZfP-Personal Stufe 2 (EN ISO 9712)", 2, "WN 300"),
    ("M-E-19", "E", "Verschleißmessung im Rahmen der Wartung", 5, None),
    ("M-E-20", "E", "Plausibilitätsprüfung der Berechnung durch Zweitprüfer", 4, "WN 400"),
]

# Umfang/Tiefe je SC-Klasse (Standardwerte, je Schlüssel überschreibbar)
DEFAULT_EXTENTS = {
    "E": {0: "Stichprobe", 1: "Stichprobe je Los", 2: "nach Prüfplan", 3: "100 %", 4: "100 %, Einzelnachweis"},
    "V": {0: "", 1: "gemäß Werknorm", 2: "dokumentiert", 3: "4-Augen-Prüfung", 4: "unabhängig geprüft"},
}

# Merkmale: Liste 2 = Klassifikation, Liste 1 = Merkmale.
# Optionen: (Code, Bezeichnung, Fehlerursache, relevante Schadensbilder, Fehlerfolge, [(Maßnahme, ab SC, bis SC)])
# Bei Schadensbildern ist die Fehlerursache die generische Rückfallursache, falls kein Merkmal eine liefert.
ATTRIBUTES = [
    {
        "code": "BA",
        "name": "Bauteilart",
        "list_no": 2,
        "options": [
            (
                "GUSS",
                "Guss",
                "Gussfehler (Lunker, Poren, Einschlüsse, Kaltläufe) in beanspruchten Querschnitten",
                ["BRUCH", "ERM", "RISS", "UNDICHT"],
                "",
                [
                    ("M-V-08", 0),
                    ("M-E-01", 0),
                    ("M-V-18", 2),
                    ("M-V-07", 2),
                    ("M-E-07", 2),
                    ("M-E-09", 3),
                    ("M-E-11", 3),
                    ("M-E-08", 4),
                ],
            ),
            (
                "SCHM",
                "Schmiedeteil",
                "Schmiedefehler (Überlappungen, Faltungen, ungünstiger Faserverlauf)",
                ["BRUCH", "ERM", "RISS"],
                "",
                [
                    ("M-E-01", 0),
                    ("M-E-10", 1),
                    ("M-V-09", 2),
                    ("M-V-18", 2),
                    ("M-E-07", 2),
                    ("M-E-08", 3),
                    ("M-E-11", 3),
                    ("M-E-18", 4),
                ],
            ),
            (
                "SCHW",
                "Schweißkonstruktion",
                "Schweißnahtfehler (Bindefehler, Wurzelfehler, Poren, Risse, Einbrandkerben)",
                ["BRUCH", "ERM", "RISS", "UNDICHT", "KORR"],
                "",
                [("M-E-01", 0), ("M-V-10", 1), ("M-V-11", 1), ("M-V-12", 2), ("M-E-07", 2), ("M-E-08", 3), ("M-E-09", 4)],
            ),
            (
                "ZERS",
                "Zerspanungsteil (aus Halbzeug)",
                "Bearbeitungsfehler (Riefen, Kerben, Randzonenschädigung, Maßabweichung)",
                ["BRUCH", "ERM", "RISS", "VERS"],
                "",
                [("M-E-02", 0), ("M-V-17", 1), ("M-E-03", 2), ("M-E-07", 3), ("M-V-16", 4)],
            ),
            (
                "BLECH",
                "Blechteil",
                "Umformfehler (Anrisse, Dünnstellen, Rückfederung)",
                ["RISS", "VERF", "ERM"],
                "",
                [("M-E-01", 0), ("M-E-02", 0), ("M-V-19", 1), ("M-E-07", 3)],
            ),
        ],
    },
    {
        "code": "GEO",
        "name": "Geometrie",
        "list_no": 2,
        "options": [
            (
                "ROT",
                "Rotationssymmetrisch (Welle, Achse, Bolzen)",
                "Kerbwirkung an Wellenabsätzen, Einstichen und Nuten",
                ["ERM", "BRUCH"],
                "",
                [("M-V-17", 1), ("M-V-05", 3), ("M-V-16", 4)],
            ),
            (
                "PRIS",
                "Prismatisch (Platte, Block, Konsole)",
                "Kerbwirkung an Bohrungen, Kanten und Ausschnitten",
                ["ERM", "RISS"],
                "",
                [("M-V-17", 2), ("M-V-05", 3)],
            ),
            (
                "FLACH",
                "Flächig / dünnwandig",
                "Stabilitätsversagen (Beulen) dünnwandiger Bereiche",
                ["VERF"],
                "",
                [("M-V-25", 1), ("M-V-05", 3)],
            ),
            (
                "ROHR",
                "Rohr- / Hohlprofil",
                "Innenliegende Fehler und Innenkorrosion nicht einsehbar",
                ["KORR", "ERM"],
                "",
                [("M-V-15", 1), ("M-E-08", 3)],
            ),
            (
                "KOMPLEX",
                "Komplex / Freiform (ausgeprägte Querschnittsübergänge)",
                "Spannungsüberhöhung an Kerben und Querschnittsübergängen",
                ["ERM", "RISS", "BRUCH"],
                "",
                [("M-V-05", 1), ("M-V-17", 2), ("M-E-03", 3), ("M-E-15", 4)],
            ),
        ],
    },
    {
        "code": "MAT",
        "name": "Material",
        "list_no": 2,
        "options": [
            (
                "S355",
                "Baustahl / Feinblech (z. B. S235, S355, DC01)",
                "Werkstoffkennwerte (Streckgrenze, Kerbschlagarbeit) nicht erreicht oder Werkstoffverwechslung",
                ["BRUCH", "VERF", "RISS"],
                "",
                [("M-V-13", 0), ("M-E-04", 1, 1), ("M-E-05", 2, 3), ("M-E-12", 2), ("M-E-06", 4)],
            ),
            (
                "VERG",
                "Vergütungsstahl (z. B. 42CrMo4, 34CrNiMo6)",
                "Fehlerhafte Wärmebehandlung (Härte, Gefüge, Zähigkeit nicht erreicht)",
                ["BRUCH", "ERM", "VERS"],
                "",
                [
                    ("M-V-13", 0),
                    ("M-V-14", 1),
                    ("M-E-10", 1),
                    ("M-E-04", 1, 1),
                    ("M-E-05", 2, 3),
                    ("M-E-12", 2),
                    ("M-E-11", 3),
                    ("M-E-06", 4),
                ],
            ),
            (
                "GJS",
                "Gusseisen mit Kugelgraphit (EN-GJS)",
                "Unzureichende Kugelgraphitausbildung / Gefügeabweichung",
                ["BRUCH", "ERM", "RISS"],
                "",
                [("M-V-13", 0), ("M-E-04", 1, 1), ("M-E-05", 2, 3), ("M-E-11", 2), ("M-E-06", 4)],
            ),
            (
                "GS",
                "Stahlguss (z. B. G20Mn5)",
                "Gefügefehler, unzureichende Zähigkeit nach Wärmebehandlung",
                ["BRUCH", "RISS"],
                "",
                [("M-V-13", 0), ("M-E-04", 1, 1), ("M-E-05", 2, 3), ("M-V-14", 2), ("M-E-12", 2), ("M-E-11", 3), ("M-E-06", 4)],
            ),
            (
                "ALU",
                "Aluminiumlegierung (z. B. EN AW-6082)",
                "Geringe Dauerfestigkeit, Festigkeitsverlust in der Wärmeeinflusszone",
                ["ERM", "VERF", "RISS"],
                "",
                [("M-V-13", 0), ("M-E-04", 1, 1), ("M-E-05", 2, 3), ("M-E-10", 2), ("M-E-06", 4)],
            ),
            (
                "NIRO",
                "Nichtrostender Stahl (z. B. 1.4301)",
                "Interkristalline Korrosion / Spannungsrisskorrosion",
                ["KORR", "RISS"],
                "",
                [("M-V-13", 0), ("M-V-26", 1), ("M-E-04", 1, 1), ("M-E-05", 2, 3), ("M-E-06", 4)],
            ),
        ],
    },
    {
        "code": "BEL",
        "name": "Belastung",
        "list_no": 2,
        "options": [
            (
                "STAT",
                "Statisch",
                "Überlast durch fehlerhafte Lastannahmen oder Auslegung",
                ["BRUCH", "VERF"],
                "",
                [("M-V-01", 0, 0), ("M-V-02", 1), ("M-E-20", 2), ("M-V-22", 3), ("M-V-24", 4)],
            ),
            (
                "SCHWELL",
                "Schwellend",
                "Schwingende Beanspruchung oberhalb der Dauerfestigkeit",
                ["ERM", "RISS"],
                "",
                [("M-V-01", 0, 0), ("M-V-02", 1), ("M-V-03", 2), ("M-V-04", 3), ("M-E-15", 3), ("M-V-24", 4), ("M-V-06", 4)],
            ),
            (
                "WECHSEL",
                "Wechselnd",
                "Wechselbeanspruchung führt zu Rissinitiierung an Kerben",
                ["ERM", "RISS"],
                "",
                [
                    ("M-V-01", 0, 0),
                    ("M-V-02", 1),
                    ("M-V-03", 2),
                    ("M-V-04", 3),
                    ("M-V-16", 3),
                    ("M-E-15", 3),
                    ("M-V-24", 4),
                    ("M-V-06", 4),
                ],
            ),
            (
                "STOSS",
                "Stoßartig / schlagartig",
                "Stoßbelastung, Sprödbruch bei tiefen Temperaturen",
                ["BRUCH", "VERF", "RISS"],
                "",
                [("M-V-01", 0, 0), ("M-V-02", 1), ("M-E-12", 2), ("M-V-03", 2), ("M-V-22", 3), ("M-V-24", 4)],
            ),
            (
                "KOMB",
                "Kombiniert / mehrachsig",
                "Mehrachsige Spannungszustände unzureichend berücksichtigt",
                ["ERM", "BRUCH", "VERF"],
                "",
                [
                    ("M-V-01", 0, 0),
                    ("M-V-02", 1),
                    ("M-V-05", 2),
                    ("M-V-03", 2),
                    ("M-V-04", 3),
                    ("M-E-16", 3),
                    ("M-V-24", 4),
                    ("M-V-06", 4),
                ],
            ),
        ],
    },
    {
        "code": "LSP",
        "name": "Spannungsspiele (Lastspielzahl)",
        "list_no": 2,
        "options": [
            (
                "N1",
                "< 10⁴ (Kurzzeitfestigkeit)",
                "Plastische Wechseldehnungen (Low-Cycle-Fatigue)",
                ["ERM", "RISS"],
                "",
                [("M-V-02", 1)],
            ),
            (
                "N2",
                "10⁴ – 10⁶ (Zeitfestigkeit)",
                "Lebensdauer im Zeitfestigkeitsbereich unterschätzt",
                ["ERM"],
                "",
                [("M-V-03", 1), ("M-E-15", 4)],
            ),
            (
                "N3",
                "10⁶ – 10⁸ (Dauerfestigkeit)",
                "Dauerfestigkeit durch Oberflächen- und Randschichteinflüsse reduziert",
                ["ERM", "RISS"],
                "",
                [("M-V-03", 1), ("M-V-16", 3), ("M-E-15", 3)],
            ),
            (
                "N4",
                "> 10⁸ (Very High Cycle Fatigue)",
                "Ermüdung ausgehend von nichtmetallischen Einschlüssen",
                ["ERM"],
                "",
                [("M-V-03", 1), ("M-E-11", 3), ("M-E-15", 3), ("M-V-06", 4)],
            ),
        ],
    },
    {
        "code": "INS",
        "name": "Inspizierbarkeit",
        "list_no": 1,
        "options": [
            ("GUT", "Gut inspizierbar (frei zugänglich)", "", [], "", [("M-E-17", 2)]),
            ("EING", "Eingeschränkt inspizierbar (Demontage/Hilfsmittel nötig)", "", [], "", [("M-E-17", 2), ("M-E-18", 4)]),
            ("NICHT", "Nicht inspizierbar (verdeckt/unzugänglich)", "", [], "", [("M-V-23", 3), ("M-E-18", 3)]),
        ],
    },
    {
        "code": "SD",
        "name": "Schaden (Schadensbilder)",
        "list_no": 1,
        "multi": True,
        "is_failure_mode": True,
        "options": [
            (
                "BRUCH",
                "Gewaltbruch",
                "Überlast – Tragfähigkeit des Querschnitts überschritten",
                [],
                "Plötzliches Bauteilversagen, Funktionsverlust, mögliche Personengefährdung",
                [("M-V-02", 0), ("M-E-20", 2), ("M-V-22", 3)],
            ),
            (
                "ERM",
                "Ermüdungsbruch / Schwingbruch",
                "Schwingfestigkeit für die Betriebsbeanspruchung unzureichend",
                [],
                "Bruch nach Betriebszeit ohne Vorankündigung, Funktionsverlust, mögliche Personengefährdung",
                [("M-V-03", 1), ("M-V-04", 3), ("M-E-07", 3), ("M-E-15", 4), ("M-V-06", 4)],
            ),
            (
                "RISS",
                "Rissbildung",
                "Rissinitiierung an Fehlstellen oder Kerben",
                [],
                "Reduzierte Tragfähigkeit, Rissfortschritt bis zum Bruch",
                [("M-E-01", 0), ("M-E-07", 2), ("M-E-17", 3)],
            ),
            (
                "VERF",
                "Plastische Verformung",
                "Streckgrenze durch Betriebs- oder Sonderlasten überschritten",
                [],
                "Maß- und Lageabweichung, Klemmen, Funktionsbeeinträchtigung",
                [("M-V-02", 0), ("M-E-02", 0), ("M-V-25", 3)],
            ),
            (
                "VERS",
                "Verschleiß",
                "Unzureichende Verschleißbeständigkeit (Oberflächenhärte, Werkstoffpaarung, Schmierung)",
                [],
                "Spielvergrößerung, Geräuschbildung, Funktionsminderung",
                [("M-V-20", 0), ("M-V-19", 1), ("M-E-19", 2)],
            ),
            (
                "KORR",
                "Korrosion",
                "Korrosionsschutz für die Umgebungsbedingungen unzureichend",
                [],
                "Querschnittsschwächung, Festigkeitsverlust",
                [("M-V-15", 0), ("M-E-13", 1), ("M-E-17", 3)],
            ),
            (
                "UNDICHT",
                "Undichtigkeit",
                "Dichtung oder Dichtfläche ungeeignet bzw. beschädigt",
                [],
                "Medienverlust, Funktionsverlust hydraulischer/pneumatischer Komponenten",
                [("M-V-21", 0), ("M-E-14", 1)],
            ),
        ],
    },
]

# (Code, Bereich, Kategorie, Norm, Text, SC min, SC max, Bedingungen)
REQUIREMENTS = [
    ("R-HZ-001", "halbzeug", "Werkstoffzertifikat", "EN 10204", "Werksbescheinigung 2.1 nach EN 10204", 0, 0, {}),
    ("R-HZ-002", "halbzeug", "Werkstoffzertifikat", "EN 10204", "Werkszeugnis 2.2 nach EN 10204", 1, 1, {}),
    (
        "R-HZ-003",
        "halbzeug",
        "Werkstoffzertifikat",
        "EN 10204",
        "Abnahmeprüfzeugnis 3.1 nach EN 10204 mit chemischer Analyse und mechanischen Kennwerten",
        2,
        3,
        {},
    ),
    (
        "R-HZ-004",
        "halbzeug",
        "Werkstoffzertifikat",
        "EN 10204",
        "Abnahmeprüfzeugnis 3.2 nach EN 10204 (Bestätigung durch unabhängigen Sachverständigen)",
        4,
        4,
        {},
    ),
    (
        "R-HZ-010",
        "halbzeug",
        "Prüfumfang",
        "WN 210",
        "Kerbschlagbiegeversuch (Charpy-V) je Schmelze/Los, Prüftemperatur gemäß Einsatzbedingungen",
        2,
        4,
        {"MAT": ["S355", "VERG", "GS", "NIRO"]},
    ),
    (
        "R-HZ-011",
        "halbzeug",
        "Prüfumfang",
        "WN 300",
        "Ultraschallprüfung des Halbzeugs (Stab/Blech) nach EN 10228-3 bzw. EN 10160",
        3,
        4,
        {"BA": ["ZERS", "SCHM", "SCHW", "BLECH"]},
    ),
    (
        "R-HZ-012",
        "halbzeug",
        "Prüfumfang",
        "WN 220",
        "Gefügeprüfung (Metallographie) an mitgegossenen bzw. mitgeschmiedeten Probestücken",
        3,
        4,
        {"BA": ["GUSS", "SCHM"]},
    ),
    ("R-HZ-013", "halbzeug", "Prüfumfang", "WN 210", "Reinheitsgradbestimmung nach DIN EN 10247", 4, 4, {"MAT": ["VERG"]}),
    ("R-HZ-014", "halbzeug", "Prüfumfang", "WN 400", "Bruchmechanische Werkstoffkennwerte (K_IC, da/dN) nachweisen", 4, 4, {}),
    (
        "R-HZ-020",
        "halbzeug",
        "Liefervorschrift",
        "WN 210",
        "Lieferung gemäß Bestellspezifikation und allgemeinen Einkaufsbedingungen",
        0,
        4,
        {},
    ),
    (
        "R-HZ-021",
        "halbzeug",
        "Liefervorschrift",
        "WN 210",
        "Bezug nur von freigegebenen Lieferanten (Lieferantenfreigabe gemäß WN 210)",
        1,
        4,
        {},
    ),
    ("R-HZ-022", "halbzeug", "Liefervorschrift", "WN 500", "Chargenkennzeichnung (Schmelze/Los) auf dem Halbzeug", 2, 4, {}),
    (
        "R-HZ-023",
        "halbzeug",
        "Liefervorschrift",
        "WN 500",
        "Lückenlose Rückverfolgbarkeit Schmelze → Bauteil inkl. Umstempelung",
        3,
        4,
        {},
    ),
    (
        "R-HZ-024",
        "halbzeug",
        "Liefervorschrift",
        "WN 500",
        "Prozessaudit beim Lieferanten vor Erstbelieferung, jährliche Requalifikation",
        4,
        4,
        {},
    ),
    (
        "R-HZ-025",
        "halbzeug",
        "Liefervorschrift",
        "WN 220",
        "Gießerei mit qualifiziertem Gießprozess und Erstmusterfreigabe",
        2,
        4,
        {"BA": ["GUSS"]},
    ),
    (
        "R-HZ-026",
        "halbzeug",
        "Liefervorschrift",
        "WN 240",
        "Schweißzusatzwerkstoffe mit Abnahmeprüfzeugnis 3.1",
        2,
        4,
        {"BA": ["SCHW"]},
    ),
    (
        "R-HZ-027",
        "halbzeug",
        "Liefervorschrift",
        "WN 230",
        "Schmiedebetrieb mit qualifiziertem Umformprozess und Erstmusterfreigabe",
        2,
        4,
        {"BA": ["SCHM"]},
    ),
    ("R-BT-001", "bauteil", "Prüfmerkmal", "WN 500", "Maßprüfung der funktionsrelevanten Maße (Stichprobe)", 0, 4, {}),
    ("R-BT-002", "bauteil", "Prüfmerkmal", "WN 300", "Sichtprüfung 100 % auf Oberflächenfehler", 1, 4, {}),
    (
        "R-BT-003",
        "bauteil",
        "Prüfmerkmal",
        "WN 100",
        "Kennzeichnung der SC-Klasse und der Prüfmerkmale in der Zeichnung",
        2,
        4,
        {},
    ),
    (
        "R-BT-004",
        "bauteil",
        "Prüfmerkmal",
        "WN 300",
        "Oberflächenrissprüfung (MT/PT) der gekennzeichneten Zonen",
        2,
        4,
        {"BA": ["GUSS", "SCHM"]},
    ),
    (
        "R-BT-005",
        "bauteil",
        "Prüfmerkmal",
        "WN 220",
        "Durchstrahlungs- (RT) oder Ultraschallprüfung (UT) der hochbeanspruchten Gusszonen",
        3,
        4,
        {"BA": ["GUSS"]},
    ),
    ("R-BT-006", "bauteil", "Prüfmerkmal", "WN 230", "Ultraschallprüfung (UT) 100 % des Schmiedeteils", 3, 4, {"BA": ["SCHM"]}),
    (
        "R-BT-007",
        "bauteil",
        "Prüfmerkmal",
        "WN 240",
        "Sichtprüfung (VT) 100 % aller Schweißnähte nach EN ISO 17637",
        1,
        4,
        {"BA": ["SCHW"]},
    ),
    (
        "R-BT-008",
        "bauteil",
        "Prüfmerkmal",
        "WN 240",
        "ZfP tragender Schweißnähte (MT/PT 100 %, UT/RT gemäß WN 240)",
        3,
        4,
        {"BA": ["SCHW"]},
    ),
    (
        "R-BT-009",
        "bauteil",
        "Prüfmerkmal",
        "WN 210",
        "Härteprüfung als Nachweis der Wärmebehandlung je Los",
        3,
        4,
        {"MAT": ["VERG", "GS"]},
    ),
    (
        "R-BT-010",
        "bauteil",
        "Prüfmerkmal",
        "WN 300",
        "100 % ZfP aller hochbeanspruchten Bereiche durch ZfP-Personal Stufe 2 (EN ISO 9712)",
        4,
        4,
        {},
    ),
    ("R-BT-020", "bauteil", "Toleranzklasse", "ISO 2768", "Allgemeintoleranzen nach ISO 2768-mK", 0, 2, {}),
    (
        "R-BT-021",
        "bauteil",
        "Toleranzklasse",
        "ISO 2768",
        "Allgemeintoleranzen nach ISO 2768-fH, funktionsrelevante Maße einzeln toleriert",
        3,
        4,
        {},
    ),
    (
        "R-BT-022",
        "bauteil",
        "Toleranzklasse",
        "EN ISO 5817",
        "Schweißnähte Bewertungsgruppe C nach EN ISO 5817",
        1,
        2,
        {"BA": ["SCHW"]},
    ),
    (
        "R-BT-023",
        "bauteil",
        "Toleranzklasse",
        "EN ISO 5817",
        "Schweißnähte Bewertungsgruppe B nach EN ISO 5817 mit Kerbfallnachweis",
        3,
        4,
        {"BA": ["SCHW"]},
    ),
    ("R-BT-024", "bauteil", "Toleranzklasse", "WN 220", "Maßtoleranzgrad DCTG 10 nach ISO 8062-3", 1, 2, {"BA": ["GUSS"]}),
    (
        "R-BT-025",
        "bauteil",
        "Toleranzklasse",
        "WN 220",
        "Gussgüteklassen für hochbeanspruchte Zonen in der Zeichnung festgelegt (EN 12680/12681)",
        3,
        4,
        {"BA": ["GUSS"]},
    ),
    (
        "R-BT-026",
        "bauteil",
        "Toleranzklasse",
        "WN 400",
        "Oberflächenrauheit an Kerbstellen Ra ≤ 1,6 µm",
        3,
        4,
        {"BEL": ["SCHWELL", "WECHSEL", "KOMB"]},
    ),
    ("R-BT-030", "bauteil", "Nachweisführung", "WN 400", "Statischer Festigkeitsnachweis gemäß WN 400", 1, 4, {}),
    (
        "R-BT-031",
        "bauteil",
        "Nachweisführung",
        "WN 400",
        "Ermüdungsfestigkeitsnachweis nach FKM-Richtlinie bzw. EN 1993-1-9",
        2,
        4,
        {"BEL": ["SCHWELL", "WECHSEL", "STOSS", "KOMB"]},
    ),
    (
        "R-BT-032",
        "bauteil",
        "Nachweisführung",
        "WN 400",
        "Betriebsfestigkeitsnachweis mit Lastkollektiv und Sicherheitsbeiwerten gemäß WN 400",
        3,
        4,
        {},
    ),
    ("R-BT-033", "bauteil", "Nachweisführung", "WN 500", "Erstmusterprüfbericht (EMPB) mit vollständiger Vermessung", 3, 4, {}),
    (
        "R-BT-034",
        "bauteil",
        "Nachweisführung",
        "WN 400",
        "Unabhängige Prüfung des Festigkeitsnachweises (Prüfingenieur, 4-Augen-Prinzip)",
        4,
        4,
        {},
    ),
    (
        "R-BT-035",
        "bauteil",
        "Nachweisführung",
        "WN 400",
        "Bruchmechanischer Nachweis (Schadenstoleranz) mit Festlegung der Inspektionsintervalle",
        4,
        4,
        {},
    ),
    (
        "R-BT-036",
        "bauteil",
        "Nachweisführung",
        "WN 400",
        "Safe-Life-Nachweis über die gesamte Lebensdauer (keine Inspektion möglich)",
        3,
        4,
        {"INS": ["NICHT"]},
    ),
    (
        "R-BT-040",
        "bauteil",
        "Freigabe/Zertifizierung",
        "WN 500",
        "Archivierung der Prüfdokumentation (Aufbewahrung ≥ 10 Jahre)",
        2,
        4,
        {},
    ),
    (
        "R-BT-041",
        "bauteil",
        "Freigabe/Zertifizierung",
        "WN 500",
        "Zeichnungsfreigabe durch Konstruktionsleitung und Qualitätssicherung",
        3,
        4,
        {},
    ),
    (
        "R-BT-042",
        "bauteil",
        "Freigabe/Zertifizierung",
        "WN 500",
        "Freigabe durch externen Sachverständigen (z. B. TÜV) vor Serienfreigabe",
        4,
        4,
        {},
    ),
    (
        "R-BT-043",
        "bauteil",
        "Freigabe/Zertifizierung",
        "WN 500",
        "Seriennummer und Einzelteilrückverfolgbarkeit über die Lebensdauer",
        4,
        4,
        {},
    ),
    (
        "R-BT-044",
        "bauteil",
        "Freigabe/Zertifizierung",
        "WN 500",
        "Inspektionsplan mit Zugänglichkeits- und Demontageanweisung in der Betriebsanleitung",
        2,
        4,
        {"INS": ["EING"]},
    ),
]

# Demo-Klassifikationen für die Baugruppe BG-200100 (Zeichnungsnummer → Klassifikation)
DEMO_CLASSIFICATIONS = {
    "200110": {
        "sc_level": 4,
        "function": "Radlasten aufnehmen und auf den Achsträger übertragen",
        "values": {
            "BA": "SCHM",
            "GEO": "ROT",
            "MAT": "VERG",
            "BEL": "WECHSEL",
            "LSP": "N3",
            "INS": "EING",
            "SD": ["ERM", "BRUCH"],
        },
        "justification": "Versagen führt unmittelbar zum Verlust der Fahrwerksfunktion – höchste Sicherheitsrelevanz.",
    },
    "200120": {
        "sc_level": 3,
        "function": "Fahrzeug auf der Schiene führen und Radlast übertragen",
        "values": {
            "BA": "GUSS",
            "GEO": "ROT",
            "MAT": "GS",
            "BEL": "SCHWELL",
            "LSP": "N3",
            "INS": "GUT",
            "SD": ["ERM", "RISS", "VERS"],
        },
        "justification": "Tragendes und führendes Bauteil, Versagen sicherheitskritisch.",
    },
    "200130": {
        "sc_level": 2,
        "function": "Lager aufnehmen und Lagerkräfte in den Achsträger leiten",
        "values": {
            "BA": "GUSS",
            "GEO": "KOMPLEX",
            "MAT": "GJS",
            "BEL": "SCHWELL",
            "LSP": "N2",
            "INS": "EING",
            "SD": ["RISS", "BRUCH"],
        },
        "justification": "Redundante Lagerung vorhanden, Versagen wird frühzeitig durch Geräusch erkannt.",
    },
    "200140": {
        "sc_level": 3,
        "function": "Laufwerk mit dem Fahrzeugrahmen verbinden, Kräfte aus allen Richtungen aufnehmen",
        "values": {
            "BA": "SCHW",
            "GEO": "PRIS",
            "MAT": "S355",
            "BEL": "KOMB",
            "LSP": "N3",
            "INS": "GUT",
            "SD": ["ERM", "RISS", "KORR"],
        },
        "justification": "Primäres Tragwerk des Laufwerks.",
    },
    "200150": {
        "sc_level": 3,
        "function": "Radachse formschlüssig gegen Verdrehen und axiales Wandern sichern",
        "values": {"BA": "ZERS", "GEO": "ROT", "MAT": "VERG", "BEL": "STOSS", "LSP": "N2", "INS": "GUT", "SD": ["BRUCH", "VERS"]},
        "justification": "Sicherungsfunktion der Radachse.",
    },
    "200160": {
        "sc_level": 0,
        "function": "Spritzwasser und Schmutz von den Lagern fernhalten",
        "values": {
            "BA": "BLECH",
            "GEO": "FLACH",
            "MAT": "S355",
            "BEL": "STAT",
            "LSP": "N1",
            "INS": "GUT",
            "SD": ["VERF", "KORR"],
        },
        "justification": "Keine tragende Funktion.",
    },
}


def _seed_users(db: Session) -> None:
    if db.scalar(select(func.count()).select_from(User)):
        return
    admin_password = settings.admin_password
    if not admin_password:
        if settings.seed_demo:
            admin_password = "admin"
        else:
            admin_password = secrets.token_urlsafe(12)
            log.warning("Initiales Admin-Passwort: %s (bitte nach erster Anmeldung ändern)", admin_password)
    db.add(User(username="admin", full_name="Administrator", role=Role.ADMIN.value, password_hash=hash_password(admin_password)))
    if settings.seed_demo:
        db.add(
            User(
                username="konstrukteur",
                full_name="Klara Konstrukteur",
                role=Role.KONSTRUKTEUR.value,
                password_hash=hash_password("konstrukteur"),
            )
        )
        db.add(User(username="pruefer", full_name="Paul Prüfer", role=Role.PRUEFER.value, password_hash=hash_password("pruefer")))
    db.flush()


def _seed_catalog(db: Session) -> None:
    for level, name, req_level, severity, color in SC_CLASSES:
        db.add(
            ScClass(
                level=level,
                code=f"SC{level}",
                name=name,
                requirement_level=req_level,
                default_severity=severity,
                color=color,
                description=f"{name} – {req_level}",
            )
        )
    standards = {}
    for code, title in STANDARDS:
        is_wn = code.startswith("WN")
        std = Standard(
            code=code,
            title=title,
            revision="Muster" if is_wn else "",
            description="Musterdatensatz – durch gültige Werknorm ersetzen" if is_wn else "",
        )
        db.add(std)
        standards[code] = std
    measures = {}
    for code, mtype, title, rating, std in MEASURES:
        measure = Measure(code=code, measure_type=mtype, title=title, rating=rating, standard=standards.get(std) if std else None)
        db.add(measure)
        measures[code] = measure
    db.flush()

    option_measures: list[tuple[AttributeOption, list[tuple]]] = []
    for sort, spec in enumerate(ATTRIBUTES):
        attribute = Attribute(
            code=spec["code"],
            name=spec["name"],
            list_no=spec["list_no"],
            multi=spec.get("multi", False),
            is_failure_mode=spec.get("is_failure_mode", False),
            sort_order=sort * 10,
        )
        db.add(attribute)
        for osort, (code, label, cause, damages, effect, links) in enumerate(spec["options"]):
            option = AttributeOption(
                attribute=attribute,
                code=code,
                label=label,
                failure_cause=cause,
                relevant_damages=damages,
                failure_effect=effect,
                sort_order=osort * 10,
            )
            db.add(option)
            option_measures.append((option, links))
    db.flush()
    ensure_keys(db)

    keys = {(k.option_id, k.sc_level): k for k in db.scalars(select(KeyEntry)).all()}
    for option, links in option_measures:
        for link in links:
            code, sc_from = link[0], link[1]
            sc_to = link[2] if len(link) > 2 else 4
            measure = measures[code]
            for level in range(sc_from, sc_to + 1):
                rating = None
                # 100-%-Prüfungen ab SC3 entdecken zuverlässiger
                if measure.measure_type == "E" and level >= 3 and measure.rating > 2:
                    rating = measure.rating - 1
                db.add(
                    KeyMeasure(
                        key=keys[(option.id, level)],
                        measure=measure,
                        extent=DEFAULT_EXTENTS[measure.measure_type][level],
                        rating=rating,
                    )
                )

    for sort, (code, scope, category, std, text, sc_min, sc_max, conditions) in enumerate(REQUIREMENTS):
        db.add(
            Requirement(
                code=code,
                scope=scope,
                category=category,
                standard=standards.get(std),
                text=text,
                sc_min=sc_min,
                sc_max=sc_max,
                conditions=conditions,
                sort_order=sort,
            )
        )
    db.flush()


def _seed_demo_assembly(db: Session) -> None:
    from .services.pdm import DemoPdmConnector

    if db.scalar(select(func.count()).select_from(Assembly)):
        return
    designer = db.scalar(select(User).where(User.username == "konstrukteur"))
    bom = DemoPdmConnector(settings).get_bom("BG-200100")
    assembly = Assembly(
        drawing_number=bom.assembly.number,
        name=bom.assembly.name,
        revision=bom.assembly.revision,
        function="Fahrzeug sicher tragen, führen und Fahrkräfte in die Schiene übertragen",
        description=bom.assembly.description,
        source="pdm:demo",
        pdm_ref=bom.assembly.pdm_ref,
        created_by_id=designer.id if designer else None,
    )
    db.add(assembly)
    for sort, item in enumerate(bom.items):
        component = Component(assembly=assembly, sort_order=sort * 10, **item)
        db.add(component)
        demo = DEMO_CLASSIFICATIONS.get(item["drawing_number"])
        if demo:
            db.add(
                Classification(
                    component=component,
                    version=1,
                    designation=item["name"],
                    designation2=item["name2"],
                    function=demo["function"],
                    sc_level=demo["sc_level"],
                    values=demo["values"],
                    justification=demo["justification"],
                    created_by_id=designer.id if designer else None,
                )
            )
    db.flush()
    audit.log(db, designer, "IMPORT", "assembly", assembly.id, f"Demo-Baugruppe {assembly.drawing_number} aus Demo-PDM angelegt")


def seed(db: Session) -> None:
    _seed_users(db)
    if not db.scalar(select(func.count()).select_from(ScClass)):
        _seed_catalog(db)
        audit.log(db, None, "SEED", "catalog", "", "Regelwerk mit Musterdaten initialisiert")
    if settings.seed_demo:
        _seed_demo_assembly(db)
    db.commit()
