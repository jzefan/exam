from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.auth.router import router as auth_router
from app.auth.oidc_router import oidc_router
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
from app.job_models.agent_router import router as agent_job_model_router
from app.job_models.graph_router import router as graph_job_model_router
from app.rbac.router import org_router, permission_router, role_router
from app.rbac.students_router import router as students_router
from app.analytics.router import router as analytics_router
from app.ai_pipeline.router import router as ai_pipeline_router
from app.uploads.router import router as uploads_router
from app.notifications.router import router as notifications_router
from app.operations.router import router as operations_router
from app.papers.router import router as papers_router
from app.teacher_courses.router import router as teacher_courses_router
from app.question_gen_templates.router import course_templates_router, template_router
from app.knowledge_extract.router import router as knowledge_extract_router
from app.course_kb.router import router as course_kb_router
from app.activity_logs.middleware import ActivityContextMiddleware
from app.activity_logs.router import router as activity_logs_router
from app.chaoxing.browser import manager as chaoxing_manager
from app.chaoxing.router import router as chaoxing_router
from app.chaoxing.grading_router import router as chaoxing_grading_router
from app.chaoxing.worker import run as run_chaoxing_grading


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Seed RBAC and AI pipeline data on startup."""
    import asyncio
    import logging

    from app.ai_pipeline.models import seed_prompt_templates
    from app.database import async_session, engine, warm_pool
    from app.exams.student_router import _run_subjective_grading_tasks
    from app.grading.seed import seed_grading_defaults
    from app.grading.service import recover_pending_exam_submission_tasks
    from app.notifications.models import Notification  # noqa: F401
    from app.activity_logs.models import ActivityLog  # noqa: F401
    from app.rbac.service import assign_unowned_students_to_single_teacher
    from app.rbac.seed import seed_permissions, seed_roles

    # Ensure new tables exist (e.g. user_settings)
    from app.auth.user_settings import UserSettings  # noqa: F401
    from app.chaoxing.credentials import ChaoxingCredential  # noqa: F401
    from app.exams.invitation_models import ExamInvitation, ExamPublicLink  # noqa: F401
    from app.papers.models import Paper, PaperImportSession, PaperQuestion  # noqa: F401
    from app.teacher_courses.models import CourseSemester, ExamSemesterAssignment  # noqa: F401
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

    # Recover grading tasks that were interrupted by a previous restart.
    # Pending tasks left over from before we crashed will sit forever unless
    # something kicks them — so we re-enqueue them on startup. The fire-and-
    # forget asyncio.create_task() runs them in the background without blocking
    # the rest of lifespan or request serving.
    async with async_session() as db:
        stuck_task_ids = await recover_pending_exam_submission_tasks(db)
        await db.commit()
    if stuck_task_ids:
        logging.getLogger(__name__).info(
            "recovering %d interrupted grading task(s) on startup", len(stuck_task_ids)
        )
        asyncio.create_task(_run_subjective_grading_tasks(stuck_task_ids))

    # Prime the connection pool so the first page-load doesn't pay per-connect
    # latency on a cold pool (the dominant cause of multi-second request stalls).
    await warm_pool()

    await chaoxing_manager.start()
    chaoxing_worker = asyncio.create_task(run_chaoxing_grading()) if settings.chaoxing_enabled else None
    try:
        yield
    finally:
        if chaoxing_worker:
            chaoxing_worker.cancel()
            await asyncio.gather(chaoxing_worker, return_exceptions=True)
        await chaoxing_manager.shutdown()


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
app.add_middleware(ActivityContextMiddleware)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(oidc_router, prefix="/api/auth", tags=["auth-oidc"])
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
app.include_router(chaoxing_router, prefix="/api/chaoxing", tags=["chaoxing"])
app.include_router(chaoxing_grading_router, prefix="/api/chaoxing", tags=["chaoxing-grading"])
app.include_router(analytics_router, prefix="/api/analytics", tags=["analytics"])
app.include_router(job_model_router, prefix="/api/job-models/models", tags=["job-models"])
app.include_router(job_template_router, prefix="/api/job-models/templates", tags=["job-model-templates"])
app.include_router(agent_job_model_router, prefix="/api/agent/job-models", tags=["agent-job-models"])
app.include_router(graph_job_model_router, prefix="/api/job-models/graph", tags=["job-model-graph"])
app.include_router(ai_pipeline_router, prefix="/api/ai-pipeline", tags=["ai-pipeline"])
app.include_router(ai_generate_router, prefix="/api/questions/ai-generate", tags=["ai-generate"])
app.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"])
app.include_router(papers_router, prefix="/api/papers", tags=["papers"])
app.include_router(teacher_courses_router, prefix="/api/teacher/courses", tags=["teacher-courses"])
app.include_router(course_templates_router)
app.include_router(template_router)
app.include_router(knowledge_extract_router)
app.include_router(course_kb_router)
app.include_router(operations_router, prefix="/api/operations", tags=["operations"])
app.include_router(activity_logs_router, prefix="/api/operations/activity-logs", tags=["activity-logs"])


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError) -> JSONResponse:
    """Turn database constraint violations into a readable message.

    Without this, any endpoint that forgets to catch the error hands the client
    the raw SQLAlchemy/psycopg text — including the failing SQL and its
    parameters. The detail stays in the server log; the client gets a sentence.
    """
    logger = logging.getLogger(__name__)
    logger.warning(
        "IntegrityError on %s %s: %s", request.method, request.url.path, exc
    )
    return JSONResponse(
        status_code=409,
        content={"detail": "该操作与已有数据冲突（手机号/账号等信息可能已被占用），请检查后重试"},
    )


@app.exception_handler(SQLAlchemyError)
async def sqlalchemy_error_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    logger = logging.getLogger(__name__)
    logger.exception("Database error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "系统繁忙，请稍后重试"},
    )
