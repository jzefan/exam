import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.auth.models import User
from app.auth.schemas import UserCreate
from app.auth.security import create_access_token, hash_password, verify_password
from app.auth.service import create_user
from app.rbac.models import Class, Organization, Role, TeacherStudent
from app.rbac.schemas import StudentCreate
from app.rbac.service import create_student, assign_unowned_students_to_single_teacher, ensure_teacher_student_link


async def _create_org_with_roles(db_session):
    org = Organization(name="Student Scope School", type="school", is_active=True)
    teacher_role = Role(name="teacher", display_name="Teacher", is_system=True)
    student_role = Role(name="student", display_name="Student", is_system=True)
    db_session.add_all([org, teacher_role, student_role])
    await db_session.flush()
    return org


async def _create_teacher(db_session, org_id, *, username: str, email: str, full_name: str) -> User:
    return await create_user(
        db_session,
        UserCreate(
            username=username,
            email=email,
            password="teacherpass123",
            full_name=full_name,
            role_name="teacher",
            org_id=org_id,
        ),
    )


@pytest.mark.asyncio
async def test_teacher_only_sees_owned_students(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-student-owner",
        email="teacher-student-owner@example.com",
        full_name="Teacher Student Owner",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-student-other",
        email="teacher-student-other@example.com",
        full_name="Teacher Student Other",
    )
    own_student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Own Student", phone="13900000001", student_id="S001"),
        owner_teacher_id=teacher.id,
    )
    await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Other Student", phone="13900000002", student_id="S002"),
        owner_teacher_id=other_teacher.id,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/rbac/students")

    assert response.status_code == 200
    assert [item["username"] for item in response.json()] == [own_student.username]
    assert {item["owner_teacher_id"] for item in response.json()} == {str(teacher.id)}


@pytest.mark.asyncio
async def test_single_teacher_system_backfills_unowned_students_to_sole_teacher(db_session) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-student-backfill",
        email="teacher-student-backfill@example.com",
        full_name="Teacher Student Backfill",
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Legacy Student", phone="13900000009", student_id="S009"),
        owner_teacher_id=None,
    )

    affected = await assign_unowned_students_to_single_teacher(db_session)
    await db_session.commit()
    await db_session.refresh(student)

    assert affected == 1
    assert student.owner_teacher_id == teacher.id


@pytest.mark.asyncio
async def test_teacher_created_student_is_owned_by_teacher(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-student-create",
        email="teacher-student-create@example.com",
        full_name="Teacher Student Create",
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(
        "/api/rbac/students",
        json={"full_name": "Created Student", "phone": "13900000003", "student_id": "S003"},
    )

    assert response.status_code == 201
    assert response.json()["owner_teacher_id"] == str(teacher.id)

    student = await db_session.scalar(select(User).where(User.phone == "13900000003"))
    assert student is not None
    assert student.owner_teacher_id == teacher.id


@pytest.mark.asyncio
async def test_teacher_sees_student_when_association_exists_even_without_owner_teacher_id(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-student-associated",
        email="teacher-student-associated@example.com",
        full_name="Teacher Student Associated",
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Linked Student", phone="13900000004", student_id="S004"),
        owner_teacher_id=None,
    )
    await ensure_teacher_student_link(db_session, teacher.id, student.id)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/rbac/students")

    assert response.status_code == 200
    assert [item["id"] for item in response.json()] == [str(student.id)]


@pytest.mark.asyncio
async def test_teacher_class_list_only_includes_classes_used_by_their_students(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-class-owner",
        email="teacher-class-owner@example.com",
        full_name="Teacher Class Owner",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-class-other",
        email="teacher-class-other@example.com",
        full_name="Teacher Class Other",
    )
    class_a = Class(name="A班", org_id=org.id)
    class_b = Class(name="B班", org_id=org.id)
    db_session.add_all([class_a, class_b])
    await db_session.flush()
    await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="A Student", phone="13900000005", student_id="S005", class_id=class_a.id),
        owner_teacher_id=teacher.id,
    )
    await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="B Student", phone="13900000006", student_id="S006", class_id=class_b.id),
        owner_teacher_id=other_teacher.id,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/rbac/students/classes")

    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["A班"]


@pytest.mark.asyncio
async def test_teacher_class_list_keeps_empty_classes_created_by_teacher(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-empty-class",
        email="teacher-empty-class@example.com",
        full_name="Teacher Empty Class",
    )
    empty_class = Class(name="空班级", org_id=org.id, created_by=teacher.id)
    db_session.add(empty_class)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/rbac/students/classes")

    assert response.status_code == 200
    assert [item["name"] for item in response.json()] == ["空班级"]


@pytest.mark.asyncio
async def test_teacher_cannot_delete_other_teachers_class(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-delete-own",
        email="teacher-delete-own@example.com",
        full_name="Teacher Delete Own",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-delete-other",
        email="teacher-delete-other@example.com",
        full_name="Teacher Delete Other",
    )
    foreign_class = Class(name="他人班级", org_id=org.id, created_by=other_teacher.id)
    db_session.add(foreign_class)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.delete(f"/api/rbac/students/classes/{foreign_class.id}")

    assert response.status_code == 403


@pytest.mark.asyncio
async def test_teacher_can_filter_unassigned_students(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-unassigned-filter",
        email="teacher-unassigned-filter@example.com",
        full_name="Teacher Unassigned Filter",
    )
    assigned_class = Class(name="有班级", org_id=org.id, created_by=teacher.id)
    db_session.add(assigned_class)
    await db_session.flush()
    await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Assigned Student", phone="13900000007", student_id="S007", class_id=assigned_class.id),
        owner_teacher_id=teacher.id,
    )
    unassigned_student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Unassigned Student", phone="13900000008", student_id="S008"),
        owner_teacher_id=teacher.id,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get("/api/rbac/students?unassigned=true")

    assert response.status_code == 200
    payload = response.json()
    assert [item["id"] for item in payload] == [str(unassigned_student.id)]
    assert payload[0]["class_id"] is None


@pytest.mark.asyncio
async def test_teacher_delete_only_removes_current_teacher_link_for_shared_student(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher_a = await _create_teacher(
        db_session,
        org.id,
        username="teacher-delete-shared-a",
        email="teacher-delete-shared-a@example.com",
        full_name="Teacher Delete Shared A",
    )
    teacher_b = await _create_teacher(
        db_session,
        org.id,
        username="teacher-delete-shared-b",
        email="teacher-delete-shared-b@example.com",
        full_name="Teacher Delete Shared B",
    )
    shared_student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Shared Delete Student", phone="13900000010", student_id="S010"),
        owner_teacher_id=teacher_a.id,
    )
    await ensure_teacher_student_link(db_session, teacher_b.id, shared_student.id)
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher_a.id, '')}"})
    response = await client.delete(f"/api/rbac/students/{shared_student.id}")

    assert response.status_code == 204

    await db_session.refresh(shared_student)
    remaining_links = (
        await db_session.execute(
            select(TeacherStudent.teacher_id).where(TeacherStudent.student_id == shared_student.id)
        )
    ).scalars().all()
    assert remaining_links == [teacher_b.id]
    assert shared_student.deleted_at is None
    assert shared_student.owner_teacher_id == teacher_b.id


@pytest.mark.asyncio
async def test_teacher_can_reset_owned_student_password_to_student_id(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-reset-owned",
        email="teacher-reset-owned@example.com",
        full_name="Teacher Reset Owned",
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Reset Owned Student", phone="13900000021", student_id="S021"),
        owner_teacher_id=teacher.id,
    )
    student.must_change_password = False
    student.session_token = "existing-session"
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(f"/api/rbac/students/{student.id}/reset-password")

    assert response.status_code == 200
    assert response.json() == {"password_source": "student_id"}

    await db_session.refresh(student)
    assert verify_password("S021", student.password_hash)
    assert not verify_password("13900000021", student.password_hash)
    assert student.must_change_password is True
    assert student.session_token is None


@pytest.mark.asyncio
async def test_teacher_reset_student_password_falls_back_to_username_without_student_id(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-reset-username",
        email="teacher-reset-username@example.com",
        full_name="Teacher Reset Username",
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Reset Username Student", phone="13900000023", student_id=None),
        owner_teacher_id=teacher.id,
    )
    student.password_hash = hash_password("temporary-password")
    student.must_change_password = False
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(f"/api/rbac/students/{student.id}/reset-password")

    assert response.status_code == 200
    assert response.json() == {"password_source": "username"}

    await db_session.refresh(student)
    assert verify_password(student.username, student.password_hash)
    assert student.must_change_password is True


@pytest.mark.asyncio
async def test_teacher_cannot_reset_other_teacher_student_password(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-reset-denied",
        email="teacher-reset-denied@example.com",
        full_name="Teacher Reset Denied",
    )
    other_teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-reset-owner",
        email="teacher-reset-owner@example.com",
        full_name="Teacher Reset Owner",
    )
    student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Reset Foreign Student", phone="13900000022", student_id="S022"),
        owner_teacher_id=other_teacher.id,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(f"/api/rbac/students/{student.id}/reset-password")

    assert response.status_code == 403

    await db_session.refresh(student)
    assert verify_password("13900000022", student.password_hash)
    assert not verify_password("S022", student.password_hash)


@pytest.mark.asyncio
async def test_teacher_can_batch_remove_students_from_current_list(client: AsyncClient, db_session) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-batch-delete",
        email="teacher-batch-delete@example.com",
        full_name="Teacher Batch Delete",
    )
    student_a = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Batch Delete A", phone="13900000011", student_id="S011"),
        owner_teacher_id=teacher.id,
    )
    student_b = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="Batch Delete B", phone="13900000012", student_id="S012"),
        owner_teacher_id=teacher.id,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(
        "/api/rbac/students/batch-delete",
        json={"student_ids": [str(student_a.id), str(student_b.id)]},
    )

    assert response.status_code == 200
    assert response.json() == {"success_count": 2, "failed_count": 0, "errors": []}

    await db_session.refresh(student_a)
    await db_session.refresh(student_b)
    assert student_a.deleted_at is not None
    assert student_b.deleted_at is not None

    list_response = await client.get("/api/rbac/students")
    assert list_response.status_code == 200
    assert list_response.json() == []


@pytest.mark.asyncio
async def test_teacher_batch_import_updates_existing_student_class(
    client: AsyncClient, db_session
) -> None:
    org = await _create_org_with_roles(db_session)
    teacher = await _create_teacher(
        db_session,
        org.id,
        username="teacher-batch-import-class",
        email="teacher-batch-import-class@example.com",
        full_name="Teacher Batch Import Class",
    )
    target_class = Class(name="2025级健康大数据班", org_id=org.id, created_by=teacher.id)
    db_session.add(target_class)
    await db_session.flush()
    existing_student = await create_student(
        db_session,
        org.id,
        StudentCreate(full_name="许宇航", phone=None, student_id="3256260101"),
        owner_teacher_id=None,
    )
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(
        "/api/rbac/students/batch",
        json=[
            {
                "full_name": "许宇航",
                "phone": None,
                "student_id": "3256260101",
                "class_id": str(target_class.id),
            }
        ],
    )

    assert response.status_code == 201
    assert response.json() == {"success_count": 1, "failed_count": 0, "errors": []}

    await db_session.refresh(existing_student)
    assert existing_student.class_id == target_class.id

    list_response = await client.get(f"/api/rbac/students?class_id={target_class.id}")
    assert list_response.status_code == 200
    payload = list_response.json()
    assert [item["student_id"] for item in payload] == ["3256260101"]
    assert payload[0]["class_name"] == "2025级健康大数据班"
