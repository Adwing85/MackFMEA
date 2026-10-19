"""PDF-Export des FMEA-Dokuments (A3 quer)."""

from __future__ import annotations

import io
import os
from functools import lru_cache
from pathlib import Path
from xml.sax.saxutils import escape

import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ..config import settings
from ..models import FmeaDocument
from .export_excel import STATUS_LABELS

_FONT_CANDIDATES = [
    os.environ.get("MACKFMEA_PDF_FONT", ""),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "C:/Windows/Fonts/arial.ttf",
]
# Ersatz für Zeichen, die die Ausweichschrift (Vera) nicht enthält
_FALLBACK_MAP = str.maketrans({"→": "->", "≤": "<=", "≥": ">=", "⁴": "^4", "⁶": "^6", "⁸": "^8", "…": "..."})
AP_COLORS = {"H": colors.HexColor("#F8B4B4"), "M": colors.HexColor("#FCE7A2"), "L": colors.HexColor("#BBE5C3")}


@lru_cache(maxsize=1)
def _fonts() -> tuple[str, str, bool]:
    """Registriert eine Unicode-Schrift. Liefert (normal, fett, unicode_vollständig)."""
    for candidate in _FONT_CANDIDATES:
        if candidate and Path(candidate).is_file():
            bold = Path(candidate.replace("DejaVuSans.ttf", "DejaVuSans-Bold.ttf"))
            pdfmetrics.registerFont(TTFont("FmeaSans", candidate))
            pdfmetrics.registerFont(TTFont("FmeaSans-Bold", str(bold) if bold.is_file() else candidate))
            return "FmeaSans", "FmeaSans-Bold", True
    vera_dir = Path(reportlab.__file__).parent / "fonts"
    pdfmetrics.registerFont(TTFont("FmeaSans", str(vera_dir / "Vera.ttf")))
    pdfmetrics.registerFont(TTFont("FmeaSans-Bold", str(vera_dir / "VeraBd.ttf")))
    return "FmeaSans", "FmeaSans-Bold", False


def _text(value: object) -> str:
    text = "" if value is None else str(value)
    if not _fonts()[2]:
        text = text.translate(_FALLBACK_MAP)
    return escape(text).replace("\n", "<br/>")


def build_pdf(doc: FmeaDocument) -> bytes:
    regular, bold, _ = _fonts()
    small = ParagraphStyle("small", fontName=regular, fontSize=6.5, leading=8)
    small_bold = ParagraphStyle("small_bold", parent=small, fontName=bold)
    head = ParagraphStyle("head", fontName=bold, fontSize=6.5, leading=8, textColor=colors.white)
    title_style = ParagraphStyle("title", fontName=bold, fontSize=15, leading=19)
    h2 = ParagraphStyle("h2", fontName=bold, fontSize=11, leading=14, spaceBefore=4, spaceAfter=4)
    info_style = ParagraphStyle("info", fontName=regular, fontSize=8, leading=10)

    def p(value: object, style: ParagraphStyle = small) -> Paragraph:
        return Paragraph(_text(value), style)

    buffer = io.BytesIO()
    page = landscape(A3)
    pdf = SimpleDocTemplate(
        buffer,
        pagesize=page,
        leftMargin=10 * mm,
        rightMargin=10 * mm,
        topMargin=12 * mm,
        bottomMargin=12 * mm,
        title=f"{doc.fmea_number} V{doc.version}",
        author=doc.created_by.username if doc.created_by else "",
    )
    status = STATUS_LABELS.get(doc.status, doc.status)

    def footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont(regular, 7)
        canvas.drawString(
            10 * mm,
            6 * mm,
            _text(f"{doc.fmea_number} · Version {doc.version} · Status: {status} · Hash {doc.content_hash[:16]}").replace(
                "<br/>", " "
            ),
        )
        canvas.drawRightString(page[0] - 10 * mm, 6 * mm, f"Seite {canvas.getPageNumber()}")
        canvas.restoreState()

    assembly = doc.assembly
    story = [Paragraph(_text(f"Design-FMEA (DFMEA) nach AIAG & VDA – {doc.title}"), title_style), Spacer(1, 4 * mm)]
    info = [
        ["Unternehmen", settings.company_name or "–", "DFMEA-Nr.", doc.fmea_number, "Team", doc.team or "–"],
        [
            "Betrachtungsgegenstand",
            f"{assembly.drawing_number} {assembly.name}",
            "Version / Status",
            f"{doc.version} / {status}",
            "Verantwortlich",
            doc.responsible or "–",
        ],
        [
            "Erstellt",
            f"{doc.created_at:%d.%m.%Y %H:%M} ({doc.created_by.username if doc.created_by else '–'})",
            "Geprüft",
            f"{doc.reviewed_by.username} {doc.reviewed_at:%d.%m.%Y %H:%M}" if doc.reviewed_by and doc.reviewed_at else "–",
            "Vertraulichkeit",
            doc.confidentiality or "–",
        ],
    ]
    info_table = Table(
        [[Paragraph(_text(c), info_style) for c in row] for row in info],
        colWidths=[40 * mm, 90 * mm, 32 * mm, 70 * mm, 30 * mm, 118 * mm],
    )
    info_table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#9CA3AF")),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#F3F4F6")),
                ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#F3F4F6")),
                ("BACKGROUND", (4, 0), (4, -1), colors.HexColor("#F3F4F6")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    story += [info_table, Spacer(1, 5 * mm)]

    headers = [
        "Nr.",
        "Betrachtetes Element",
        "Merkmal (nächstniedr. Ebene)",
        "Funktion",
        "Fehlerfolge (FE)",
        "B",
        "Fehlerart (FM)",
        "Fehlerursache (FC)",
        "Vermeidungsmaßnahmen (PC)",
        "A",
        "Entdeckungsmaßnahmen (DC)",
        "E",
        "AP",
        "SC",
        "Optimierung",
        "Verantw. / Termin / Status",
    ]
    widths = [9, 30, 28, 30, 34, 9, 24, 36, 48, 9, 48, 9, 9, 10, 39, 28]  # Summe 400 mm = Nutzbreite A3 quer
    data = [[Paragraph(_text(h), head) for h in headers]]
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3A5F")),
        ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#9CA3AF")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (5, 1), (5, -1), "CENTER"),
    ]
    for number, row in enumerate(doc.rows, start=1):
        optimization = "\n".join(t for t in (row.opt_prevention, row.opt_detection) if t)
        if row.opt_action_priority:
            optimization += f"\nAP neu: {row.opt_action_priority}"
        data.append(
            [
                p(number),
                p(row.focus_element),
                p(row.lower_level),
                p(row.function_focus),
                p(row.failure_effect),
                p(row.severity, small_bold),
                p(row.failure_mode),
                p(row.failure_cause),
                p(row.prevention_controls),
                p(row.occurrence, small_bold),
                p(row.detection_controls),
                p(row.detection, small_bold),
                p(row.action_priority, small_bold),
                p(row.special_characteristic),
                p(optimization.strip()),
                p(" / ".join(t for t in (row.opt_responsible, row.opt_target_date, row.opt_status) if t) or ""),
            ]
        )
        if row.action_priority in AP_COLORS:
            style_cmds.append(("BACKGROUND", (12, number), (12, number), AP_COLORS[row.action_priority]))
    table = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    table.setStyle(TableStyle(style_cmds))
    story.append(table)

    if doc.requirements:
        story += [PageBreak(), Paragraph("Abgeleitete Anforderungen an Halbzeug und Bauteil", h2)]
        req_data = [[Paragraph(_text(h), head) for h in ("Bauteil", "SC", "Bereich", "Kategorie", "Code", "Norm", "Anforderung")]]
        for r in doc.requirements:
            req_data.append(
                [
                    p(r.component_label),
                    p(f"SC{r.sc_level}"),
                    p("Halbzeug" if r.scope == "halbzeug" else "Bauteil"),
                    p(r.category),
                    p(r.requirement_code),
                    p(r.standard_code),
                    p(r.text),
                ]
            )
        req_table = Table(req_data, colWidths=[w * mm for w in (60, 12, 20, 40, 20, 24, 224)], repeatRows=1)
        req_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F3A5F")),
                    ("GRID", (0, 0), (-1, -1), 0.3, colors.HexColor("#9CA3AF")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]
            )
        )
        story.append(req_table)

    if doc.warnings:
        story += [Spacer(1, 5 * mm), Paragraph("Hinweise der Generierung", h2)]
        story += [Paragraph(_text(f"• {w}"), info_style) for w in doc.warnings]

    pdf.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
