"""Aufgabenpriorität (Action Priority, AP) gemäß AIAG & VDA FMEA-Handbuch (DFMEA)."""

from __future__ import annotations

# Bänder für Auftreten (A/O) und Entdeckung (E/D)
_O_BANDS = ((8, 10), (6, 7), (4, 5), (2, 3), (1, 1))
_D_BANDS = ((7, 10), (5, 6), (2, 4), (1, 1))

# _TABLE[S-Band][O-Band] = AP für D-Bänder (7-10, 5-6, 2-4, 1)
_TABLE = {
    "9-10": ("HHHH", "HHHH", "HHHM", "HMLL", "LLLL"),
    "7-8": ("HHHH", "HHHM", "HMMM", "MMLL", "LLLL"),
    "4-6": ("HHMM", "MMML", "MLLL", "LLLL", "LLLL"),
    "2-3": ("MMLL", "LLLL", "LLLL", "LLLL", "LLLL"),
}


def _band_index(value: int, bands: tuple[tuple[int, int], ...]) -> int:
    for idx, (low, high) in enumerate(bands):
        if low <= value <= high:
            return idx
    raise ValueError(f"Bewertung {value} außerhalb 1–10")


def clamp(value: int) -> int:
    return max(1, min(10, int(value)))


def action_priority(severity: int, occurrence: int, detection: int) -> str:
    """Liefert 'H', 'M' oder 'L'."""
    s, o, d = clamp(severity), clamp(occurrence), clamp(detection)
    if s == 1:
        return "L"
    if s >= 9:
        s_band = "9-10"
    elif s >= 7:
        s_band = "7-8"
    elif s >= 4:
        s_band = "4-6"
    else:
        s_band = "2-3"
    return _TABLE[s_band][_band_index(o, _O_BANDS)][_band_index(d, _D_BANDS)]


AP_LABELS = {"H": "Hoch", "M": "Mittel", "L": "Niedrig"}
