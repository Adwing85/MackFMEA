import pytest

from app.services.bom_import import BomImportError, parse_bom_file

INVENTOR_CSV = """Stückliste Baugruppe HW-100;;;;
;;;;
Pos.;Bauteilnummer;Beschreibung;Menge;Material
1;HW-101;Grundplatte;1;S355J2+N
1.1;HW-102;Lasche;2,0;S355J2+N
2;HW-103;Welle;1;42CrMo4
""".encode("cp1252")

GENERIC_CSV = b"""Position,Zeichnungsnummer,Benennung,Benennung 2,Anzahl,Werkstoff,Ebene
10,A-1,Gehaeuse,oben,1,EN-GJS-400-18,1
20,A-2,Deckel,,2,EN AW-6082,2
"""

XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<BOM drawingNumber="BG-9" name="Testbaugruppe" revision="B">
  <Item position="10" drawingNumber="9-1" name="Rahmen" quantity="1" material="S355">
    <Item position="11" drawingNumber="9-2" name="Knotenblech" quantity="4"/>
  </Item>
  <Item>
    <Position>20</Position>
    <Zeichnungsnummer>9-3</Zeichnungsnummer>
    <Benennung>Bolzen</Benennung>
    <Menge>2</Menge>
  </Item>
</BOM>
"""


def test_inventor_csv_with_preamble_and_structured_positions():
    bom = parse_bom_file("hw100.csv", INVENTOR_CSV)
    assert [i["drawing_number"] for i in bom.items] == ["HW-101", "HW-102", "HW-103"]
    assert bom.items[1]["level"] == 2
    assert bom.items[1]["quantity"] == 2.0
    assert bom.items[0]["material_pdm"] == "S355J2+N"


def test_generic_csv_with_level_column():
    bom = parse_bom_file("liste.csv", GENERIC_CSV)
    assert len(bom.items) == 2
    assert bom.items[0]["name2"] == "oben"
    assert bom.items[1]["level"] == 2
    assert bom.items[1]["material_pdm"] == "EN AW-6082"


def test_xml_nested_items():
    bom = parse_bom_file("bom.xml", XML)
    assert bom.drawing_number == "BG-9"
    assert bom.name == "Testbaugruppe"
    assert bom.revision == "B"
    assert [(i["position"], i["drawing_number"], i["level"]) for i in bom.items] == [
        ("10", "9-1", 1),
        ("11", "9-2", 2),
        ("20", "9-3", 1),
    ]
    assert bom.items[2]["quantity"] == 2.0


def test_xml_entity_expansion_is_rejected():
    payload = b"""<?xml version="1.0"?><!DOCTYPE l [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><BOM><Item name="&b;"/></BOM>"""
    with pytest.raises(BomImportError):
        parse_bom_file("evil.xml", payload)


def test_csv_without_header_is_rejected():
    with pytest.raises(BomImportError):
        parse_bom_file("x.csv", b"1;2;3\n4;5;6\n")
