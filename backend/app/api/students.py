from fastapi import APIRouter, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import DB, Student
from app.errors import DomainError
from app.student_profiles import (
    StudentProfile,
    StudentProfileInput,
    StudentProfileView,
    student_profile,
)

router = APIRouter(tags=["Student profiles"])


@router.get("/students/profile", response_model=StudentProfileView)
def get_profile(db: DB, actor: Student, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return student_profile(db, actor)


@router.put("/students/profile", response_model=StudentProfileView)
def save_profile(payload: StudentProfileInput, db: DB, actor: Student, response: Response):
    occupied = db.scalar(
        select(StudentProfile.actor_id).where(
            StudentProfile.username == payload.username, StudentProfile.actor_id != actor.id
        )
    )
    if occupied:
        raise DomainError(409, "USERNAME_TAKEN", "Этот ID уже занят. Придумайте другой.")
    profile = db.get(StudentProfile, actor.id)
    if profile is None:
        profile = StudentProfile(actor_id=actor.id)
        db.add(profile)
    for field, value in payload.model_dump().items():
        setattr(profile, field, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise DomainError(409, "USERNAME_TAKEN", "Этот ID уже занят. Придумайте другой.") from exc
    response.headers["Cache-Control"] = "no-store"
    return profile
