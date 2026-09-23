import pytest

from app.rating import calculate_rating, readiness
from app.schemas import Card


@pytest.mark.parametrize(
    ("score", "level"),
    [
        (0, "draft"),
        (39, "draft"),
        (40, "working"),
        (69, "working"),
        (70, "ready"),
        (89, "ready"),
        (90, "priority"),
        (100, "priority"),
    ],
)
def test_readiness_boundaries(score, level):
    assert readiness(score) == level


def test_only_confirmed_nonempty_fields_count(full_card):
    card = Card(**full_card)
    unconfirmed = calculate_rating(card, [])
    assert unconfirmed.score == 0
    assert unconfirmed.preview_score == 100
    assert calculate_rating(card, list(full_card)).score == 100
    assert calculate_rating(Card(context="   "), ["context"]).score == 0
    partial = calculate_rating(card, ["context", "data", "contact"])
    assert partial.score == 35
    assert sum(row.max_points for row in partial.breakdown) == 100
    assert "need" in partial.unconfirmed_fields
    assert calculate_rating(Card(), []).missing_fields
