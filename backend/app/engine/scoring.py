"""S4: pure score_field helper for evaluation comparisons."""
from __future__ import annotations

import json
from typing import Any, Literal

MatchStatus = Literal[
    "exact", "fuzzy", "mismatch", "missing_pred", "missing_expected",
]


def _normalize(v: Any) -> str | None:
    if v is None:
        return None
    if isinstance(v, (dict, list)):
        return json.dumps(v, sort_keys=True, ensure_ascii=False)
    return str(v)


def score_field(
    predicted: Any, expected: Any, field_type: str = "string",
) -> MatchStatus:
    """Compare predicted vs expected value; return match status string.

    See spec §6 for the algorithm spec.
    """
    if predicted is None and expected is None:
        # Both empty: classify as no-signal. Caller excludes from accuracy denom.
        return "missing_expected"
    if predicted is None:
        return "missing_pred"
    if expected is None:
        return "missing_expected"

    p = _normalize(predicted)
    e = _normalize(expected)
    assert p is not None and e is not None  # type-narrowing

    p_str = p.strip()
    e_str = e.strip()

    if field_type == "number":
        try:
            if abs(float(p_str) - float(e_str)) < 1e-6:
                return "exact"
            return "mismatch"
        except ValueError:
            pass

    if field_type == "date":
        try:
            from dateutil.parser import parse as _dp
            if _dp(p_str) == _dp(e_str):
                return "exact"
            return "mismatch"
        except Exception:
            pass

    if p_str == e_str:
        return "exact"
    if p_str.lower() == e_str.lower():
        return "fuzzy"
    return "mismatch"
