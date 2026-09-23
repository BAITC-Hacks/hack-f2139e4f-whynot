"""Idempotent synthetic demo fixtures: python -m app.seed."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.db import Base, make_engine, make_session_factory
from app.models import Actor, Proposal, Task, Team, now
from app.rating import calculate_rating
from app.schemas import Card
from app.team_models import ProposalParticipant, TeamMembership
from app.teams import backfill_team_memberships

EXAMPLES = [
    (
        "Прогноз остатков магазина",
        "retail",
        "Магазин хочет реже сталкиваться с нехваткой товара.",
        "Продавцы и закупщики",
        "CSV продаж и остатков за 6 месяцев; синтетические примеры готовы.",
        "Python",
        2,
    ),
    (
        "Помощник по учебным материалам",
        "education",
        "Учебный центр хочет ускорить поиск ответов в своих материалах.",
        "Преподаватели и студенты",
        "20 учебных PDF без персональных данных; доступ по согласованию.",
        "NLP",
        4,
    ),
    (
        "Планирование доставок",
        "logistics",
        "Служба доставки составляет маршруты вручную и хочет сократить время планирования.",
        "Диспетчеры",
        "CSV с 100 синтетическими заказами и координатами.",
        "Optimization",
        6,
    ),
    (
        "Обзор состояния теплицы",
        "agriculture",
        "Теплица хочет видеть отклонения показателей датчиков на одном экране.",
        "Агрономы",
        "CSV температуры и влажности за 30 дней; тестовые данные.",
        "Data analysis",
        7,
    ),
    (
        "Классификация обращений",
        "services",
        "Сервисная компания хочет распределять обращения по категориям быстрее.",
        "Операторы поддержки",
        "500 синтетических обращений с категориями, доступных команде.",
        "NLP",
        9,
    ),
]


def seed_actors(db: Session):
    if db.get(Actor, "business-1") is None:
        db.add(Actor(id="business-1", name="Демо-бизнес", role="business"))
    for index in range(1, 6):
        actor_id = f"student-{index}"
        if db.get(Actor, actor_id) is None:
            db.add(Actor(id=actor_id, name=f"Капитан команды {index}", role="student"))
        for member in (2, 3):
            member_id = f"student-{index}-member-{member}"
            if db.get(Actor, member_id) is None:
                db.add(
                    Actor(
                        id=member_id,
                        name=f"Демо-участник {member} команды {index}",
                        role="student",
                    )
                )
    db.commit()


def seed_demo(db: Session):
    seed_actors(db)
    field_order = [
        "context",
        "need",
        "data",
        "expected_result",
        "success_criteria",
        "constraints",
        "users",
        "contact",
        "interaction_format",
    ]
    for index, (title, topic, raw, users, data, skill, count) in enumerate(EXAMPLES, 1):
        team_id, draft_id, task_id = f"team-{index}", f"demo-draft-{index}", f"demo-task-{index}"
        existing_team = db.scalar(select(Team).where(Team.owner_id == f"student-{index}"))
        if existing_team is not None:
            team_id = existing_team.id
        if db.get(Team, team_id) is None:
            db.add(
                Team(
                    id=team_id,
                    owner_id=f"student-{index}",
                    name=f"Sana Team {index}",
                    interests=[topic],
                    skills=[skill],
                    technologies=["Python", "React"],
                )
            )
        if db.get(Task, draft_id) is None:
            # Separate drafts intentionally have different levels of completeness.
            draft_card = Card(
                title=title,
                topic=topic,
                context=raw if index > 1 else "",
                users=users if index > 3 else "",
            )
            db.add(
                Task(
                    id=draft_id,
                    owner_id="business-1",
                    raw_description=raw,
                    card=draft_card.model_dump(),
                )
            )
        if db.get(Task, task_id) is None:
            full = Card(
                title=title,
                topic=topic,
                context=raw,
                need="Сократить ручную работу в описанном процессе.",
                users=users,
                data=data,
                expected_result="Работающий прототип с инструкцией и примером использования.",
                success_criteria="Обработать 20 тестовых примеров; не менее 16 верных результатов.",
                constraints="Срок 2 недели; только синтетические данные и открытые библиотеки.",
                contact=f"business{index}@example.com",
                interaction_format=(
                    "Созвон раз в неделю; обратная связь в течение двух рабочих дней."
                ),
            ).model_dump()
            card = Card.model_validate(
                {
                    key: value
                    for key, value in full.items()
                    if key in ["title", "topic", *field_order[:count]]
                }
            )
            confirmed = [key for key, value in card.model_dump().items() if value]
            db.add(
                Task(
                    id=task_id,
                    owner_id="business-1",
                    raw_description=raw,
                    card=card.model_dump(),
                    confirmed_fields=confirmed,
                    confirmed_revision=1,
                    published_revision=1,
                    published_card=card.model_dump(),
                    published_topic=topic,
                    published_score=calculate_rating(card, confirmed).score,
                    published_at=now(),
                )
            )
        db.flush()
        owner_id = f"student-{index}"
        if db.get(TeamMembership, owner_id) is None:
            db.add(TeamMembership(actor_id=owner_id, team_id=team_id, slot=1))
        occupied = set(
            db.scalars(select(TeamMembership.slot).where(TeamMembership.team_id == team_id))
        )
        for member in (2, 3):
            actor_id = f"student-{index}-member-{member}"
            if len(occupied) >= 3:
                break
            if db.get(TeamMembership, actor_id) is None:
                slot = next(slot for slot in range(1, 6) if slot not in occupied)
                db.add(TeamMembership(actor_id=actor_id, team_id=team_id, slot=slot))
                occupied.add(slot)
        proposal_id = f"demo-proposal-{index}"
        if db.get(Proposal, proposal_id) is None:
            db.add(
                Proposal(
                    id=proposal_id,
                    task_id=task_id,
                    team_id=team_id,
                    idea=f"Разработать прототип для задачи «{title}» на тестовых данных.",
                    plan=(
                        "Уточнить требования, проверить данные, собрать прототип, "
                        "провести демонстрацию."
                    ),
                    timeline="2 недели",
                    prototype_url=f"https://example.com/prototypes/{index}",
                )
            )
            db.flush()
            participants = db.scalars(
                select(TeamMembership.actor_id).where(TeamMembership.team_id == team_id)
            ).all()
            db.add_all(
                [
                    ProposalParticipant(proposal_id=proposal_id, actor_id=actor_id)
                    for actor_id in participants
                ]
            )
    db.commit()
    backfill_team_memberships(db)


def main():
    settings = Settings()
    if not settings.demo_mode:
        raise SystemExit("Seed requires DEMO_MODE=true")
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)
    with make_session_factory(engine)() as db:
        seed_demo(db)
    engine.dispose()
    print("Demo data ready: 5 drafts, 5 published cards, 5 teams, 5 proposals.")


if __name__ == "__main__":
    main()
