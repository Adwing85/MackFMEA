import itertools

import pytest

from app.services import rules


@pytest.fixture
def ruleset(db):
    return rules.load_ruleset(db)


def _combinations(ruleset):
    single = [a for a in ruleset.attributes if not a.multi]
    choices = [[o.code for o in ruleset.options_of(a)] for a in single]
    for combo in itertools.product(*choices):
        values = {a.code: [code] for a, code in zip(single, combo, strict=True)}
        values["SD"] = ["ERM", "RISS"]
        yield values


def test_seed_ruleset_is_consistent(ruleset):
    report = rules.consistency_report(ruleset)
    assert report["consistent"], report["issues"]
    totals = [t["requirements"] for t in report["totals"]]
    assert totals == sorted(totals)


def test_requirement_count_grows_with_sc_class_for_every_combination(ruleset):
    """Kernanforderung: SC0 hat das kleinste, SC4 das größte Anforderungsset – für jede Klassifikation."""
    checked = 0
    for values in _combinations(ruleset):
        counts = [len(rules.derive_requirements(ruleset, values, level)) for level in rules.SC_LEVELS]
        assert counts == sorted(counts), (values, counts)
        assert counts[0] < counts[4]
        measures = [len(rules.merge_measures(rules.resolve_keys(ruleset, values, level))) for level in rules.SC_LEVELS]
        assert measures == sorted(measures), (values, measures)
        checked += 1
    assert checked > 1000


def test_key_codes_follow_attribute_option_sc_pattern(ruleset):
    values = {"BA": ["GUSS"], "MAT": ["GJS"], "SD": ["RISS"]}
    keys = rules.resolve_keys(ruleset, values, 3)
    assert {k.code for k in keys} == {"BA-GUSS-SC3", "MAT-GJS-SC3", "SD-RISS-SC3"}
    assert all(k.key is not None for k in keys)


def test_conditional_requirements_only_apply_to_matching_parts(ruleset):
    weld = rules.derive_requirements(ruleset, {"BA": ["SCHW"]}, 3)
    cast = rules.derive_requirements(ruleset, {"BA": ["GUSS"]}, 3)
    assert "R-BT-008" in {r.code for r in weld}
    assert "R-BT-008" not in {r.code for r in cast}
    assert "R-BT-005" in {r.code for r in cast}


def test_certificate_requirement_gets_stricter(ruleset):
    def certificate(level):
        reqs = rules.derive_requirements(ruleset, {}, level)
        return [r.code for r in reqs if r.category == "Werkstoffzertifikat"]

    assert certificate(0) == ["R-HZ-001"]
    assert certificate(2) == ["R-HZ-003"]
    assert certificate(4) == ["R-HZ-004"]


def test_validation_reports_missing_and_unknown_values(ruleset):
    with pytest.raises(rules.ClassificationError) as exc:
        rules.validate_classification(ruleset, {"BA": "HOLZ", "SD": []}, 2)
    message = " ".join(exc.value.errors)
    assert "Bauteilart: unbekannte Ausprägung" in message
    assert "Material: Angabe erforderlich" in message
    assert "Schaden (Schadensbilder): Angabe erforderlich" in message


def test_single_value_attribute_rejects_multiple_values(ruleset):
    values = {"BA": ["GUSS", "SCHM"], "GEO": "ROT", "MAT": "GJS", "BEL": "STAT", "LSP": "N1", "INS": "GUT", "SD": ["BRUCH"]}
    with pytest.raises(rules.ClassificationError) as exc:
        rules.validate_classification(ruleset, values, 1)
    assert any("nur eine Ausprägung" in e for e in exc.value.errors)


def test_preview_contains_per_level_overview(ruleset):
    result = rules.preview(ruleset, {"BA": "SCHW", "BEL": "WECHSEL", "SD": ["ERM"]}, 2)
    assert result["sc_class"]["code"] == "SC2"
    assert [p["sc_level"] for p in result["per_level"]] == [0, 1, 2, 3, 4]
    assert result["requirements"]
    assert any(m["measure_type"] == "E" for m in result["measures"])


def test_fingerprint_changes_when_rules_change(db, ruleset):
    before = ruleset.fingerprint()
    req = ruleset.requirements[0]
    req.text = req.text + " (geändert)"
    db.flush()
    assert rules.load_ruleset(db).fingerprint() != before
