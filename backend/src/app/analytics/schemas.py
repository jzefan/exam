from pydantic import BaseModel

class DashboardStats(BaseModel):
    total_candidates: int = 0
    pending_grading: int = 0
    total_students: int = 0
    # Platform admin metrics
    total_exams: int = 0
    total_questions: int = 0
    total_users: int = 0
    total_jobs: int = 0
