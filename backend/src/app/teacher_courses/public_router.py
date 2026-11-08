"""Public router for course short-link sharing and direct entry."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.security import (
    create_access_token,
    decode_access_token,
    hash_password_async,
    verify_password_async,
)
from app.database import get_db
from app.job_models.models import LearningResource
from app.learning.models import Direction, KnowledgePoint, Major
from app.papers.models import Paper
from app.questions.models import Question, QuestionBank
from app.questions.service import root_knowledge_question_bank_name
from app.rbac.models import Organization, Role, UserOrganization
from app.rbac.service import add_role_to_user
from app.teacher_courses.models import CourseShareLink, CourseUserWorkspace
from app.teacher_courses.schemas import (
    CourseShareEnterRequest,
    CourseShareEnterResponse,
    CourseSharePublicPreviewResponse,
)

router = APIRouter(prefix="/public/course-share", tags=["public-course-share"])


def _course_subtree_ids_stmt(course_id: uuid.UUID):
    anchor = select(KnowledgePoint.id).where(
        KnowledgePoint.id == course_id,
        KnowledgePoint.deleted_at.is_(None),
    )
    subtree = anchor.cte(name="public_share_subtree", recursive=True)
    return subtree.union_all(
        select(KnowledgePoint.id).where(
            KnowledgePoint.parent_id == subtree.c.id,
            KnowledgePoint.deleted_at.is_(None),
        )
    )


@router.get("/{share_code}", response_model=CourseSharePublicPreviewResponse)
async def get_course_share_public_preview(
    share_code: str,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CourseSharePublicPreviewResponse:
    """Public endpoint to fetch course summary by share code."""
    link_stmt = select(CourseShareLink).where(
        CourseShareLink.share_code == share_code,
        CourseShareLink.is_active.is_(True),
        CourseShareLink.deleted_at.is_(None),
    )
    link = (await db.execute(link_stmt)).scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="课程短链接不存在或已停用")

    course_stmt = (
        select(KnowledgePoint, Direction, Major, User)
        .outerjoin(Direction, KnowledgePoint.direction_id == Direction.id)
        .outerjoin(Major, Direction.major_id == Major.id)
        .outerjoin(User, KnowledgePoint.owner_id == User.id)
        .where(
            KnowledgePoint.id == link.course_id,
            KnowledgePoint.parent_id.is_(None),
            KnowledgePoint.deleted_at.is_(None),
        )
    )
    row = (await db.execute(course_stmt)).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="课程不存在或已删除")
    course, direction, major, creator = row

    subtree = _course_subtree_ids_stmt(course.id)
    subtree_ids = select(subtree.c.id)

    kp_count = await db.scalar(
        select(func.count(KnowledgePoint.id)).where(
            KnowledgePoint.id.in_(subtree_ids),
            KnowledgePoint.id != course.id,
            KnowledgePoint.deleted_at.is_(None),
        )
    ) or 0

    material_count = await db.scalar(
        select(func.count(LearningResource.id)).where(
            LearningResource.node_type == "kp",
            LearningResource.node_id.in_(subtree_ids),
        )
    ) or 0

    bank_stmt = select(QuestionBank).where(
        QuestionBank.owner_id == course.owner_id,
        QuestionBank.name == root_knowledge_question_bank_name(course.name),
        QuestionBank.deleted_at.is_(None),
    ).limit(1)
    bank = (await db.execute(bank_stmt)).scalar_one_or_none()
    question_count = 0
    if bank is not None:
        question_count = await db.scalar(
            select(func.count(Question.id)).where(
                Question.question_bank_id == bank.id,
                Question.deleted_at.is_(None),
            )
        ) or 0

    paper_count = await db.scalar(
        select(func.count(Paper.id)).where(
            Paper.root_knowledge_point_id == course.id,
            Paper.owner_id == course.owner_id,
            Paper.deleted_at.is_(None),
        )
    ) or 0

    return CourseSharePublicPreviewResponse(
        course_id=course.id,
        share_code=link.share_code,
        course_name=course.name,
        description=course.description,
        major_name=major.name if major else None,
        creator_name=creator.full_name if creator else None,
        stats={
            "knowledge_point_count": int(kp_count),
            "material_count": int(material_count),
            "question_count": int(question_count),
            "paper_count": int(paper_count),
        },
    )


@router.post("/{share_code}/enter", response_model=CourseShareEnterResponse)
async def enter_course_share(
    share_code: str,
    payload: CourseShareEnterRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: Annotated[str | None, Header()] = None,
) -> CourseShareEnterResponse:
    """Enter a course directly via short link without traditional login."""
    link_stmt = select(CourseShareLink).where(
        CourseShareLink.share_code == share_code,
        CourseShareLink.is_active.is_(True),
        CourseShareLink.deleted_at.is_(None),
    )
    link = (await db.execute(link_stmt)).scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="课程短链接不存在或已停用")

    course = await db.get(KnowledgePoint, link.course_id)
    if course is None or course.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="课程不存在或已删除")

    # Path 1: Caller already has a valid access token in Authorization header
    token_str = None
    if authorization and authorization.lower().startswith("bearer "):
        token_str = authorization[7:].strip()
    if token_str:
        decoded = decode_access_token(token_str)
        if decoded and "sub" in decoded:
            try:
                authed_user_id = uuid.UUID(decoded["sub"])
                user = await db.get(User, authed_user_id)
                if user is not None and user.is_active and user.deleted_at is None:
                    # Look up or create workspace record for this authenticated user
                    ws_stmt = select(CourseUserWorkspace).where(
                        CourseUserWorkspace.course_id == course.id,
                        CourseUserWorkspace.user_id == user.id,
                        CourseUserWorkspace.deleted_at.is_(None),
                    ).limit(1)
                    ws = (await db.execute(ws_stmt)).scalar_one_or_none()
                    if ws is None:
                        ws = CourseUserWorkspace(
                            course_id=course.id,
                            user_id=user.id,
                            workspace_key=uuid.uuid4().hex,
                            alias_name=user.full_name,
                        )
                        db.add(ws)
                        await db.commit()
                        await db.refresh(ws)

                    return CourseShareEnterResponse(
                        requires_password=False,
                        access_token=token_str,
                        token_type="bearer",
                        workspace_key=ws.workspace_key,
                        course_id=course.id,
                        course_name=course.name,
                        alias_name=ws.alias_name or user.full_name,
                        has_password=bool(ws.password_hash),
                        user={
                            "id": str(user.id),
                            "full_name": user.full_name,
                            "username": user.username,
                        },
                    )
            except Exception:
                pass

    # Path 2: Returning visitor with existing workspace_key
    if payload.workspace_key:
        ws_stmt = select(CourseUserWorkspace).where(
            CourseUserWorkspace.course_id == course.id,
            CourseUserWorkspace.workspace_key == payload.workspace_key,
            CourseUserWorkspace.deleted_at.is_(None),
        ).limit(1)
        ws = (await db.execute(ws_stmt)).scalar_one_or_none()
        if ws is not None:
            user = await db.get(User, ws.user_id)
            if user is not None and user.is_active and user.deleted_at is None:
                if ws.password_hash:
                    if not payload.password:
                        return CourseShareEnterResponse(
                            requires_password=True,
                            course_id=course.id,
                            course_name=course.name,
                            alias_name=ws.alias_name or user.full_name,
                            has_password=True,
                        )
                    if not await verify_password_async(payload.password, ws.password_hash):
                        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="访问密码错误")

                token = create_access_token(user.id, "teacher")
                return CourseShareEnterResponse(
                    requires_password=False,
                    access_token=token,
                    token_type="bearer",
                    workspace_key=ws.workspace_key,
                    course_id=course.id,
                    course_name=course.name,
                    alias_name=ws.alias_name or user.full_name,
                    has_password=bool(ws.password_hash),
                    user={
                        "id": str(user.id),
                        "full_name": user.full_name,
                        "username": user.username,
                    },
                )

    # Path 3: First-time visitor — auto-provision isolated teacher guest workspace
    org: Organization | None = None
    if course.owner_id is not None:
        owner_user = await db.get(User, course.owner_id)
        if owner_user and owner_user.primary_org_id:
            org = await db.get(Organization, owner_user.primary_org_id)
    if org is None:
        org = (await db.execute(select(Organization).where(Organization.is_active.is_(True)).limit(1))).scalar_one_or_none()
    if org is None:
        org = Organization(name="默认教学中心", is_active=True)
        db.add(org)
        await db.flush()

    raw_pass = uuid.uuid4().hex
    display_name = payload.alias_name.strip() if payload.alias_name else f"教师_{uuid.uuid4().hex[:4]}"
    username = f"c_{share_code[:6]}_{uuid.uuid4().hex[:8]}"

    guest_user = User(
        username=username,
        email=f"{username}@course.local",
        full_name=display_name,
        password_hash=await hash_password_async(raw_pass),
        is_active=True,
        user_type="teacher",
        primary_org_id=org.id,
    )
    db.add(guest_user)
    await db.flush()

    teacher_role = (
        await db.execute(select(Role).where(Role.name == "teacher", Role.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if teacher_role is None:
        teacher_role = (await db.execute(select(Role).where(Role.deleted_at.is_(None)).limit(1))).scalar_one()

    await add_role_to_user(db, guest_user.id, org.id, teacher_role.id, is_primary=True)

    new_ws_key = uuid.uuid4().hex
    pwd_hash = (
        await hash_password_async(payload.password.strip())
        if payload.password and payload.password.strip()
        else None
    )
    if pwd_hash:
        guest_user.password_hash = pwd_hash

    ws = CourseUserWorkspace(
        course_id=course.id,
        user_id=guest_user.id,
        workspace_key=new_ws_key,
        password_hash=pwd_hash,
        alias_name=display_name,
    )
    db.add(ws)
    await db.commit()
    await db.refresh(guest_user)
    await db.refresh(ws)

    token = create_access_token(guest_user.id, "teacher")
    return CourseShareEnterResponse(
        requires_password=False,
        access_token=token,
        token_type="bearer",
        workspace_key=new_ws_key,
        course_id=course.id,
        course_name=course.name,
        alias_name=ws.alias_name,
        has_password=bool(pwd_hash),
        user={
            "id": str(guest_user.id),
            "full_name": guest_user.full_name,
            "username": guest_user.username,
        },
    )
