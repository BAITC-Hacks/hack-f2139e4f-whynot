from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError
from starlette.exceptions import HTTPException

from app.ai import Assistant
from app.api import audio, auth, chat, history, proposals, students, tasks, teams
from app.auth import AuthRateLimiter, check_request_origin
from app.config import Settings
from app.db import Base, make_engine, make_session_factory
from app.errors import DomainError
from app.schemas import ErrorResponse
from app.seed import seed_actors
from app.teams import backfill_team_memberships


def error_response(status: int, code: str, message: str):
    return JSONResponse(status_code=status, content={"error": {"code": code, "message": message}})


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        Base.metadata.create_all(engine)
        if settings.demo_mode:
            with session_factory() as db:
                seed_actors(db)
        with session_factory() as db:
            backfill_team_memberships(db)
        yield
        engine.dispose()

    app = FastAPI(
        title="AI Sana Backend",
        version="0.1.0",
        lifespan=lifespan,
        description=("Task readiness, open catalog, business/student accounts and team selection."),
        responses={code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 503)},
    )
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.engine = engine
    app.state.assistant = Assistant(settings)
    app.state.auth_rate_limiter = AuthRateLimiter()

    @app.middleware("http")
    async def protect_cookie_requests(request: Request, call_next):
        try:
            check_request_origin(request)
            if request.url.path == "/api/v1/ai/transcribe":
                length = request.headers.get("content-length", "0")
                if not length.isdigit() or int(length) > audio.MAX_AUDIO_BYTES + 65536:
                    return error_response(413, "AUDIO_TOO_LARGE", "Размер аудио не более 10 МБ.")
        except DomainError as exc:
            return error_response(exc.status, exc.code, exc.message)
        response = await call_next(request)
        if request.url.path.startswith("/api/v1/auth/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
        return response

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Content-Type", "X-Actor-ID"],
        allow_credentials=True,
    )

    @app.exception_handler(DomainError)
    async def handle_domain(_request: Request, exc: DomainError):
        return error_response(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation(_request: Request, exc: RequestValidationError):
        messages = [f"{'.'.join(map(str, item['loc']))}: {item['msg']}" for item in exc.errors()]
        return error_response(422, "VALIDATION_ERROR", "; ".join(messages))

    @app.exception_handler(HTTPException)
    async def handle_http(_request: Request, exc: HTTPException):
        return error_response(exc.status_code, "HTTP_ERROR", str(exc.detail))

    @app.exception_handler(IntegrityError)
    async def handle_integrity(_request: Request, _exc: IntegrityError):
        return error_response(
            409, "CONFLICT", "Запись уже существует или связанный объект изменился."
        )

    @app.exception_handler(StaleDataError)
    async def handle_stale(_request: Request, _exc: StaleDataError):
        return error_response(409, "STALE_REVISION", "Данные изменились. Обновите страницу.")

    @app.get("/health", tags=["System"])
    def health():
        with session_factory() as db:
            db.execute(text("SELECT 1"))
        return {
            "status": "ok",
            "ai_provider": settings.ai_provider,
            "demo_mode": settings.demo_mode,
        }

    for router in (
        auth.router,
        tasks.router,
        teams.router,
        students.router,
        chat.router,
        proposals.router,
        history.router,
        audio.router,
    ):
        app.include_router(router, prefix="/api/v1")
    return app


app = create_app()
