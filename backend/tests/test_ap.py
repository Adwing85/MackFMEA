import pytest

from app.services.ap import action_priority


@pytest.mark.parametrize(
    ("s", "o", "d", "expected"),
    [
        (10, 10, 10, "H"),
        (9, 4, 1, "M"),
        (9, 3, 7, "H"),
        (9, 3, 5, "M"),
        (9, 2, 2, "L"),
        (10, 1, 10, "L"),
        (8, 7, 1, "M"),
        (7, 5, 7, "H"),
        (7, 5, 5, "M"),
        (7, 3, 6, "M"),
        (7, 3, 3, "L"),
        (5, 8, 6, "H"),
        (5, 8, 4, "M"),
        (6, 6, 2, "M"),
        (4, 7, 1, "L"),
        (5, 4, 8, "M"),
        (5, 4, 5, "L"),
        (3, 9, 9, "M"),
        (2, 8, 3, "L"),
        (3, 6, 10, "L"),
        (1, 10, 10, "L"),
    ],
)
def test_action_priority_table(s, o, d, expected):
    assert action_priority(s, o, d) == expected


def test_action_priority_clamps_out_of_range_values():
    assert action_priority(12, 0, 15) == action_priority(10, 1, 10)


def test_severity_monotonic():
    order = {"L": 0, "M": 1, "H": 2}
    for o in range(1, 11):
        for d in range(1, 11):
            values = [order[action_priority(s, o, d)] for s in range(1, 11)]
            assert values == sorted(values), (o, d, values)
