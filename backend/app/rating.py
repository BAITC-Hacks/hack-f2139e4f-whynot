from dataclasses import dataclass

from app.schemas import Card, CardField, Rating, Readiness, ScoreItem


@dataclass(frozen=True)
class Criterion:
    key: str
    label: str
    weights: dict[CardField, int]
    suggestion: str


CRITERIA = (
    Criterion(
        "context_need",
        "Контекст и потребность",
        {"context": 10, "need": 10},
        "Опишите текущий процесс и что требуется изменить.",
    ),
    Criterion(
        "data",
        "Данные и материалы",
        {"data": 20},
        "Укажите доступные данные, примеры и способ доступа.",
    ),
    Criterion(
        "result",
        "Ожидаемый результат",
        {"expected_result": 15},
        "Назовите конкретный результат: прототип, отчёт или интеграцию.",
    ),
    Criterion(
        "success",
        "Критерии успеха",
        {"success_criteria": 15},
        "Укажите измеримые критерии и способ приёмки.",
    ),
    Criterion(
        "constraints",
        "Ограничения",
        {"constraints": 10},
        "Уточните сроки, технологии и ограничения доступа.",
    ),
    Criterion(
        "users",
        "Пользователи",
        {"users": 10},
        "Укажите, кто и в каких условиях будет пользоваться решением.",
    ),
    Criterion(
        "communication",
        "Связь с бизнесом",
        {"contact": 5, "interaction_format": 5},
        "Добавьте контакт и порядок консультаций и обратной связи.",
    ),
)


def readiness(score: int) -> Readiness:
    if score < 40:
        return "draft"
    if score < 70:
        return "working"
    if score < 90:
        return "ready"
    return "priority"


def calculate_rating(card: Card, confirmed_fields: list[str]) -> Rating:
    values = card.model_dump()
    confirmed = set(confirmed_fields)
    breakdown = []
    preview = 0
    for criterion in CRITERIA:
        missing = [field for field in criterion.weights if not values[field]]
        unconfirmed = [
            field for field in criterion.weights if values[field] and field not in confirmed
        ]
        points = sum(
            weight
            for field, weight in criterion.weights.items()
            if values[field] and field in confirmed
        )
        preview += sum(weight for field, weight in criterion.weights.items() if values[field])
        breakdown.append(
            ScoreItem(
                key=criterion.key,
                label=criterion.label,
                points=points,
                max_points=sum(criterion.weights.values()),
                missing_fields=missing,
                unconfirmed_fields=unconfirmed,
                suggestion=criterion.suggestion
                if missing
                else ("Подтвердите заполненные сведения." if unconfirmed else ""),
            )
        )
    score = sum(item.points for item in breakdown)
    return Rating(
        score=score,
        preview_score=preview,
        readiness=readiness(score),
        breakdown=breakdown,
        missing_fields=[field for item in breakdown for field in item.missing_fields],
        unconfirmed_fields=[field for item in breakdown for field in item.unconfirmed_fields],
    )
