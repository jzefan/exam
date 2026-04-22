from typing import Annotated
import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser, user_has_role
from app.database import get_db
from app.rbac.schemas import StudentCreate, StudentRead, ClassCreate, ClassResponse, BatchImportResponse
from app.rbac.schemas import StudentBatchDeleteRequest, StudentBatchDeleteResponse
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
    delete_class
)

router = APIRouter(tags=["students"])

async def get_teacher_org_id(user: CurrentUser, db: Annotated[AsyncSession, Depends(get_db)]) -> uuid.UUID:
    primary = await get_user_primary_org(db, user.id)
    if not primary:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User has no primary organization")
    return primary.org_id


async def is_student_admin(db: AsyncSession, user: CurrentUser) -> bool:
    return await user_has_role(db, user.id, "platform_admin", "school_admin", "admin")

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
        else:
            student, linked, created = await create_or_link_student(db, org_id, body, user.id)
            if not created and not linked:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该学生已在当前教师名下")
        return StudentRead.model_validate(student)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

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
        try:
            if student_admin:
                await create_student(db, org_id, item, owner_teacher_id=None)
            else:
                _student, linked, created = await create_or_link_student(db, org_id, item, user.id)
                if not created and not linked:
                    failed_count += 1
                    errors.append(f"{item.full_name}: 该学生已在当前教师名下")
                    continue
            success_count += 1
        except Exception as e:
            failed_count += 1
            errors.append(f"{item.full_name}: {str(e)}")
            continue
            
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
