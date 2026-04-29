"""S4/T2: scoring.score_field tests."""
from __future__ import annotations


def test_score_field_exact_string():
    from app.engine.scoring import score_field
    assert score_field("INV-001", "INV-001") == "exact"


def test_score_field_fuzzy_case_insensitive():
    from app.engine.scoring import score_field
    assert score_field("HELLO", "hello") == "fuzzy"
    assert score_field("hello world", "Hello World") == "fuzzy"


def test_score_field_mismatch_string():
    from app.engine.scoring import score_field
    assert score_field("a", "b") == "mismatch"


def test_score_field_missing_pred_and_expected():
    from app.engine.scoring import score_field
    assert score_field(None, "x") == "missing_pred"
    assert score_field("x", None) == "missing_expected"
    assert score_field(None, None) == "missing_expected"


def test_score_field_number_and_date_and_nested():
    from app.engine.scoring import score_field
    # number: tolerant
    assert score_field("100", "100.0", field_type="number") == "exact"
    assert score_field("100", "200", field_type="number") == "mismatch"
    # date: dateutil parse
    assert score_field("2024-11-27", "2024/11/27", field_type="date") == "exact"
    # nested object: JSON-stringified compare with sort_keys
    assert score_field({"b": 2, "a": 1}, {"a": 1, "b": 2}) == "exact"
    # array: same
    assert score_field([{"q": 1}], [{"q": 1}]) == "exact"
    assert score_field([{"q": 1}], [{"q": 2}]) == "mismatch"
