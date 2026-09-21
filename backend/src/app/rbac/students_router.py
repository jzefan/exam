from typing import Annotated
import logging
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, user_has_role
from app.database import get_db
from app.rbac.schemas import StudentCreate, StudentRead, ClassCreate, ClassResponse, BatchImportResponse
from app.rbac.schemas import StudentBatchDeleteRequest, StudentBatchDeleteResponse
from app.rbac.schemas import StudentPasswordResetResponse
from app.rbac.service import (
    create_or_link_student,
    create_student, 
    delete_student_for_actor,
    list_org_students, 
    list_teacher_classes,
    list_teacher_students,
    get_user_primary_org, 
    create_class, 
    list_org_classes, 
    delete_class,
    reset_student_password_for_actor,
)

router = APIRouter(tags=["students"])
logger = logging.getLogger(__name__)

ADD_STUDENT_CONFLICT_MESSAGE = (
    "该手机号或学号已被其他账号占用，请改用学号添加，或先在学生列表中搜索该账号"
)

async def get_teacher_org_id(user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]) -> uuid.UUID:
    primary = await get_user_primary_org(db, user.id)
    if not primary:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User has no primary organization")
    return primary.org_id


async def is_student_admin(db: AsyncSession, user: CurrentUser) -> bool:
    return await user_has_role(db, user.id, "platform_admin", "school_admin", "admin", "enterprise_admin")

# --- Class Routes ---

@router.get("/classes", response_model=list[ClassResponse])
async def list_classes(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    org_id: Annotated[uuid.UUID, Depends(get_teacher_org_id)]
):
    if await is_student_admin(db, user):
        classes = await list_org_classes(db, org_id)
    else:
        classes = await list_teacher_classes(db, org_id, user.id)
    return [ClassResponse.model_validate(c) for c in classes]

@router.post("/classes", response_model=ClassResponse, status_code=status.HTTP_201_CREATED)
async def add_class(
    body: ClassCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    org_id: Annotated[uuid.UUID, Depends(get_teacher_org_id)]
):
    cls = await create_class(db, org_id, body, created_by=None if await is_student_admin(db, user) else user.id)
    return ClassResponse.model_validate(cls)

@router.delete("/classes/{class_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_class(
    class_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    _org_id: Annotated[uuid.UUID, Depends(get_teacher_org_id)]
):
    try:
        await delete_class(
            db,
            class_id,
            allowed_creator_id=None if await is_student_admin(db, user) else user.id,
        )
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc

# --- Student Routes ---

@router.get("", response_model=list[StudentRead])
async def list_students(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    org_id: Annotated[uuid.UUID, Depends(get_teacher_org_id)],
    class_id: uuid.UUID | None = None,
    unassigned: bool = False,
):
    student_admin = await is_student_admin(db, user)
    if student_admin:
        students = await list_org_students(db, org_id, class_id, unassigned=unassigned)
    else:
        students = await list_teacher_students(db, org_id, user.id, class_id, unassigned=unassigned)
    result = []
    for s in students:
        item = StudentRead.model_validate(s)
        item.class_name = s.student_class.name if s.student_class else None
        result.append(item)
    return result

@router.post("", response_model=StudentRead, status_code=status.HTTP_201_CREATED)
async def add_student(
    body: StudentCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    org_id: Annotated[uuid.UUID, Depends(get_teacher_org_id)]
):
    try:
        if await is_student_admin(db, user):
            student = await create_student(db, org_id, body, owner_teacher_id=None)
            attached = False
        else:
            result = await create_or_link_student(db, org_id, body, user.id)
            if not result.created and not result.linked:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该学生已在当前教师名下")
            student, attached = result.student, result.role_added
        response = StudentRead.model_validate(student)
        response.attached_to_existing_account = attached
        return response
    except HTTPException:
        raise
    except IntegrityError as exc:
        # Raw UniqueViolation text belongs in the log, not in a user-facing toast.
        await db.rollback()
        logger.warning("Add student conflict for %s: %s", body.phone or body.student_id, exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=ADD_STUDENT_CONFLICT_MESSAGE,
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        await db.rollback()
        logger.exception("Add student failed for %s", body.phone or body.student_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="添加学生失败，请稍后重试",
        ) from exc

@router.post("/batch", response_model=BatchImportResponse, status_code=status.HTTP_201_CREATED)
async def batch_add_students(
    body: list[StudentCreate],
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    org_id: Annotated[uuid.UUID, Depends(get_teacher_org_id)]
):
    success_count = 0
    failed_count = 0
    errors = []
    student_admin = await is_student_admin(db, user)
    
    for item in body:
        # One savepoint per row: a conflicting row must not take the rows that
        # already succeeded down with it when the final commit runs.
        skip_message = None
        try:
            async with db.begin_nested():
                if student_admin:
                    await create_student(db, org_id, item, owner_teacher_id=None)
                else:
                    result = await create_or_link_student(db, org_id, item, user.id)
                    if not result.created and not result.linked:
                        skip_message = "该学生已在当前教师名下"
        except IntegrityError as exc:
            logger.warning("Import conflict for %s: %s", item.phone or item.student_id, exc)
            failed_count += 1
            errors.append(f"{item.full_name}: {ADD_STUDENT_CONFLICT_MESSAGE}")
            continue
        except ValueError as exc:
            failed_count += 1
            errors.append(f"{item.full_name}: {exc}")
            continue
        except Exception:
            logger.exception("Import failed for %s", item.phone or item.student_id)
            failed_count += 1
            errors.append(f"{item.full_name}: 该行导入失败，请检查填写内容后重试")
            continue

        if skip_message:
            failed_count += 1
            errors.append(f"{item.full_name}: {skip_message}")
            continue
        success_count += 1

    await db.commit()
    return BatchImportResponse(
        success_count=success_count,
        failed_count=failed_count,
        errors=errors
    )


@router.post("/batch-delete", response_model=StudentBatchDeleteResponse)
async def batch_delete_students(
    body: StudentBatchDeleteRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    _org_id: Annotated[uuid.UUID, Depends(get_teacher_org_id)],
):
    success_count = 0
    failed_count = 0
    errors = []
    student_admin = await is_student_admin(db, user)

    for student_id in body.student_ids:
        try:
            await delete_student_for_actor(
                db,
                student_id,
                actor_is_admin=student_admin,
                teacher_id=None if student_admin else user.id,
            )
            success_count += 1
        except Exception as exc:
            failed_count += 1
            errors.append(f"{student_id}: {str(exc)}")

    await db.commit()
    return StudentBatchDeleteResponse(
        success_count=success_count,
        failed_count=failed_count,
        errors=errors,
    )


@router.post("/{student_id}/reset-password", response_model=StudentPasswordResetResponse)
async def reset_student_password(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    org_id: Annotated[uuid.UUID, Depends(get_teacher_org_id)],
):
    student_admin = await is_student_admin(db, user)
    try:
        _student, password_source = await reset_student_password_for_actor(
            db,
            student_id,
            org_id,
            actor_is_admin=student_admin,
            teacher_id=None if student_admin else user.id,
        )
        await db.commit()
        return StudentPasswordResetResponse(password_source=password_source)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_student(
    student_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    _org_id: Annotated[uuid.UUID, Depends(get_teacher_org_id)],
):
    student_admin = await is_student_admin(db, user)
    try:
        await delete_student_for_actor(
            db,
            student_id,
            actor_is_admin=student_admin,
            teacher_id=None if student_admin else user.id,
        )
        await db.commit()
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(exc)) from exc
