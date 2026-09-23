import hashlib
import secrets

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.errors import DomainError
from app.models import Actor, Milestone, Proposal, Team
from app.schemas import TeamInput, TeamMemberView, TeamPublicView, TeamView
from app.student_profiles import StudentProfile, require_student_profile
from app.team_models import ProposalParticipant, TeamInvite, TeamMembership


def invite_digest(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode("utf-8")).hexdigest()


def _new_invite() -> tuple[str, str]:
    code = secrets.token_hex(8).upper()
    return code, invite_digest(code)


def current_team(db: Session, actor: Actor) -> Team:
    team = db.scalar(select(Team).join(TeamMembership).where(TeamMembership.actor_id == actor.id))
    if team is None:
        raise DomainError(409, "TEAM_REQUIRED", "Создайте команду или вступите по приглашению.")
    return team


def lock_team(db: Session, team: Team) -> None:
    # A real write lock works on both SQLite and PostgreSQL and serializes roster changes.
    result = db.execute(
        update(Team)
        .where(Team.id == team.id)
        .values(name=Team.name)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise DomainError(404, "TEAM_NOT_FOUND", "Команда не найдена.")


def require_team_leader(team: Team, actor: Actor) -> None:
    if team.owner_id != actor.id:
        raise DomainError(403, "TEAM_LEADER_REQUIRED", "Действие доступно только капитану команды.")


def member_ids(db: Session, team: Team) -> list[str]:
    return list(
        db.scalars(
            select(TeamMembership.actor_id)
            .where(TeamMembership.team_id == team.id)
            .order_by(TeamMembership.slot)
        )
    )


def public_team_view(db: Session, team: Team) -> TeamPublicView:
    points = (
        db.scalar(
            select(func.coalesce(func.sum(Milestone.points), 0))
            .join(Proposal)
            .where(Proposal.team_id == team.id)
        )
        or 0
    )
    count = (
        db.scalar(
            select(func.count())
            .select_from(TeamMembership)
            .where(TeamMembership.team_id == team.id)
        )
        or 0
    )
    return TeamPublicView(
        id=team.id,
        owner_id=team.owner_id,
        name=team.name,
        interests=team.interests,
        skills=team.skills,
        technologies=team.technologies,
        points=points,
        member_count=count,
        ready=3 <= count <= 5,
    )


def team_view(
    db: Session,
    team: Team,
    actor: Actor | None = None,
    invite_code: str | None = None,
) -> TeamView:
    rows = db.execute(
        select(Actor, StudentProfile)
        .select_from(TeamMembership)
        .join(Actor, Actor.id == TeamMembership.actor_id)
        .outerjoin(StudentProfile, StudentProfile.actor_id == Actor.id)
        .where(TeamMembership.team_id == team.id)
        .order_by(TeamMembership.slot)
    ).all()
    return TeamView(
        **public_team_view(db, team).model_dump(),
        members=[
            TeamMemberView(
                actor_id=member.id,
                name=member.name,
                username=profile.username if profile else None,
                positions=profile.positions if profile else [],
                skills=profile.skills if profile else [],
                is_leader=member.id == team.owner_id,
            )
            for member, profile in rows
        ],
        is_leader=actor is not None and actor.id == team.owner_id,
        invite_code=invite_code if actor is not None and actor.id == team.owner_id else None,
    )


def create_team(db: Session, actor: Actor, payload: TeamInput) -> tuple[Team, str]:
    require_student_profile(db, actor)
    if db.get(TeamMembership, actor.id):
        raise DomainError(409, "TEAM_ALREADY_JOINED", "Вы уже состоите в команде.")
    team = Team(owner_id=actor.id, **payload.model_dump())
    code, digest = _new_invite()
    try:
        db.add(team)
        db.flush()
        db.add(TeamMembership(actor_id=actor.id, team_id=team.id, slot=1))
        db.add(TeamInvite(team_id=team.id, code_hash=digest))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise DomainError(409, "TEAM_ALREADY_JOINED", "Вы уже состоите в команде.") from exc
    return team, code


def join_team(db: Session, actor: Actor, name: str, invite_code: str) -> Team:
    require_student_profile(db, actor)
    if db.get(TeamMembership, actor.id):
        raise DomainError(409, "TEAM_ALREADY_JOINED", "Вы уже состоите в команде.")
    team = db.scalar(
        select(Team).join(TeamInvite).where(TeamInvite.code_hash == invite_digest(invite_code))
    )
    if team is None or team.name.strip().casefold() != name.strip().casefold():
        raise DomainError(
            404, "TEAM_INVITE_INVALID", "Проверьте название команды и код приглашения."
        )
    lock_team(db, team)
    # Renaming or rotation may have committed while waiting for the team lock.
    db.refresh(team)
    invite = db.get(TeamInvite, team.id, populate_existing=True)
    if (
        team.name.strip().casefold() != name.strip().casefold()
        or invite is None
        or invite.code_hash != invite_digest(invite_code)
    ):
        raise DomainError(
            404, "TEAM_INVITE_INVALID", "Проверьте название команды и код приглашения."
        )
    slots = set(db.scalars(select(TeamMembership.slot).where(TeamMembership.team_id == team.id)))
    free = next((slot for slot in range(1, 6) if slot not in slots), None)
    if free is None:
        raise DomainError(409, "TEAM_FULL", "В команде уже 5 участников.")
    try:
        db.add(TeamMembership(actor_id=actor.id, team_id=team.id, slot=free))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise DomainError(409, "TEAM_ALREADY_JOINED", "Вы уже состоите в команде.") from exc
    return team


def update_team(db: Session, actor: Actor, payload: TeamInput) -> Team:
    team = current_team(db, actor)
    require_team_leader(team, actor)
    lock_team(db, team)
    for key, value in payload.model_dump().items():
        setattr(team, key, value)
    db.commit()
    return team


def rotate_invite(db: Session, actor: Actor) -> str:
    team = current_team(db, actor)
    require_team_leader(team, actor)
    lock_team(db, team)
    code, digest = _new_invite()
    invite = db.get(TeamInvite, team.id)
    if invite is None:
        db.add(TeamInvite(team_id=team.id, code_hash=digest))
    else:
        invite.code_hash = digest
    db.commit()
    return code


def leave_team(db: Session, actor: Actor) -> None:
    team = current_team(db, actor)
    lock_team(db, team)
    if team.owner_id == actor.id:
        has_proposals = db.scalar(select(Proposal.id).where(Proposal.team_id == team.id).limit(1))
        if len(member_ids(db, team)) > 1 or has_proposals:
            raise DomainError(
                409,
                "TEAM_LEADER_CANNOT_LEAVE",
                "Капитан может удалить только пустую команду без откликов и других участников.",
            )
        db.execute(delete(TeamInvite).where(TeamInvite.team_id == team.id))
        db.execute(delete(TeamMembership).where(TeamMembership.team_id == team.id))
        db.delete(team)
    else:
        db.execute(
            delete(TeamMembership).where(
                TeamMembership.actor_id == actor.id,
                TeamMembership.team_id == team.id,
            )
        )
    db.commit()


def backfill_team_memberships(db: Session) -> None:
    """Preserve old teams and attribute legacy proposals to their known creator only."""
    for team in db.scalars(select(Team).order_by(Team.id)):
        lock_team(db, team)
        if db.get(TeamMembership, team.owner_id) is None:
            db.add(TeamMembership(actor_id=team.owner_id, team_id=team.id, slot=1))
        if db.get(TeamInvite, team.id) is None:
            _, digest = _new_invite()
            db.add(TeamInvite(team_id=team.id, code_hash=digest))
    db.flush()
    legacy = db.execute(
        select(Proposal.id, Team.owner_id)
        .join(Team)
        .where(~Proposal.id.in_(select(ProposalParticipant.proposal_id)))
    ).all()
    for proposal_id, owner_id in legacy:
        db.add(ProposalParticipant(proposal_id=proposal_id, actor_id=owner_id))
    db.commit()
