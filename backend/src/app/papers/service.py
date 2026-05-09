"""Core service functions for reusable paper assets."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Select, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.auth.models import User
from app.common.resource_access import teacher_owned_resource_filter
from app.papers.models import Paper, PaperQuestion
from app.papers.schemas import PaperCreate, PaperQuestionItem, PaperUpdate


def paper_base_query() -> Select:
    return (
        select(Paper)
        .where(Paper.deleted_at.is_(None))
        .options(
            joinedload(Paper.creator),
            joinedload(Paper.root_knowledge_point),
            selectinload(Paper.paper_questions).joinedload(PaperQuestion.question),
        )
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


async def sync_paper_questions(db: AsyncSession, paper: Paper, question_items: list[PaperQuestionItem]) -> None:
    await db.execute(delete(PaperQuestion).where(PaperQuestion.paper_id == paper.id))
    await db.flush()
    rows: list[PaperQuestion] = []
    for index, item in enumerate(question_items):
        rows.append(
            PaperQuestion(
                paper_id=paper.id,
                question_id=item.question_id,
                order=item.order if item.order is not None else index,
                score_override=item.score_override,
            )
        )
    db.add_all(rows)


async def create_paper(db: AsyncSession, data: PaperCreate, *, user: User, is_admin: bool) -> Paper:
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


async def update_paper(db: AsyncSession, paper: Paper, data: PaperUpdate) -> Paper:
    values = data.model_dump(exclude_unset=True, exclude={"question_items"})
    for field, value in values.items():
        setattr(paper, field, value)
    if data.question_items is not None:
        await sync_paper_questions(db, paper, data.question_items)
    await db.flush()
    return paper


async def archive_paper(db: AsyncSession, paper: Paper) -> Paper:
    paper.archived_at = datetime.now(timezone.utc)
    await db.flush()
    return paper


async def soft_delete_paper(db: AsyncSession, paper: Paper) -> None:
    paper.deleted_at = datetime.now(timezone.utc)
    await db.flush()
