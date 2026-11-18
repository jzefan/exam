"""Anonymous course previews and authenticated teacher workspace entry."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import CurrentUser, user_has_role
from app.auth.service import build_user_response
from app.database import get_db
from app.job_models.models import LearningResource
from app.learning.models import Direction, KnowledgePoint, Major
from app.papers.models import Paper
from app.papers.router import build_paper_detail_response
from app.papers.service import paper_base_query
from app.questions.models import Question
from app.questions.schemas import QuestionResponse
from app.teacher_courses.access import course_nodes, course_question_filter
from app.teacher_courses.models import CourseShareLink, CourseUserWorkspace
from app.teacher_courses.schemas import (
    CourseShareEnterRequest,
    CourseShareEnterResponse,
    CourseSharePublicPreviewResponse,
)

router = APIRouter(prefix="/public/course-share", tags=["public-course-share"])
DB = Annotated[AsyncSession, Depends(get_db)]


async def get_published_course(db: AsyncSession, share_code: str) -> KnowledgePoint:
    course = await db.scalar(
        select(KnowledgePoint)
        .join(
            CourseShareLink,
            CourseShareLink.course_id == KnowledgePoint.id,
        )
        .where(
            CourseShareLink.share_code == share_code,
            CourseShareLink.is_active.is_(True),
            CourseShareLink.deleted_at.is_(None),
            KnowledgePoint.deleted_at.is_(None),
            KnowledgePoint.parent_id.is_(None),
        )
    )
    if course is None:
        raise HTTPException(404, "课程链接不存在或已停用")
    return course


def _public_material_filters(course: KnowledgePoint):
    nodes = course_nodes(course_id=course.id)
    return (
        LearningResource.node_type == "kp",
        LearningResource.node_id.in_(select(nodes.c.id)),
        LearningResource.deleted_at.is_(None),
        (LearningResource.uploaded_by == course.owner_id) | LearningResource.uploaded_by.is_(None),
    )


def _public_paper_filters(course: KnowledgePoint):
    return (
        Paper.deleted_at.is_(None),
        Paper.root_knowledge_point_id == course.id,
        Paper.owner_id == course.owner_id,
        Paper.is_reusable.is_(True),
    )


async def _count(db: AsyncSession, model, *filters) -> int:
    return int(await db.scalar(select(func.count()).select_from(model).where(*filters)) or 0)


async def public_materials(db: AsyncSession, course: KnowledgePoint):
    return list(
        (
            await db.scalars(
                select(LearningResource)
                .where(*_public_material_filters(course))
                .order_by(LearningResource.sort_order, LearningResource.created_at)
            )
        ).all()
    )


async def public_questions(db: AsyncSession, course: KnowledgePoint):
    return list(
        (
            await db.scalars(
                select(Question)
                .where(course_question_filter(course.id, course.owner_id, None))
                .options(
                    selectinload(Question.creator),
                    selectinload(Question.question_bank),
                    selectinload(Question.tags),
                    selectinload(Question.knowledge_points),
                )
                .order_by(Question.updated_at.desc())
            )
        )
        .unique()
        .all()
    )


async def public_papers(db: AsyncSession, course: KnowledgePoint):
    return list(
        (
            await db.scalars(
                paper_base_query()
                .where(*_public_paper_filters(course))
                .order_by(Paper.created_at.desc())
            )
        )
        .unique()
        .all()
    )


@router.get("/{share_code}", response_model=CourseSharePublicPreviewResponse)
async def get_course_share_public_preview(share_code: str, db: DB):
    course = await get_published_course(db, share_code)
    major_name = await db.scalar(select(Major.name).join(Direction).where(Direction.id == course.direction_id))
    nodes = course_nodes(course_id=course.id)
    knowledge_point_total = int(await db.scalar(select(func.count()).select_from(nodes)) or 0)
    return CourseSharePublicPreviewResponse(
        course_id=course.id,
        share_code=share_code,
        course_name=course.name,
        description=course.description,
        major_name=major_name,
        stats={
            "knowledge_point_count": max(0, knowledge_point_total - 1),
            "material_count": await _count(db, LearningResource, *_public_material_filters(course)),
            "question_count": await _count(db, Question, course_question_filter(course.id, course.owner_id, None)),
            "paper_count": await _count(db, Paper, *_public_paper_filters(course)),
        },
    )


@router.get("/{share_code}/content")
async def get_course_share_content(share_code: str, db: DB):
    course = await get_published_course(db, share_code)
    nodes = course_nodes(course_id=course.id)
    knowledge = list(
        await db.scalars(
            select(KnowledgePoint)
            .where(
                KnowledgePoint.id.in_(select(nodes.c.id)),
            )
            .order_by(KnowledgePoint.sort_order, KnowledgePoint.created_at)
        )
    )
    names = {kp.id: kp.name for kp in knowledge}
    return {
        "knowledge_points": [
            {"id": kp.id, "name": kp.name, "parent_id": kp.parent_id, "description": kp.description} for kp in knowledge
        ],
        "materials": [
            {
                "id": r.id,
                "node_id": r.node_id,
                "node_name": names.get(r.node_id, ""),
                "title": r.title,
                "resource_type": r.resource_type,
                "url": r.url,
                "description": r.description,
                "source": r.source,
                "file_path": None,
            }
            for r in await public_materials(db, course)
        ],
        "questions": [QuestionResponse.from_question(q) for q in await public_questions(db, course)],
        "papers": [build_paper_detail_response(p) for p in await public_papers(db, course)],
    }


@router.post("/{share_code}/enter", response_model=CourseShareEnterResponse)
async def enter_course_share(share_code: str, payload: CourseShareEnterRequest, db: DB, user: CurrentUser):
    """Join with an existing teacher identity. Never mint users or login tokens."""
    course = await get_published_course(db, share_code)
    if not await user_has_role(db, user.id, "teacher", "platform_admin"):
        raise HTTPException(403, "请使用教师账号进入课程")
    ws = await db.scalar(
        select(CourseUserWorkspace).where(
            CourseUserWorkspace.course_id == course.id,
            CourseUserWorkspace.user_id == user.id,
        )
    )
    if ws is None:
        ws = CourseUserWorkspace(course_id=course.id, user_id=user.id, alias_name=user.full_name)
        db.add(ws)
    elif ws.deleted_at is not None:
        ws.deleted_at = None
    await db.commit()
    return CourseShareEnterResponse(
        course_id=course.id,
        course_name=course.name,
        alias_name=user.full_name,
        user=(await build_user_response(db, user)).model_dump(mode="json"),
    )
