from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.auth.users_router import router as users_router
from app.config import settings
from app.exams.positions_router import router as positions_router
from app.exams.router import router as exams_router
from app.learning.router import router as knowledge_router
from app.questions.router import knowledge_points_router, question_banks_router, questions_router, tags_router
from app.rbac.router import org_router, permission_router, role_router
from app.uploads.router import router as uploads_router

app = FastAPI(title="AI Exam Grading System", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count", "X-No-Bank-Count"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(users_router, prefix="/api/users", tags=["users"])
app.include_router(questions_router, prefix="/api/questions", tags=["questions"])
app.include_router(tags_router, prefix="/api/tags", tags=["tags"])
app.include_router(knowledge_points_router, prefix="/api/knowledge-points", tags=["knowledge-points"])
app.include_router(question_banks_router, prefix="/api/question-banks", tags=["question-banks"])
app.include_router(exams_router, prefix="/api/exams", tags=["exams"])
app.include_router(positions_router, prefix="/api/positions", tags=["positions"])
app.include_router(uploads_router, prefix="/api/uploads", tags=["uploads"])
app.include_router(knowledge_router, prefix="/api/knowledge", tags=["knowledge"])
app.include_router(org_router, prefix="/api/organizations", tags=["organizations"])
app.include_router(role_router, prefix="/api/roles", tags=["roles"])
app.include_router(permission_router, prefix="/api/permissions", tags=["permissions"])


@app.get("/api/health")
async def health_check() -> dict[str, str]:
    return {"status": "ok"}
