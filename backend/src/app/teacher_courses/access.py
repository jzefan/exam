"""One read scope for course catalogues and teachers' private additions.

Publishing a course shares its author's base resources, never resources that
another teacher happens to attach to the same knowledge point.
"""

import uuid

from fastapi import HTTPException
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.data_visibility import VisibilityScope
from app.job_models.models import LearningResource
from app.learning.models import KnowledgePoint
from app.papers.models import Paper
from app.questions.models import Question, QuestionBank, question_knowledge_points
from app.teacher_courses.models import CourseShareLink, CourseUserWorkspace


def course_read_filter(user_id: uuid.UUID | None):
    published = exists().where(
        CourseShareLink.course_id == KnowledgePoint.id,
        CourseShareLink.is_active.is_(True),
        CourseShareLink.deleted_at.is_(None),
    )
    if user_id is None:
        return published
    return or_(
        published,
        KnowledgePoint.owner_id == user_id,
        KnowledgePoint.visibility == VisibilityScope.PLATFORM,
        exists().where(
            CourseUserWorkspace.course_id == KnowledgePoint.id,
            CourseUserWorkspace.user_id == user_id,
            CourseUserWorkspace.deleted_at.is_(None),
        ),
    )


def course_nodes(user_id: uuid.UUID | None = None, *, course_id: uuid.UUID | None = None):
    """Visible roots and descendants, carrying the root's ownership and name."""
    conditions = [KnowledgePoint.parent_id.is_(None), KnowledgePoint.deleted_at.is_(None)]
    if course_id is not None:
        conditions.append(KnowledgePoint.id == course_id)
    else:
        conditions.append(course_read_filter(user_id))
    tree = (
        select(
            KnowledgePoint.id,
            KnowledgePoint.id.label("course_id"),
            KnowledgePoint.owner_id.label("course_owner_id"),
            KnowledgePoint.name.label("course_name"),
        )
        .where(*conditions)
        .cte(recursive=True)
    )
    return tree.union_all(
        select(
            KnowledgePoint.id,
            tree.c.course_id,
            tree.c.course_owner_id,
            tree.c.course_name,
        ).where(KnowledgePoint.parent_id == tree.c.id, KnowledgePoint.deleted_at.is_(None))
    )


def knowledge_read_filter(user_id: uuid.UUID):
    nodes = course_nodes(user_id)
    return or_(
        KnowledgePoint.owner_id == user_id,
        KnowledgePoint.visibility == VisibilityScope.PLATFORM,
        KnowledgePoint.id.in_(select(nodes.c.id)),
    )


def question_in_course(nodes):
    linked = (
        exists()
        .where(
            question_knowledge_points.c.question_id == Question.id,
            question_knowledge_points.c.knowledge_point_id.in_(select(nodes.c.id)),
        )
        .correlate(Question)
    )
    # Keep legacy questions without knowledge-point links in the author's bank.
    bank = (
        exists()
        .where(
            QuestionBank.id == Question.question_bank_id,
            QuestionBank.deleted_at.is_(None),
            QuestionBank.owner_id == nodes.c.course_owner_id,
            QuestionBank.name == func.substr(func.trim(nodes.c.course_name), 1, 197) + "-题库",
        )
        .correlate(Question)
    )
    return or_(linked, bank)


def course_question_filter(course_id: uuid.UUID, owner_id: uuid.UUID, user_id: uuid.UUID | None):
    nodes = course_nodes(course_id=course_id)
    owners = [owner_id] if user_id is None else [owner_id, user_id]
    return and_(Question.deleted_at.is_(None), Question.owner_id.in_(owners), question_in_course(nodes))


def question_read_filter(user_id: uuid.UUID):
    nodes = course_nodes(user_id)
    base_question = and_(
        Question.owner_id.in_(select(nodes.c.course_owner_id)),
        exists().where(
            nodes.c.course_owner_id == Question.owner_id,
            or_(
                exists()
                .where(
                    question_knowledge_points.c.question_id == Question.id,
                    question_knowledge_points.c.knowledge_point_id == nodes.c.id,
                )
                .correlate(Question, nodes),
                exists().where(
                    QuestionBank.id == Question.question_bank_id,
                    QuestionBank.owner_id == nodes.c.course_owner_id,
                    QuestionBank.deleted_at.is_(None),
                    QuestionBank.name == func.substr(func.trim(nodes.c.course_name), 1, 197) + "-题库",
                ),
            ),
        ),
    )
    platform_bank = (
        exists()
        .where(
            QuestionBank.id == Question.question_bank_id,
            QuestionBank.owner_id == Question.owner_id,
            QuestionBank.visibility == VisibilityScope.PLATFORM,
            QuestionBank.deleted_at.is_(None),
        )
        .correlate(Question)
    )
    return or_(Question.owner_id == user_id, platform_bank, base_question)


def paper_read_filter(user_id: uuid.UUID):
    return or_(
        Paper.owner_id == user_id,
        and_(
            Paper.is_reusable.is_(True),
            exists().where(
                KnowledgePoint.id == Paper.root_knowledge_point_id,
                KnowledgePoint.owner_id == Paper.owner_id,
                KnowledgePoint.deleted_at.is_(None),
                course_read_filter(user_id),
            ),
        ),
    )


def material_read_filter(user_id: uuid.UUID | None):
    nodes = course_nodes(user_id)
    shared = and_(
        LearningResource.node_type == "kp",
        exists().where(
            nodes.c.id == LearningResource.node_id,
            or_(LearningResource.uploaded_by == nodes.c.course_owner_id, LearningResource.uploaded_by.is_(None)),
        ),
    )
    return and_(
        LearningResource.deleted_at.is_(None),
        shared if user_id is None else or_(LearningResource.uploaded_by == user_id, shared),
    )


async def require_material_access(
    db: AsyncSession,
    resource: LearningResource,
    user_id: uuid.UUID | None,
    *,
    write: bool = False,
    is_admin: bool = False,
):
    if resource.deleted_at is not None:
        raise HTTPException(404, "资料不存在")
    if is_admin:
        return
    if write:
        if user_id is None or resource.uploaded_by != user_id:
            raise HTTPException(403, "只能修改自己的资料")
        return
    # Non-course resources retain their existing authenticated read behaviour.
    if resource.node_type != "kp" and user_id is not None:
        return
    if not await db.scalar(
        select(LearningResource.id).where(
            LearningResource.id == resource.id,
            material_read_filter(user_id),
        )
    ):
        raise HTTPException(404, "资料不存在或无权访问")


async def require_node_access(db: AsyncSession, node_id: uuid.UUID, node_type: str, user_id: uuid.UUID):
    if node_type != "kp":
        return
    from app.auth.dependencies import user_has_role

    is_admin = await user_has_role(db, user_id, "platform_admin")
    conditions = [KnowledgePoint.id == node_id, KnowledgePoint.deleted_at.is_(None)]
    if not is_admin:
        conditions.append(knowledge_read_filter(user_id))
    if not await db.scalar(select(KnowledgePoint.id).where(*conditions)):
        raise HTTPException(404, "知识点不存在或无权访问")
