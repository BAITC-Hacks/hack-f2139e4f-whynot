from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from threading import Barrier
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select
from test_workflow import create_task, ensure_ready_team, publish

from app.account_models import Account
from app.db import Base, make_engine, make_session_factory
from app.errors import DomainError
from app.models import Actor, Proposal, Task, Team
from app.schemas import TeamInput
from app.seed import seed_actors
from app.student_profiles import StudentProfile
from app.team_models import ProposalParticipant, TeamInvite, TeamMembership
from app.teams import backfill_team_memberships, create_team, invite_digest, join_team


def headers(actor_id="student-1"):
    return {"X-Actor-ID": actor_id}


def make_team(client, actor_id="student-1", name="Sana friends"):
    response = client.post("/api/v1/teams", headers=headers(actor_id), json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def join(client, team, actor_id):
    return client.post(
        "/api/v1/teams/join",
        headers=headers(actor_id),
        json={
            "name": team["name"],
            "invite_code": team["invite_code"],
        },
    )


def proposal(client, task, actor_id="student-1"):
    return client.post(
        f"/api/v1/tasks/{task['id']}/proposals",
        headers=headers(actor_id),
        json={
            "idea": "Create a prototype",
            "plan": "Build and test",
            "timeline": "2 weeks",
        },
    )


def test_team_creation_and_privacy_and_one_team_per_student(client, app):
    assert client.get("/api/v1/teams/me", headers=headers()).status_code == 409
    assert (
        client.put("/api/v1/teams/me", headers=headers(), json={"name": "No team"}).status_code
        == 409
    )
    assert client.post("/api/v1/teams", json={"name": "Anonymous"}).status_code == 401
    assert (
        client.post(
            "/api/v1/teams", headers=headers("business-1"), json={"name": "Business"}
        ).status_code
        == 403
    )
    team = make_team(client)
    assert team["member_count"] == 1 and not team["ready"] and team["is_leader"]
    assert team["members"][0]["actor_id"] == "student-1"
    assert team["members"][0]["is_leader"]
    assert "invite_code" not in client.get("/api/v1/teams/me", headers=headers()).json()
    public = client.get("/api/v1/teams").json()[0]
    assert "members" not in public and "invite_code" not in public and "phone" not in public
    with app.state.session_factory() as db:
        invite = db.get(TeamInvite, team["id"])
        assert invite.code_hash == invite_digest(team["invite_code"])
        assert invite.code_hash != team["invite_code"]
    assert (
        client.post("/api/v1/teams", headers=headers(), json={"name": "Second team"}).status_code
        == 409
    )


def test_join_trimmed_case_insensitive_names_and_codes_and_private_roster(client, app):
    with app.state.session_factory() as db:
        db.add(
            StudentProfile(
                actor_id="student-2",
                username="designer",
                phone="+77000000002",
                positions=["Designer"],
                skills=["Figma"],
            )
        )
        db.commit()
    team = make_team(client, name="My Team")
    response = client.post(
        "/api/v1/teams/join",
        headers=headers("student-2"),
        json={
            "name": "  my TEAM  ",
            "invite_code": "  " + team["invite_code"].lower() + "  ",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["member_count"] == 2 and not response.json()["is_leader"]
    member = response.json()["members"][1]
    assert member["username"] == "designer" and member["positions"] == ["Designer"]
    assert member["skills"] == ["Figma"]
    assert "phone" not in response.text and "+77000000002" not in response.text
    assert "invite_code" not in response.json()
    assert join(client, team, "student-2").status_code == 409
    assert (
        client.post(
            "/api/v1/teams", headers=headers("student-2"), json={"name": "Other"}
        ).status_code
        == 409
    )


def test_only_leader_updates_invites_rotation_revokes_old_code(client):
    team = make_team(client)
    assert join(client, team, "student-2").status_code == 200
    assert (
        client.put(
            "/api/v1/teams/me", headers=headers("student-2"), json={"name": "Take over"}
        ).status_code
        == 403
    )
    assert client.post("/api/v1/teams/me/invite", headers=headers("student-2")).status_code == 403
    rotated = client.post("/api/v1/teams/me/invite", headers=headers())
    assert rotated.status_code == 200
    assert rotated.json()["invite_code"] != team["invite_code"]
    assert join(client, team, "student-3").status_code == 404
    team["invite_code"] = rotated.json()["invite_code"]
    assert join(client, team, "student-3").status_code == 200
    renamed = client.put("/api/v1/teams/me", headers=headers(), json={"name": "Renamed"})
    assert renamed.status_code == 200
    assert client.get("/api/v1/teams/me", headers=headers("student-3")).json()["name"] == "Renamed"


def test_proposals_need_three_members_and_leader_and_max_five(client, business):
    task = publish(client, create_task(client, business), business)
    team = make_team(client)
    assert proposal(client, task).json()["error"]["code"] == "TEAM_NOT_READY"
    assert join(client, team, "student-2").status_code == 200
    assert proposal(client, task).status_code == 409
    assert join(client, team, "student-3").status_code == 200
    assert proposal(client, task, "student-2").status_code == 403
    assert proposal(client, task).status_code == 201
    for member in ("student-4", "student-5"):
        assert join(client, team, member).status_code == 200
    full = join(client, team, "student-1-member-2")
    assert full.status_code == 409 and full.json()["error"]["code"] == "TEAM_FULL"
    mine = client.get("/api/v1/teams/me", headers=headers()).json()
    assert mine["member_count"] == 5 and mine["ready"]


def test_participant_history_survives_leaving_and_new_joiner_does_not_inherit(client, business):
    task = publish(client, create_task(client, business), business)
    ensure_ready_team(client)
    created = proposal(client, task).json()
    client.post(
        f"/api/v1/proposals/{created['id']}/decision",
        headers=business,
        json={"decision": "accepted"},
    )
    result = client.post(
        f"/api/v1/proposals/{created['id']}/milestones",
        headers=business,
        json={
            "code": "prototype",
            "evidence": "Checked prototype",
        },
    )
    assert result.status_code == 200
    participant = headers("student-1-member-2")
    history = client.get("/api/v1/students/history", headers=participant).json()
    assert history["total"] == 1 and history["items"][0]["milestones"][0]["points"] == 20
    assert client.post("/api/v1/teams/me/leave", headers=participant).status_code == 200
    assert client.get("/api/v1/students/history", headers=participant).json()["total"] == 1
    assert client.get("/api/v1/proposals/mine", headers=participant).status_code == 409
    code = client.post("/api/v1/teams/me/invite", headers=headers()).json()["invite_code"]
    assert (
        client.post(
            "/api/v1/teams/join",
            headers=headers("student-4"),
            json={
                "name": "Team student-1",
                "invite_code": code,
            },
        ).status_code
        == 200
    )
    assert client.get("/api/v1/students/history", headers=headers("student-4")).json()["total"] == 0
    current = client.get("/api/v1/proposals/mine", headers=headers("student-4")).json()
    assert [item["id"] for item in current] == [created["id"]]


def test_leader_can_disband_only_solo_team_without_proposals(client):
    team = make_team(client)
    assert client.post("/api/v1/teams/me/leave", headers=headers()).status_code == 200
    assert client.get("/api/v1/teams/me", headers=headers()).status_code == 409
    team = make_team(client)
    join(client, team, "student-2")
    assert client.post("/api/v1/teams/me/leave", headers=headers()).status_code == 409
    assert client.post("/api/v1/teams/me/leave", headers=headers("student-2")).status_code == 200
    assert client.post("/api/v1/teams/me/leave", headers=headers()).status_code == 200


def test_legacy_backfill_is_idempotent_and_does_not_reassign_history(app, client):
    with app.state.session_factory() as db:
        team = Team(id="legacy-team", owner_id="student-1", name="Legacy solo")
        task = Task(id="legacy-task", owner_id="business-1", raw_description="Task", card={})
        db.add_all([team, task])
        db.flush()
        db.add(
            Proposal(
                id="legacy-proposal",
                task_id=task.id,
                team_id=team.id,
                idea="Original",
                plan="Plan",
                timeline="2 weeks",
            )
        )
        db.commit()
        backfill_team_memberships(db)
        backfill_team_memberships(db)
        assert db.scalar(select(func.count()).select_from(TeamMembership)) == 1
        assert db.scalar(select(func.count()).select_from(TeamInvite)) == 1
        assert db.scalar(select(func.count()).select_from(ProposalParticipant)) == 1
        assert db.get(Proposal, "legacy-proposal").idea == "Original"
    assert client.get("/api/v1/teams/me", headers=headers()).json()["member_count"] == 1
    assert client.get("/api/v1/students/history", headers=headers()).json()["total"] == 1
    assert client.post("/api/v1/teams/me/leave", headers=headers()).status_code == 409


@pytest.fixture
def disk_factory(tmp_path):
    engine = make_engine(f"sqlite:///{(tmp_path / 'teams.db').as_posix()}")
    Base.metadata.create_all(engine)
    factory = make_session_factory(engine)
    with factory() as db:
        seed_actors(db)
    yield factory
    engine.dispose()


def race_joins(factory, entries):
    barrier = Barrier(len(entries))

    def attempt(entry):
        actor_id, name, code = entry
        with factory() as db:
            actor = db.get(Actor, actor_id)
            barrier.wait(timeout=5)
            try:
                return join_team(db, actor, name, code).id
            except DomainError as exc:
                return exc.code

    with ThreadPoolExecutor(max_workers=len(entries)) as executor:
        return list(executor.map(attempt, entries))


def test_concurrent_joins_never_exceed_five_members(disk_factory):
    with disk_factory() as db:
        team, code = create_team(db, db.get(Actor, "student-1"), TeamInput(name="Full soon"))
        for actor_id in ("student-2", "student-3", "student-4"):
            join_team(db, db.get(Actor, actor_id), team.name, code)
        team_id, name = team.id, team.name
    results = race_joins(
        disk_factory,
        [
            ("student-5", name, code),
            ("student-1-member-2", name, code),
        ],
    )
    assert sorted(results) == sorted([team_id, "TEAM_FULL"])
    with disk_factory() as db:
        assert db.scalar(select(func.count()).select_from(TeamMembership)) == 5


def test_same_student_cannot_join_two_teams_concurrently(disk_factory):
    with disk_factory() as db:
        first, first_code = create_team(db, db.get(Actor, "student-1"), TeamInput(name="First"))
        second, second_code = create_team(db, db.get(Actor, "student-2"), TeamInput(name="Second"))
        first_id, second_id = first.id, second.id
    results = race_joins(
        disk_factory,
        [
            ("student-3", "First", first_code),
            ("student-3", "Second", second_code),
        ],
    )
    assert results.count("TEAM_ALREADY_JOINED") == 1
    assert any(result in (first_id, second_id) for result in results)
    with disk_factory() as db:
        assert (
            db.scalar(
                select(func.count())
                .select_from(TeamMembership)
                .where(
                    TeamMembership.actor_id == "student-3",
                )
            )
            == 1
        )


def test_legacy_registered_student_needs_profile_before_create_or_join(client, app):
    target = make_team(client, "student-2")
    with app.state.session_factory() as db:
        actor = db.get(Actor, "student-1")
        db.add(Account(actor_id=actor.id, email="legacy@example.com", password_hash="legacy"))
        db.commit()
        with pytest.raises(DomainError) as create_error:
            create_team(db, actor, TeamInput(name="Cannot create yet"))
        assert create_error.value.code == "STUDENT_PROFILE_REQUIRED"
        with pytest.raises(DomainError) as join_error:
            join_team(db, actor, target["name"], target["invite_code"])
        assert join_error.value.code == "STUDENT_PROFILE_REQUIRED"
        assert db.get(StudentProfile, actor.id) is None
        assert db.get(TeamMembership, actor.id) is None


def test_join_rechecks_renamed_team_after_lock(client, app, monkeypatch):
    from app import teams

    team = make_team(client)
    original_lock = teams.lock_team

    def rename_before_lock(db, target):
        with app.state.session_factory() as other:
            stored = other.get(Team, target.id)
            stored.name = "Renamed while joining"
            other.commit()
        original_lock(db, target)

    monkeypatch.setattr(teams, "lock_team", rename_before_lock)
    response = join(client, team, "student-2")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "TEAM_INVITE_INVALID"
    with app.state.session_factory() as db:
        assert db.get(TeamMembership, "student-2") is None


def test_demo_script_creates_real_roster_before_submitting(client, monkeypatch, capsys):
    from scripts import demo

    monkeypatch.setattr(demo.sys, "argv", ["demo.py", "http://testserver"])
    monkeypatch.setattr(
        demo, "httpx", SimpleNamespace(Client=lambda **_kwargs: nullcontext(client))
    )
    demo.main()
    assert "milestone points=20" in capsys.readouterr().out
    team = client.get("/api/v1/teams/me", headers=headers()).json()
    assert team["member_count"] == 3 and team["ready"]
    assert client.get("/api/v1/students/history", headers=headers()).json()["total"] == 1
