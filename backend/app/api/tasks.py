from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import select

from app import tasks
from app.ai import SYSTEM_PROMPT, build_assist_source
from app.api.dependencies import DB, Business
from app.errors import DomainError
from app.models import Task
from app.schemas import (
    AIQuestions,
    AssistInput,
    AssistView,
    Card,
    CardUpdate,
    CatalogPage,
    CatalogTask,
    Readiness,
    RevisionInput,
    TaskCreate,
    TaskView,
)

router = APIRouter(tags=["Tasks"])


@router.post("/tasks", response_model=TaskView, status_code=201)
def create_task(payload: TaskCreate, db: DB, actor: Business):
    return tasks.task_view(tasks.create_task(db, actor, payload))


@router.get("/tasks/mine", response_model=list[TaskView])
def my_tasks(db: DB, actor: Business):
    rows = db.scalars(
        select(Task).where(Task.owner_id == actor.id).order_by(Task.created_at.desc())
    )
    return [tasks.task_view(task) for task in rows]


@router.get("/tasks/{task_id}", response_model=TaskView)
def get_task(task_id: str, db: DB, actor: Business):
    return tasks.task_view(tasks.owned_task(db, task_id, actor))


@router.put("/tasks/{task_id}/card", response_model=TaskView)
def update_task(task_id: str, payload: CardUpdate, db: DB, actor: Business):
    return tasks.task_view(tasks.update_card(db, tasks.owned_task(db, task_id, actor), payload))


@router.post("/tasks/{task_id}/confirm", response_model=TaskView)
def confirm_task(task_id: str, payload: RevisionInput, db: DB, actor: Business):
    return tasks.task_view(
        tasks.confirm_task(
            db,
            tasks.owned_task(db, task_id, actor),
            payload.expected_revision,
        )
    )


@router.post("/tasks/{task_id}/publish", response_model=TaskView)
def publish_task(task_id: str, payload: RevisionInput, db: DB, actor: Business):
    return tasks.task_view(
        tasks.publish_task(
            db,
            tasks.owned_task(db, task_id, actor),
            payload.expected_revision,
        )
    )


@router.post("/tasks/{task_id}/assist", response_model=AssistView, tags=["AI"])
def assist(task_id: str, payload: AssistInput, db: DB, actor: Business, request: Request):
    task = tasks.owned_task(db, task_id, actor)
    return request.app.state.assistant.assist(
        task.raw_description,
        Card.model_validate(task.card),
        task.revision,
        payload,
    )


@router.get("/ai/contract", tags=["AI"])
def ai_contract(request: Request):
    return {
        "provider": request.app.state.settings.ai_provider,
        "system_prompt": SYSTEM_PROMPT,
        "request_schema": AssistInput.model_json_schema(),
        "input": {
            "raw_description": "string",
            "card": Card.model_json_schema(),
            "missing_fields": ["data", "success_criteria", "expected_result"],
        },
        "input_example": build_assist_source(
            "Хотим заранее понимать, какие товары заканчиваются в магазине.",
            Card(topic="retail", data="CSV продаж за 6 месяцев"),
            AssistInput(answers={"data": "CSV продаж за 6 месяцев"}),
        ),
        "output_schema": AIQuestions.model_json_schema(),
        "fallback": "stub with provider=stub and a non-empty fallback_reason on provider failure",
    }


@router.get("/catalog", response_model=CatalogPage, tags=["Catalog"])
def get_catalog(
    db: DB,
    topic: Annotated[str | None, Query(max_length=100)] = None,
    readiness: Readiness | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    return tasks.catalog(db, topic, readiness, limit, offset)


@router.get("/catalog/{task_id}", response_model=CatalogTask, tags=["Catalog"])
def get_catalog_task(task_id: str, db: DB):
    task = db.get(Task, task_id)
    if task is None or task.published_revision is None:
        raise DomainError(404, "TASK_NOT_FOUND", "Опубликованная задача не найдена.")
    return tasks.catalog_view(task)
