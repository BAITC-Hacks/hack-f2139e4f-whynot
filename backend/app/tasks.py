from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import DomainError
from app.models import Actor, Task, now
from app.rating import calculate_rating
from app.schemas import (
    Card,
    CardUpdate,
    CatalogPage,
    CatalogTask,
    Readiness,
    TaskCreate,
    TaskView,
)

READINESS_RANGES = {"draft": (0, 39), "working": (40, 69), "ready": (70, 89), "priority": (90, 100)}


def owned_task(db: Session, task_id: str, actor: Actor) -> Task:
    task = db.get(Task, task_id)
    if task is None or task.owner_id != actor.id:
        raise DomainError(404, "TASK_NOT_FOUND", "Задача не найдена.")
    return task


def check_revision(task: Task, expected: int):
    if task.revision != expected:
        raise DomainError(
            409, "STALE_REVISION", "Карточка изменилась. Загрузите актуальную версию."
        )


def task_view(task: Task) -> TaskView:
    card = Card.model_validate(task.card)
    return TaskView(
        id=task.id,
        owner_id=task.owner_id,
        raw_description=task.raw_description,
        card=card,
        revision=task.revision,
        confirmed_revision=task.confirmed_revision,
        published_revision=task.published_revision,
        confirmed_fields=task.confirmed_fields,
        status="published" if task.published_card is not None else "draft",
        rating=calculate_rating(card, task.confirmed_fields),
        created_at=task.created_at,
    )


def create_task(db: Session, actor: Actor, payload: TaskCreate) -> Task:
    task = Task(
        owner_id=actor.id,
        raw_description=payload.raw_description,
        card=Card(
            title=payload.title or payload.raw_description[:100], topic=payload.topic
        ).model_dump(),
    )
    db.add(task)
    db.commit()
    return task


def update_card(db: Session, task: Task, payload: CardUpdate) -> Task:
    check_revision(task, payload.expected_revision)
    values = payload.card.model_dump()
    if values != task.card:
        task.confirmed_fields = [
            field for field in task.confirmed_fields if task.card[field] == values[field]
        ]
        task.card = values
        task.revision += 1
        task.confirmed_revision = None
        db.commit()
    return task


def confirm_task(db: Session, task: Task, expected: int) -> Task:
    check_revision(task, expected)
    task.confirmed_fields = [field for field, value in task.card.items() if value]
    task.confirmed_revision = task.revision
    db.commit()
    return task


def publish_task(db: Session, task: Task, expected: int) -> Task:
    check_revision(task, expected)
    if task.confirmed_revision != task.revision:
        raise DomainError(409, "CONFIRMATION_REQUIRED", "Подтвердите текущую версию карточки.")
    card = Card.model_validate(task.card)
    if not card.title or not card.topic:
        raise DomainError(422, "CARD_LABELS_REQUIRED", "Для публикации нужны название и тема.")
    if task.published_revision != task.revision:
        task.published_card = card.model_dump()
        task.published_score = calculate_rating(card, task.confirmed_fields).score
        task.published_topic = card.topic
        task.published_revision = task.revision
        task.published_at = now()
        db.commit()
    return task


def catalog_view(task: Task) -> CatalogTask:
    card = Card.model_validate(task.published_card)
    return CatalogTask(
        id=task.id,
        card=card,
        revision=task.published_revision,
        rating=calculate_rating(card, list(card.model_dump())),
        published_at=task.published_at,
    )


def catalog(
    db: Session, topic: str | None, level: Readiness | None, limit: int, offset: int
) -> CatalogPage:
    filters = [Task.published_card.is_not(None), Task.published_revision.is_not(None)]
    if topic is not None:
        filters.append(Task.published_topic == topic)
    if level is not None:
        low, high = READINESS_RANGES[level]
        filters.append(Task.published_score.between(low, high))
    total = db.scalar(select(func.count()).select_from(Task).where(*filters))
    rows = db.scalars(
        select(Task)
        .where(*filters)
        .order_by(
            Task.published_score.desc(),
            Task.published_at.desc(),
            Task.id.asc(),
        )
        .limit(limit)
        .offset(offset)
    ).all()
    return CatalogPage(
        items=[catalog_view(task) for task in rows], total=total, limit=limit, offset=offset
    )
