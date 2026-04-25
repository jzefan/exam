from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.auth.user_settings import router as user_settings_router
from app.auth.users_router import router as users_router
from app.config import settings
from app.exams.positions_router import router as positions_router
from app.exams.invitation_router import public_router as invitation_public_router
from app.exams.invitation_router import router as invitation_router
from app.exams.router import router as exams_router
from app.exams.student_router import router as student_exams_router
from app.exams.student_router import wrong_answers_router
from app.grading.router import router as grading_router
from app.learning.router import router as knowledge_router
from app.questions.ai_generate import ai_generate_router
from app.questions.router import knowledge_points_router, question_banks_router, questions_router, tags_router
from app.job_models.router import model_router as job_model_router
from app.job_models.router import template_router as job_template_router
from app.rbac.router import org_router, permission_router, role_router
from app.rbac.students_router import router as students_router
from app.analytics.router import router as analytics_router
from app.ai_pipeline.router import router as ai_pipeline_router
from app.uploads.router import router as uploads_router
from app.notifications.router import router as notifications_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Seed RBAC and AI pipeline data on startup."""
    from app.ai_pipeline.models import seed_prompt_templates
    from app.database import async_session, engine
    from app.grading.seed import seed_grading_defaults
    from app.notifications.models import Notification  # noqa: F401
    from app.rbac.service import assign_unowned_students_to_single_teacher
    from app.rbac.seed import seed_permissions, seed_roles

    # Ensure new tables exist (e.g. user_settings)
    from app.auth.user_settings import UserSettings  # noqa: F401
    from app.exams.invitation_models import ExamInvitation  # noqa: F401
    from app.models import Base
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as db:
        await seed_permissions(db)
        await seed_roles(db)
        await seed_grading_defaults(db)
        await seed_prompt_templates(db)
        await assign_unowned_students_to_single_teacher(db)
        await db.commit()

    yield


app = FastAPI(title="AI Exam Grading System", version="0.1.0", lifespan=lifespan)

from app.database import engine as _engine  # noqa: E402
from app.observability import install as install_observability  # noqa: E402

install_observability(app, _engine)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-No-Bank-Count", "X-Response-Time-Ms"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(user_settings_router, prefix="/api/auth", tags=["user-settings"])
app.include_router(users_router, prefix="/api/users", tags=["users"])
app.include_router(questions_router, prefix="/api/questions", tags=["questions"])
app.include_router(tags_router, prefix="/api/tags", tags=["tags"])
app.include_router(knowledge_points_router, prefix="/api/knowledge-points", tags=["knowledge-points"])
app.include_router(question_banks_router, prefix="/api/question-banks", tags=["question-banks"])
app.include_router(exams_router, prefix="/api/exams", tags=["exams"])
app.include_router(invitation_router, prefix="/api", tags=["invitations"])
app.include_router(invitation_public_router, prefix="/api", tags=["invitations-public"])
app.include_router(student_exams_router, prefix="/api/student", tags=["student-exams"])
app.include_router(wrong_answers_router, prefix="/api/wrong-answers", tags=["wrong-answers"])
app.include_router(positions_router, prefix="/api/positions", tags=["positions"])
app.include_router(uploads_router, prefix="/api/uploads", tags=["uploads"])
app.include_router(knowledge_router, prefix="/api/knowledge", tags=["knowledge"])
app.include_router(org_router, prefix="/api/organizations", tags=["organizations"])
app.include_router(role_router, prefix="/api/roles", tags=["roles"])
app.include_router(permission_router, prefix="/api/permissions", tags=["permissions"])
app.include_router(students_router, prefix="/api/rbac/students", tags=["students"])
app.include_router(grading_router, prefix="/api/grading", tags=["grading"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["analytics"])
app.include_router(job_model_router, prefix="/api/job-models/models", tags=["job-models"])
app.include_router(job_template_router, prefix="/api/job-models/templates", tags=["job-model-templates"])
app.include_router(ai_pipeline_router, prefix="/api/ai-pipeline", tags=["ai-pipeline"])
app.include_router(ai_generate_router, prefix="/api/questions/ai-generate", tags=["ai-generate"])
app.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"])


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
