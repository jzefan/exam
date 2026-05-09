"""Core service functions for reusable paper assets."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Select, and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.auth.models import User
from app.common.data_visibility import VisibilityScope
from app.common.resource_access import teacher_owned_resource_filter, teacher_visible_resource_filter
from app.learning.models import KnowledgePoint
from app.papers.models import Paper, PaperQuestion
from app.papers.schemas import PaperCreate, PaperQuestionItem, PaperUpdate
from app.questions.models import Question, QuestionBank


def paper_base_query() -> Select:
    return (
        select(Paper)
        .where(Paper.deleted_at.is_(None))
        .options(
            joinedload(Paper.creator),
            joinedload(Paper.root_knowledge_point),
            selectinload(Paper.paper_questions).joinedload(PaperQuestion.question),
        )
        .execution_options(populate_existing=True)
    )


def paper_scope_query(user: User, is_admin: bool) -> Select:
    query = paper_base_query()
    if not is_admin:
        query = query.where(teacher_owned_resource_filter(Paper, user.id))
    return query


async def list_papers_for_user(db: AsyncSession, *, user: User, is_admin: bool) -> tuple[list[Paper], int]:
    query = paper_scope_query(user, is_admin).order_by(Paper.created_at.desc())
    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    rows = (await db.execute(query)).scalars().unique().all()
    papers = list(rows)
    for paper in papers:
        paper.paper_questions.sort(key=lambda item: item.order)
    return papers, int(total or 0)


async def get_paper_by_id(db: AsyncSession, paper_id: uuid.UUID, *, user: User, is_admin: bool) -> Paper | None:
    result = await db.execute(paper_scope_query(user, is_admin).where(Paper.id == paper_id))
    paper = result.scalars().unique().one_or_none()
    if paper:
        paper.paper_questions.sort(key=lambda item: item.order)
    return paper


def _normalized_paper_question_rows(paper_id: uuid.UUID, question_items: list[PaperQuestionItem]) -> list[PaperQuestion]:
    rows: list[PaperQuestion] = []
    seen_question_ids: set[uuid.UUID] = set()
    seen_orders: set[int] = set()
    for index, item in enumerate(question_items):
        if item.question_id in seen_question_ids:
            raise ValueError("duplicate question in paper")
        seen_question_ids.add(item.question_id)

        order = item.order if item.order is not None else index
        if order in seen_orders:
            raise ValueError("duplicate question order in paper")
        seen_orders.add(order)

        rows.append(
            PaperQuestion(
                paper_id=paper_id,
                question_id=item.question_id,
                order=order,
                score_override=item.score_override,
            )
        )
    return rows


async def _ensure_visible_source_paper(
    db: AsyncSession,
    source_paper_id: uuid.UUID | None,
    *,
    user: User,
    is_admin: bool,
) -> None:
    if source_paper_id is None:
        return
    query = select(Paper.id).where(Paper.id == source_paper_id, Paper.deleted_at.is_(None))
    if not is_admin:
        query = query.where(teacher_owned_resource_filter(Paper, user.id))
    if await db.scalar(query) is None:
        raise ValueError("source paper not found or not visible")


async def _ensure_visible_root_knowledge_point(
    db: AsyncSession,
    root_knowledge_point_id: uuid.UUID | None,
    *,
    user: User,
    is_admin: bool,
) -> None:
    if root_knowledge_point_id is None:
        return
    query = select(KnowledgePoint.id).where(
        KnowledgePoint.id == root_knowledge_point_id,
        KnowledgePoint.deleted_at.is_(None),
    )
    if not is_admin:
        query = query.where(teacher_visible_resource_filter(KnowledgePoint, user.id))
    if await db.scalar(query) is None:
        raise ValueError("knowledge point not found or not visible")


async def _ensure_visible_questions(
    db: AsyncSession,
    question_items: list[PaperQuestionItem],
    *,
    user: User,
    is_admin: bool,
) -> None:
    question_ids = {item.question_id for item in question_items}
    if not question_ids:
        return

    query = select(Question.id).where(Question.id.in_(question_ids), Question.deleted_at.is_(None))
    if not is_admin:
        query = query.outerjoin(QuestionBank, Question.question_bank_id == QuestionBank.id).where(
            or_(
                teacher_owned_resource_filter(Question, user.id),
                and_(
                    Question.question_bank_id.is_not(None),
                    QuestionBank.deleted_at.is_(None),
                    QuestionBank.visibility == VisibilityScope.PLATFORM,
                ),
            )
        )
    visible_ids = set(await db.scalars(query))
    if visible_ids != question_ids:
        raise ValueError("question not found or not visible")


async def _ensure_paper_references_visible(
    db: AsyncSession,
    *,
    user: User,
    is_admin: bool,
    source_paper_id: uuid.UUID | None = None,
    root_knowledge_point_id: uuid.UUID | None = None,
    question_items: list[PaperQuestionItem] | None = None,
) -> None:
    await _ensure_visible_source_paper(db, source_paper_id, user=user, is_admin=is_admin)
    await _ensure_visible_root_knowledge_point(db, root_knowledge_point_id, user=user, is_admin=is_admin)
    if question_items is not None:
        _normalized_paper_question_rows(uuid.uuid4(), question_items)
        await _ensure_visible_questions(db, question_items, user=user, is_admin=is_admin)


async def sync_paper_questions(db: AsyncSession, paper: Paper, question_items: list[PaperQuestionItem]) -> None:
    await db.execute(delete(PaperQuestion).where(PaperQuestion.paper_id == paper.id))
    await db.flush()
    rows = _normalized_paper_question_rows(paper.id, question_items)
    db.add_all(rows)


async def create_paper(db: AsyncSession, data: PaperCreate, *, user: User, is_admin: bool) -> Paper:
    await _ensure_paper_references_visible(
        db,
        user=user,
        is_admin=is_admin,
        source_paper_id=data.source_paper_id,
        root_knowledge_point_id=data.root_knowledge_point_id,
        question_items=data.question_items,
    )
    paper = Paper(
        title=data.title,
        description=data.description,
        source_type=data.source_type,
        source_paper_id=data.source_paper_id,
        root_knowledge_point_id=data.root_knowledge_point_id,
        is_reusable=data.is_reusable,
        created_by=user.id,
        owner_id=user.id,
    )
    db.add(paper)
    await db.flush()
    if data.question_items:
        await sync_paper_questions(db, paper, data.question_items)
    await db.flush()
    return (await get_paper_by_id(db, paper.id, user=user, is_admin=True)) or paper


async def update_paper(db: AsyncSession, paper: Paper, data: PaperUpdate, *, user: User, is_admin: bool) -> Paper:
    await _ensure_paper_references_visible(
        db,
        user=user,
        is_admin=is_admin,
        root_knowledge_point_id=data.root_knowledge_point_id if "root_knowledge_point_id" in data.model_fields_set else None,
        question_items=data.question_items,
    )
    values = data.model_dump(exclude_unset=True, exclude={"question_items"})
    for field, value in values.items():
        setattr(paper, field, value)
    if data.question_items is not None:
        await sync_paper_questions(db, paper, data.question_items)
    await db.flush()
    return (await get_paper_by_id(db, paper.id, user=user, is_admin=True)) or paper


async def archive_paper(db: AsyncSession, paper: Paper) -> Paper:
    paper.archived_at = datetime.now(timezone.utc)
    await db.flush()
    return paper


async def soft_delete_paper(db: AsyncSession, paper: Paper) -> None:
    paper.deleted_at = datetime.now(timezone.utc)
    await db.flush()
