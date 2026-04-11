from typing import Annotated
import uuid
from fastapi import APIRouter, Depends
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.database import get_db
from app.rbac.models import UserOrganization, Role
from app.rbac.service import get_user_primary_org
from app.grading.models import GradingTask
from app.auth.models import User
from app.exams.models import Exam
from app.questions.models import Question
from app.job_models.models import JobModel
from app.analytics.schemas import DashboardStats

router = APIRouter(tags=["analytics"])

@router.get("/dashboard-stats", response_model=DashboardStats)
async def get_dashboard_stats(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser
):
    primary = await get_user_primary_org(db, user.id)
    org_id = primary.org_id if primary else None

    stats = DashboardStats()

    # Determine role name
    role_name: str | None = None
    if primary and primary.role_id:
        role_res = await db.execute(select(Role.name).where(Role.id == primary.role_id))
        role_name = role_res.scalar_one_or_none()

    # Platform admin: aggregate global counts
    if role_name == "platform_admin":
        try:
            stats.total_exams = (await db.execute(select(func.count(Exam.id)))).scalar_one() or 0
            stats.total_questions = (await db.execute(select(func.count(Question.id)))).scalar_one() or 0
            stats.total_users = (await db.execute(
                select(func.count(User.id)).where(User.deleted_at.is_(None))
            )).scalar_one() or 0
            stats.total_jobs = (await db.execute(select(func.count(JobModel.id)))).scalar_one() or 0
        except Exception as e:
            print(f"ERROR in admin dashboard stats: {str(e)}")
        return stats

    if not org_id:
        return stats

    try:
        # 1. 统计当前老师创建的考试相关的考生和任务
        exam_ids_res = await db.execute(select(Exam.id).where(Exam.created_by == user.id))
        exam_ids = [str(eid) for eid in exam_ids_res.scalars().all()]
        
        if exam_ids:
            task_filters = or_(*[GradingTask.source_business_id.like(f"{eid}:%") for eid in exam_ids])
            
            # 考生人次总数
            cand_res = await db.execute(select(func.count(GradingTask.id)).where(task_filters))
            stats.total_candidates = cand_res.scalar_one()

            # 待阅卷任务数
            pending_res = await db.execute(select(func.count(GradingTask.id)).where(
                task_filters,
                GradingTask.status.in_(["pending", "reviewing", "arbitration_required"])
            ))
            stats.pending_grading = pending_res.scalar_one()

        # 2. 统计本机构下的学生总数
        # 简化查询：直接从 UserOrganization 统计，确保只要关联了 student 角色就计入
        student_count_query = (
            select(func.count(UserOrganization.user_id.distinct()))
            .join(Role, Role.id == UserOrganization.role_id)
            .join(User, User.id == UserOrganization.user_id)
            .where(
                UserOrganization.org_id == org_id,
                Role.name == "student",
                User.deleted_at.is_(None)
            )
        )
        student_res = await db.execute(student_count_query)
        stats.total_students = student_res.scalar_one() or 0
        
    except Exception as e:
        print(f"ERROR in get_dashboard_stats: {str(e)}")
        
    return stats
