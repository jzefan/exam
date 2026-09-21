"""Teacher-facing course workspace routes.

The course concept here intentionally reuses root knowledge points.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy import and_, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth.dependencies import CurrentUser, user_has_role
from app.auth.models import User
from app.common.data_visibility import VisibilityScope
from app.common.resource_access import can_write_owned_resource, teacher_owned_resource_filter, teacher_visible_resource_filter
from app.database import get_db
from app.exams.models import (
    Exam,
    ExamQuestion,
    ExamStudent,
    GradingStatus,
    StudentExamAnswer,
    StudentExamSubmissionAnswer,
)
from app.job_models.models import LearningResource
from app.learning.models import Direction, KnowledgePoint, Major
from app.questions.models import Question, QuestionBank, QuestionImportJobStatus, question_knowledge_points
from app.questions.router import _build_question_response
from app.questions.schemas import QuestionEditLockInfo, QuestionResponse
from app.questions.service import (
    IN_USE_ALLOWED_FIELDS,
    IN_USE_REGRADE_FIELDS,
    can_hard_delete_question,
    create_question_import_job,
    get_or_create_root_knowledge_question_bank,
    process_existing_question_knowledge_match_job,
    root_knowledge_question_bank_name,
    soft_delete_question,
)
from app.rbac.models import Class, Role, TeacherStudent, UserOrganization
from app.teacher_courses.models import (
    CourseGradeWeight,
    CourseSemester,
    CourseStudentGrade,
    ExamSemesterAssignment,
)
from app.teacher_courses.schemas import (
    CourseGradeClass,
    CourseGradeComponent,
    CourseGradeDistribution,
    CourseGradeStudent,
    CourseGradeSummary,
    CourseGradeWeights,
    CourseKnowledgeNode,
    CourseMasteryMatrixCell,
    CourseMasteryQuestion,
    CourseMasteryStudent,
    CourseMasterySummary,
    CourseMasteryUnit,
    CourseQuestionKnowledgeCompleteRequest,
    CourseQuestionKnowledgeCompleteResponse,
    CourseSemesterClassesUpdate,
    CourseSemesterCreate,
    CourseSemesterResponse,
    CourseStudentGradeUpdate,
    CourseStudentGradeUpdateResponse,
    ExamSemesterArchiveRequest,
    TeacherCourseAssignmentScoreCell,
    TeacherCourseAssignmentScoreColumn,
    TeacherCourseAssignmentScoreStudent,
    TeacherCourseAssignmentScoreSummary,
    TeacherCourseCreate,
    TeacherCourseDetail,
    TeacherCourseExam,
    TeacherCourseExamKnowledgePoint,
    TeacherCourseMaterial,
    TeacherCourseQuestion,
    TeacherCourseQuestionList,
    TeacherCourseSummary,
)

router = APIRouter()
DB = Annotated[AsyncSession, Depends(get_db)]

DEFAULT_DIRECT_DIRECTION_NAMES = {"通用", "默认", "专业直属"}
# Cross-major shared pool. A new course goes here unless the teacher later moves it.
DEFAULT_MAJOR_NAME = "default-prof"
DEFAULT_DIRECTION_NAME = "通用"
_GRADABLE_QUESTION_TYPES = {"short_answer", "essay", "code"}


def _exam_has_gradable_questions(exam: Exam) -> bool:
    return any(
        exam_question.question is not None
        and (
            exam_question.question.type.value
            if hasattr(exam_question.question.type, "value")
            else str(exam_question.question.type)
        )
        in _GRADABLE_QUESTION_TYPES
        for exam_question in exam.exam_questions
    )


async def _ensure_default_direction(db: AsyncSession, user: User) -> Direction:
    """Return (creating if needed) the system default major + direction.

    A teacher's first course goes here; they can re-parent it from the knowledge
    tree later. Major + direction are shared (visibility=platform) and owned by
    the first teacher that triggers creation — ownership doesn't gate read access.
    """

    major_stmt = (
        select(Major)
        .where(Major.name == DEFAULT_MAJOR_NAME, Major.deleted_at.is_(None))
        .limit(1)
    )
    major = (await db.execute(major_stmt)).scalar_one_or_none()
    if major is None:
        # Major / Direction have no VisibilityMixin — they're directory-level
        # taxonomy, not access-controlled resources. owner_id stays for audit.
        major = Major(
            name=DEFAULT_MAJOR_NAME,
            description="系统默认专业，承载尚未指定专业的课程",
            owner_id=user.id,
        )
        db.add(major)
        await db.flush()

    direction_stmt = (
        select(Direction)
        .where(
            Direction.major_id == major.id,
            Direction.name == DEFAULT_DIRECTION_NAME,
            Direction.deleted_at.is_(None),
        )
        .limit(1)
    )
    direction = (await db.execute(direction_stmt)).scalar_one_or_none()
    if direction is None:
        direction = Direction(
            major_id=major.id,
            name=DEFAULT_DIRECTION_NAME,
            description=None,
            owner_id=user.id,
        )
        db.add(direction)
        await db.flush()
    return direction


async def _is_course_admin(db: AsyncSession, user: User) -> bool:
    return await user_has_role(db, user.id, "platform_admin", "school_admin", "admin")


def _course_subtree_cte(course_id: uuid.UUID, *, include_deleted_root: bool = False):
    anchor_conditions = [KnowledgePoint.id == course_id]
    if not include_deleted_root:
        anchor_conditions.append(KnowledgePoint.deleted_at.is_(None))
    anchor = select(KnowledgePoint.id).where(*anchor_conditions)
    subtree = anchor.cte(name="course_subtree", recursive=True)
    return subtree.union_all(
        select(KnowledgePoint.id).where(
            KnowledgePoint.parent_id == subtree.c.id,
            KnowledgePoint.deleted_at.is_(None),
        )
    )


async def _get_course_default_question_bank(
    db: AsyncSession,
    course: KnowledgePoint,
) -> QuestionBank | None:
    """Return the course's default question bank under the current naming convention."""

    if course.owner_id is None:
        return None
    stmt = (
        select(QuestionBank)
        .where(
            QuestionBank.owner_id == course.owner_id,
            QuestionBank.name == root_knowledge_question_bank_name(course.name),
            QuestionBank.deleted_at.is_(None),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _get_course_default_question_banks(
    db: AsyncSession,
    courses: list[KnowledgePoint],
) -> dict[uuid.UUID, QuestionBank]:
    course_keys = {
        (course.owner_id, root_knowledge_question_bank_name(course.name))
        for course in courses
        if course.owner_id is not None
    }
    if not course_keys:
        return {}

    owner_ids = {owner_id for owner_id, _name in course_keys}
    names = {name for _owner_id, name in course_keys}
    rows = (
        await db.execute(
            select(QuestionBank).where(
                QuestionBank.owner_id.in_(owner_ids),
                QuestionBank.name.in_(names),
                QuestionBank.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    bank_by_key = {(bank.owner_id, bank.name): bank for bank in rows}
    return {
        course.id: bank
        for course in courses
        if course.owner_id is not None
        if (bank := bank_by_key.get((course.owner_id, root_knowledge_question_bank_name(course.name)))) is not None
    }


async def _get_visible_course(
    db: AsyncSession,
    course_id: uuid.UUID,
    *,
    user: User,
    is_admin: bool,
    include_deleted: bool = False,
) -> tuple[KnowledgePoint, Direction | None, Major | None]:
    conditions = [
        KnowledgePoint.id == course_id,
        KnowledgePoint.parent_id.is_(None),
    ]
    if not include_deleted:
        conditions.append(KnowledgePoint.deleted_at.is_(None))
    stmt = (
        select(KnowledgePoint, Direction, Major)
        .outerjoin(Direction, KnowledgePoint.direction_id == Direction.id)
        .outerjoin(Major, Direction.major_id == Major.id)
        .where(*conditions)
    )
    if not is_admin:
        stmt = stmt.where(teacher_visible_resource_filter(KnowledgePoint, user.id))
    row = (await db.execute(stmt)).one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Course not found")
    course, direction, major = row
    return course, direction, major


def _is_major_direct(direction: Direction | None) -> bool:
    if direction is None:
        return True
    return direction.name.strip() in DEFAULT_DIRECT_DIRECTION_NAMES


def _display_path(major: Major | None, direction: Direction | None, course: KnowledgePoint) -> str:
    major_name = None if major and major.name == DEFAULT_MAJOR_NAME else major.name if major else None
    parts = [major_name]
    parts.append("专业直属" if _is_major_direct(direction) else direction.name if direction else None)
    parts.append(course.name)
    return " / ".join(part for part in parts if part)


async def _course_counts(
    db: AsyncSession,
    course: KnowledgePoint,
    *,
    user: User,
    is_admin: bool,
    semester_id: uuid.UUID | None = None,
    include_deleted_root: bool = False,
) -> dict[str, int]:
    course_id = course.id
    subtree = _course_subtree_cte(course_id, include_deleted_root=include_deleted_root)
    subtree_ids = select(subtree.c.id)

    default_bank = await _get_course_default_question_bank(db, course)
    question_count = 0
    if default_bank is not None:
        question_stmt = select(func.count(Question.id)).where(
            Question.deleted_at.is_(None),
            Question.question_bank_id == default_bank.id,
        )
        if not is_admin:
            question_stmt = question_stmt.where(teacher_owned_resource_filter(Question, user.id))
        question_count = await db.scalar(question_stmt) or 0

    material_stmt = select(func.count(LearningResource.id)).where(
        LearningResource.node_type == "kp",
        LearningResource.node_id.in_(subtree_ids),
    )

    # An exam belongs to the course when either pinned to the course directory
    # subtree or via question knowledge-point links into that subtree.
    has_kp_in_subtree = exists().where(
        ExamQuestion.exam_id == Exam.id,
        ExamQuestion.question_id == question_knowledge_points.c.question_id,
        question_knowledge_points.c.knowledge_point_id.in_(subtree_ids),
    )
    belongs_to_course = or_(Exam.course_kp_id.in_(subtree_ids), has_kp_in_subtree)

    # 考试/练习按学期归档：指定学期时，只统计归档到该学期的考试（不含「未归档」）。
    semester_pin = (
        exists().where(
            ExamSemesterAssignment.exam_id == Exam.id,
            ExamSemesterAssignment.course_semester_id == semester_id,
        )
        if semester_id is not None
        else None
    )

    def _exam_count_stmt(category: str):
        stmt = (
            select(func.count(Exam.id))
            .where(
                Exam.deleted_at.is_(None),
                Exam.category == category,
                belongs_to_course,
            )
        )
        if semester_pin is not None:
            stmt = stmt.where(semester_pin)
        if not is_admin:
            stmt = stmt.where(teacher_owned_resource_filter(Exam, user.id))
        return stmt

    pending_stmt = (
        select(func.count(ExamStudent.student_id))
        .select_from(ExamStudent)
        .join(Exam, Exam.id == ExamStudent.exam_id)
        .where(
            Exam.deleted_at.is_(None),
            ExamStudent.submitted_at.is_not(None),
            ExamStudent.grading_status != GradingStatus.REVIEWED.value,
            belongs_to_course,
        )
    )
    if semester_pin is not None:
        pending_stmt = pending_stmt.where(semester_pin)
    if not is_admin:
        pending_stmt = pending_stmt.where(teacher_owned_resource_filter(Exam, user.id))

    material_count = await db.scalar(material_stmt) or 0
    exam_count = await db.scalar(_exam_count_stmt("exam")) or 0
    assignment_count = await db.scalar(_exam_count_stmt("practice")) or 0
    pending_count = await db.scalar(pending_stmt) or 0
    return {
        "question_count": question_count,
        "material_count": material_count,
        "exam_count": exam_count,
        "assignment_count": assignment_count,
        "pending_count": pending_count,
    }


def _empty_counts() -> dict[str, int]:
    return {
        "question_count": 0,
        "material_count": 0,
        "exam_count": 0,
        "assignment_count": 0,
        "pending_count": 0,
    }


async def _batch_course_counts(
    db: AsyncSession,
    courses: list[KnowledgePoint],
    *,
    user: User,
    is_admin: bool,
) -> dict[uuid.UUID, dict[str, int]]:
    """Compute material / question / exam / practice / pending counts for many courses at once.

    The naive path runs five count queries per course (so a 30-course list does
    150 round-trips). This builds one recursive CTE that tags every descendant
    knowledge point with its owning course_id, then runs five GROUP BY queries
    on that CTE — total round-trips drop to 5 regardless of course count.
    """

    result: dict[uuid.UUID, dict[str, int]] = {course.id: _empty_counts() for course in courses}
    if not courses:
        return result

    course_ids = [course.id for course in courses]

    # Anchor: (course_id, descendant_kp_id) starting with each course as its own descendant.
    anchor = select(
        KnowledgePoint.id.label("course_id"),
        KnowledgePoint.id.label("kp_id"),
    ).where(
        KnowledgePoint.id.in_(course_ids),
    )
    subtree = anchor.cte(name="course_subtrees", recursive=True)
    child = (
        select(subtree.c.course_id, KnowledgePoint.id.label("kp_id"))
        .select_from(KnowledgePoint)
        .join(subtree, KnowledgePoint.parent_id == subtree.c.kp_id)
        .where(KnowledgePoint.deleted_at.is_(None))
    )
    subtree = subtree.union_all(child)

    # 1) questions per course: a course owns the questions in its default question bank.
    default_banks_by_course = await _get_course_default_question_banks(db, courses)
    course_id_by_bank_id = {
        bank.id: course_id for course_id, bank in default_banks_by_course.items()
    }
    if course_id_by_bank_id:
        q_stmt = (
            select(Question.question_bank_id, func.count(Question.id))
            .where(
                Question.deleted_at.is_(None),
                Question.question_bank_id.in_(course_id_by_bank_id.keys()),
            )
            .group_by(Question.question_bank_id)
        )
        if not is_admin:
            q_stmt = q_stmt.where(teacher_owned_resource_filter(Question, user.id))
        for bank_id, count in (await db.execute(q_stmt)).all():
            result[course_id_by_bank_id[bank_id]]["question_count"] = count

    # 2) materials per course
    m_stmt = (
        select(subtree.c.course_id, func.count(LearningResource.id))
        .select_from(subtree)
        .join(
            LearningResource,
            (LearningResource.node_id == subtree.c.kp_id) & (LearningResource.node_type == "kp"),
        )
        .group_by(subtree.c.course_id)
    )
    for course_id, count in (await db.execute(m_stmt)).all():
        result[course_id]["material_count"] = count

    # 3) exams + 4) practices per course — same shape, branch on category in one pass.
    # Two paths into a course:
    #   (a) via questions whose KP is in the course subtree (legacy implicit link)
    #   (b) via Exam.course_kp_id directly pointing at any node in the course subtree
    # We aggregate distinct exam ids per (course, category) by running both paths
    # and unioning in Python.
    def _accum_exam_counts(rows):
        per_course: dict[uuid.UUID, dict[str, set[uuid.UUID]]] = {}
        for course_id, category, exam_id in rows:
            bucket = per_course.setdefault(course_id, {"exam": set(), "practice": set()})
            bucket.setdefault(category, set()).add(exam_id)
        return per_course

    subtree_stmt = (
        select(
            subtree.c.course_id,
            Exam.category,
            Exam.id,
        )
        .select_from(subtree)
        .join(question_knowledge_points, question_knowledge_points.c.knowledge_point_id == subtree.c.kp_id)
        .join(ExamQuestion, ExamQuestion.question_id == question_knowledge_points.c.question_id)
        .join(Exam, Exam.id == ExamQuestion.exam_id)
        .where(Exam.deleted_at.is_(None), Exam.category.in_(["exam", "practice"]))
    )
    pinned_stmt = (
        select(subtree.c.course_id, Exam.category, Exam.id)
        .select_from(subtree)
        .join(Exam, Exam.course_kp_id == subtree.c.kp_id)
        .where(
            Exam.deleted_at.is_(None),
            Exam.category.in_(["exam", "practice"]),
        )
    )
    if not is_admin:
        subtree_stmt = subtree_stmt.where(teacher_owned_resource_filter(Exam, user.id))
        pinned_stmt = pinned_stmt.where(teacher_owned_resource_filter(Exam, user.id))

    rows = list((await db.execute(subtree_stmt)).all()) + list(
        (await db.execute(pinned_stmt)).all()
    )
    for course_id, buckets in _accum_exam_counts(rows).items():
        result[course_id]["exam_count"] = len(buckets["exam"])
        result[course_id]["assignment_count"] = len(buckets["practice"])

    # 5) pending submissions (only against real exams, not practices — matches the original 待处理 semantics).
    # Same union-of-two-paths trick: count distinct (exam, student) pairs.
    def _accum_pending(rows):
        per_course: dict[uuid.UUID, set[tuple[uuid.UUID, uuid.UUID]]] = {}
        for course_id, exam_id, student_id in rows:
            per_course.setdefault(course_id, set()).add((exam_id, student_id))
        return per_course

    p_subtree_stmt = (
        select(subtree.c.course_id, Exam.id, ExamStudent.student_id)
        .select_from(subtree)
        .join(question_knowledge_points, question_knowledge_points.c.knowledge_point_id == subtree.c.kp_id)
        .join(ExamQuestion, ExamQuestion.question_id == question_knowledge_points.c.question_id)
        .join(Exam, Exam.id == ExamQuestion.exam_id)
        .join(ExamStudent, ExamStudent.exam_id == Exam.id)
        .where(
            Exam.deleted_at.is_(None),
            Exam.category == "exam",
            ExamStudent.submitted_at.is_not(None),
            ExamStudent.grading_status != GradingStatus.REVIEWED.value,
        )
    )
    p_pinned_stmt = (
        select(subtree.c.course_id, Exam.id, ExamStudent.student_id)
        .select_from(subtree)
        .join(Exam, Exam.course_kp_id == subtree.c.kp_id)
        .join(ExamStudent, ExamStudent.exam_id == Exam.id)
        .where(
            Exam.deleted_at.is_(None),
            Exam.category == "exam",
            ExamStudent.submitted_at.is_not(None),
            ExamStudent.grading_status != GradingStatus.REVIEWED.value,
        )
    )
    if not is_admin:
        p_subtree_stmt = p_subtree_stmt.where(teacher_owned_resource_filter(Exam, user.id))
        p_pinned_stmt = p_pinned_stmt.where(teacher_owned_resource_filter(Exam, user.id))

    p_rows = list((await db.execute(p_subtree_stmt)).all()) + list(
        (await db.execute(p_pinned_stmt)).all()
    )
    for course_id, pairs in _accum_pending(p_rows).items():
        result[course_id]["pending_count"] = len(pairs)

    return result


def _build_course_summary(
    course: KnowledgePoint,
    direction: Direction | None,
    major: Major | None,
    *,
    counts: dict[str, int],
    user: User,
    is_admin: bool,
) -> TeacherCourseSummary:
    is_deleted = course.deleted_at is not None
    return TeacherCourseSummary(
        id=course.id,
        name=course.name,
        description=course.description,
        major_id=major.id if major else None,
        major_name=major.name if major else None,
        direction_id=direction.id if direction else None,
        direction_name=direction.name if direction else None,
        display_path=_display_path(major, direction, course),
        is_major_direct=_is_major_direct(direction),
        owner_id=course.owner_id,
        visibility=course.visibility,
        can_write=can_write_owned_resource(
            is_platform_admin=is_admin,
            current_user_id=user.id,
            owner_id=course.owner_id,
        ) and not is_deleted,
        updated_at=course.updated_at,
        deleted_at=course.deleted_at,
        is_deleted=is_deleted,
        **counts,
    )


async def _course_summary(
    db: AsyncSession,
    course: KnowledgePoint,
    direction: Direction | None,
    major: Major | None,
    *,
    user: User,
    is_admin: bool,
    semester_id: uuid.UUID | None = None,
) -> TeacherCourseSummary:
    is_deleted = course.deleted_at is not None
    counts = await _course_counts(
        db,
        course,
        user=user,
        is_admin=is_admin,
        semester_id=semester_id,
        include_deleted_root=is_deleted,
    )
    return TeacherCourseSummary(
        id=course.id,
        name=course.name,
        description=course.description,
        major_id=major.id if major else None,
        major_name=major.name if major else None,
        direction_id=direction.id if direction else None,
        direction_name=direction.name if direction else None,
        display_path=_display_path(major, direction, course),
        is_major_direct=_is_major_direct(direction),
        owner_id=course.owner_id,
        visibility=course.visibility,
        can_write=can_write_owned_resource(
            is_platform_admin=is_admin,
            current_user_id=user.id,
            owner_id=course.owner_id,
        ) and not is_deleted,
        updated_at=course.updated_at,
        deleted_at=course.deleted_at,
        is_deleted=is_deleted,
        **counts,
    )


@router.post("", response_model=TeacherCourseSummary, status_code=status.HTTP_201_CREATED)
async def create_teacher_course(
    payload: TeacherCourseCreate, db: DB, user: CurrentUser
) -> TeacherCourseSummary:
    """Create a course (root knowledge point) under the system default major.

    One teacher can run "the same" course for students of multiple majors; this
    keeps creation friction-free by parking new courses under a shared major,
    while still letting the teacher re-home them via the knowledge tree later.
    """

    is_admin = await _is_course_admin(db, user)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="课程名称不能为空")

    direction = await _ensure_default_direction(db, user)

    dupe_stmt = select(KnowledgePoint.id).where(
        KnowledgePoint.direction_id == direction.id,
        KnowledgePoint.parent_id.is_(None),
        KnowledgePoint.owner_id == user.id,
        KnowledgePoint.name == name,
        KnowledgePoint.deleted_at.is_(None),
    )
    if (await db.execute(dupe_stmt)).scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="同名课程已存在")

    course = KnowledgePoint(
        name=name,
        description=payload.description,
        direction_id=direction.id,
        parent_id=None,
        owner_id=user.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db.add(course)
    await db.flush()
    await get_or_create_root_knowledge_question_bank(
        db,
        user_id=user.id,
        root_knowledge_point=course,
    )
    await db.commit()
    await db.refresh(course)

    # Reload with relationships needed for the summary response.
    loaded = await _get_visible_course(db, course.id, user=user, is_admin=is_admin)
    return await _course_summary(db, *loaded, user=user, is_admin=is_admin)


@router.get("", response_model=list[TeacherCourseSummary])
async def list_teacher_courses(db: DB, user: CurrentUser) -> list[TeacherCourseSummary]:
    """My courses = courses I own.

    Platform-shared root knowledge points belong to other teachers and don't
    show up here on purpose: 「我的课程」literally means mine. Detail / write
    access checks still use the broader visibility model so a shared course
    fetched by direct link works.

    Perf: one rows query + one batched-counts query (5 GROUP BYs) regardless
    of how many courses the teacher owns. Earlier shape was N×5 round-trips.
    """

    is_admin = await _is_course_admin(db, user)
    rows_stmt = (
        select(KnowledgePoint, Direction, Major)
        .outerjoin(Direction, KnowledgePoint.direction_id == Direction.id)
        .outerjoin(Major, Direction.major_id == Major.id)
        .where(
            KnowledgePoint.parent_id.is_(None),
            KnowledgePoint.owner_id == user.id,
            # 「我的课程」只列我自己的私有课程；标记为 platform 的课程是共享给别人用的资产，不在这里出现。
            KnowledgePoint.visibility != VisibilityScope.PLATFORM,
        )
        .order_by(KnowledgePoint.updated_at.desc())
    )
    rows = (await db.execute(rows_stmt)).all()
    if not rows:
        return []

    courses = [course for course, _direction, _major in rows]
    counts_by_id = await _batch_course_counts(db, courses, user=user, is_admin=is_admin)

    return [
        _build_course_summary(
            course,
            direction,
            major,
            counts=counts_by_id.get(course.id, _empty_counts()),
            user=user,
            is_admin=is_admin,
        )
        for course, direction, major in rows
    ]


@router.get("/{course_id}", response_model=TeacherCourseDetail)
async def get_teacher_course(
    course_id: uuid.UUID,
    db: DB,
    user: CurrentUser,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
) -> TeacherCourseDetail:
    is_admin = await _is_course_admin(db, user)
    course, direction, major = await _get_visible_course(
        db,
        course_id,
        user=user,
        is_admin=is_admin,
        include_deleted=True,
    )
    summary = await _course_summary(
        db, course, direction, major, user=user, is_admin=is_admin, semester_id=semester_id
    )
    return TeacherCourseDetail(**summary.model_dump(), tags=course.tags or [], difficulty=course.difficulty)


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_teacher_course(course_id: uuid.UUID, db: DB, user: CurrentUser) -> None:
    """Soft-delete a course root while leaving its related history readable.

    Course materials, exams, questions and child knowledge points are intentionally
    not deleted here; the deleted course remains available as a read-only workspace.
    """

    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(
        db,
        course_id,
        user=user,
        is_admin=is_admin,
        include_deleted=False,
    )
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=course.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权删除该课程")

    course.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return None


@router.get("/{course_id}/materials", response_model=list[TeacherCourseMaterial])
async def list_teacher_course_materials(course_id: uuid.UUID, db: DB, user: CurrentUser) -> list[TeacherCourseMaterial]:
    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(
        db,
        course_id,
        user=user,
        is_admin=is_admin,
        include_deleted=True,
    )
    subtree = _course_subtree_cte(course_id, include_deleted_root=course.deleted_at is not None)
    stmt = (
        select(LearningResource, KnowledgePoint.name)
        .join(KnowledgePoint, LearningResource.node_id == KnowledgePoint.id)
        .where(
            LearningResource.node_type == "kp",
            LearningResource.node_id.in_(select(subtree.c.id)),
        )
        .order_by(LearningResource.created_at.desc())
    )
    rows = (await db.execute(stmt)).all()
    return [
        TeacherCourseMaterial(
            id=resource.id,
            node_id=resource.node_id,
            node_name=node_name,
            resource_type=resource.resource_type,
            title=resource.title,
            url=resource.url,
            description=resource.description,
            source=resource.source,
            file_path=resource.file_path,
            knowledge_fragments=resource.knowledge_fragments or [],
            kb_status=resource.kb_status,
            kb_chunk_count=resource.kb_chunk_count or 0,
            created_at=resource.created_at,
            updated_at=resource.updated_at,
        )
        for resource, node_name in rows
    ]


async def _list_course_exams(
    course_id: uuid.UUID,
    *,
    category: str,
    db: AsyncSession,
    user: User,
    is_admin: bool,
    semester_id: uuid.UUID | None,
) -> list[TeacherCourseExam]:
    course = await db.get(KnowledgePoint, course_id)
    subtree = _course_subtree_cte(
        course_id,
        include_deleted_root=bool(course and course.deleted_at is not None),
    )
    # An exam belongs to this course when either:
    #   (a) it was pinned to any node in the course directory subtree, or
    #   (b) at least one of its questions has a knowledge point inside the course subtree.
    has_kp_in_subtree = exists().where(
        ExamQuestion.exam_id == Exam.id,
        ExamQuestion.question_id == question_knowledge_points.c.question_id,
        question_knowledge_points.c.knowledge_point_id.in_(select(subtree.c.id)),
    )
    stmt = (
        select(Exam, CourseSemester)
        .outerjoin(ExamSemesterAssignment, ExamSemesterAssignment.exam_id == Exam.id)
        .outerjoin(
            CourseSemester,
            (CourseSemester.id == ExamSemesterAssignment.course_semester_id)
            & (CourseSemester.deleted_at.is_(None)),
        )
        .where(
            Exam.deleted_at.is_(None),
            Exam.category == category,
            or_(Exam.course_kp_id.in_(select(subtree.c.id)), has_kp_in_subtree),
        )
        .options(
            selectinload(Exam.exam_questions).selectinload(
                ExamQuestion.question
            ).selectinload(Question.knowledge_points),
            selectinload(Exam.exam_students),
        )
        .order_by(Exam.created_at.desc())
    )
    if semester_id is not None:
        # 按学期归档：指定学期时只显示归档到该学期的考试/练习，新建学期默认为空。
        stmt = stmt.where(ExamSemesterAssignment.course_semester_id == semester_id)
    if not is_admin:
        stmt = stmt.where(teacher_owned_resource_filter(Exam, user.id))
    rows = (await db.execute(stmt)).unique().all()
    responses: list[TeacherCourseExam] = []
    for exam, semester in rows:
        submitted_count = sum(1 for student in exam.exam_students if student.submitted_at is not None)
        pending_count = sum(
            1
            for student in exam.exam_students
            if student.submitted_at is not None and student.grading_status != GradingStatus.REVIEWED.value
        )
        has_student_history = any(
            s.started_at is not None or s.submitted_at is not None
            for s in exam.exam_students
        )
        knowledge_points_by_id: dict[uuid.UUID, TeacherCourseExamKnowledgePoint] = {}
        for exam_question in exam.exam_questions:
            question = exam_question.question
            if question is None:
                continue
            for kp in question.knowledge_points or []:
                knowledge_points_by_id.setdefault(
                    kp.id, TeacherCourseExamKnowledgePoint(id=kp.id, name=kp.name)
                )
        responses.append(
            TeacherCourseExam(
                id=exam.id,
                category=exam.category,
                course_kp_id=exam.course_kp_id,
                title=exam.title,
                description=exam.description,
                start_time=exam.start_time,
                end_time=exam.end_time,
                status=exam.status,
                total_questions=len(exam.exam_questions),
                total_score=exam.total_score,
                total_students=len(exam.exam_students),
                submitted_count=submitted_count,
                pending_count=pending_count,
                has_student_history=has_student_history,
                has_gradable_questions=_exam_has_gradable_questions(exam),
                knowledge_points=list(knowledge_points_by_id.values()),
                semester_id=semester.id if semester else None,
                semester_name=semester.name if semester else None,
                created_at=exam.created_at,
                updated_at=exam.updated_at,
            )
        )
    return responses


@router.get("/{course_id}/exams", response_model=list[TeacherCourseExam])
async def list_teacher_course_exams(
    course_id: uuid.UUID,
    db: DB,
    user: CurrentUser,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
) -> list[TeacherCourseExam]:
    is_admin = await _is_course_admin(db, user)
    await _get_visible_course(db, course_id, user=user, is_admin=is_admin, include_deleted=True)
    return await _list_course_exams(
        course_id, category="exam", db=db, user=user, is_admin=is_admin, semester_id=semester_id
    )


@router.get("/{course_id}/assignments", response_model=list[TeacherCourseExam])
async def list_teacher_course_assignments(
    course_id: uuid.UUID,
    db: DB,
    user: CurrentUser,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
) -> list[TeacherCourseExam]:
    is_admin = await _is_course_admin(db, user)
    await _get_visible_course(db, course_id, user=user, is_admin=is_admin, include_deleted=True)
    return await _list_course_exams(
        course_id, category="practice", db=db, user=user, is_admin=is_admin, semester_id=semester_id
    )


@router.get(
    "/{course_id}/assignment-score-summary",
    response_model=TeacherCourseAssignmentScoreSummary,
)
async def get_teacher_course_assignment_score_summary(
    course_id: uuid.UUID,
    db: DB,
    user: CurrentUser,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
) -> TeacherCourseAssignmentScoreSummary:
    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(
        db,
        course_id,
        user=user,
        is_admin=is_admin,
        include_deleted=True,
    )
    subtree = _course_subtree_cte(
        course_id,
        include_deleted_root=course.deleted_at is not None,
    )
    has_kp_in_subtree = exists().where(
        ExamQuestion.exam_id == Exam.id,
        ExamQuestion.question_id == question_knowledge_points.c.question_id,
        question_knowledge_points.c.knowledge_point_id.in_(select(subtree.c.id)),
    )
    stmt = (
        select(Exam, CourseSemester)
        .outerjoin(ExamSemesterAssignment, ExamSemesterAssignment.exam_id == Exam.id)
        .outerjoin(
            CourseSemester,
            (CourseSemester.id == ExamSemesterAssignment.course_semester_id)
            & (CourseSemester.deleted_at.is_(None)),
        )
        .where(
            Exam.deleted_at.is_(None),
            Exam.category == "practice",
            or_(Exam.course_kp_id.in_(select(subtree.c.id)), has_kp_in_subtree),
        )
        .options(selectinload(Exam.exam_students).selectinload(ExamStudent.student))
        .order_by(Exam.created_at.asc())
    )
    if semester_id is not None:
        stmt = stmt.where(ExamSemesterAssignment.course_semester_id == semester_id)
    if not is_admin:
        stmt = stmt.where(teacher_owned_resource_filter(Exam, user.id))

    rows = (await db.execute(stmt)).unique().all()
    assignment_columns: list[TeacherCourseAssignmentScoreColumn] = []
    exams_by_id: dict[uuid.UUID, Exam] = {}
    student_rows: dict[uuid.UUID, dict[str, object]] = {}
    scores_by_student: dict[uuid.UUID, dict[uuid.UUID, ExamStudent]] = {}

    for exam, semester in rows:
        exams_by_id[exam.id] = exam
        submitted_count = sum(1 for item in exam.exam_students if item.submitted_at is not None)
        assignment_columns.append(
            TeacherCourseAssignmentScoreColumn(
                id=exam.id,
                title=exam.title,
                total_score=round(float(exam.total_score or 0), 2),
                submitted_count=submitted_count,
                total_students=len(exam.exam_students),
                semester_id=semester.id if semester else None,
                semester_name=semester.name if semester else None,
                start_time=exam.start_time,
                end_time=exam.end_time,
            )
        )
        for exam_student in exam.exam_students:
            student = exam_student.student
            student_rows.setdefault(
                exam_student.student_id,
                {
                    "student_no": student.student_id if student else None,
                    "full_name": student.full_name if student else None,
                    "username": student.username if student else None,
                    "phone": student.phone if student else None,
                },
            )
            scores_by_student.setdefault(exam_student.student_id, {})[exam.id] = exam_student

    students: list[TeacherCourseAssignmentScoreStudent] = []
    for student_id, info in student_rows.items():
        student_no = info.get("student_no")
        full_name = info.get("full_name")
        username = info.get("username")
        phone = info.get("phone")
        cells: list[TeacherCourseAssignmentScoreCell] = []
        submitted_count = 0
        assignment_count = 0
        total_score = 0.0
        max_score = 0.0
        student_scores = scores_by_student.get(student_id, {})
        for column in assignment_columns:
            exam = exams_by_id[column.id]
            assigned_score = student_scores.get(column.id)
            if assigned_score is None:
                cells.append(
                    TeacherCourseAssignmentScoreCell(
                        assignment_id=column.id,
                        assigned=False,
                    )
                )
                continue

            assignment_count += 1
            possible_score = max(float(exam.total_score or 0), 0.0)
            max_score += possible_score
            raw_score = float(assigned_score.score) if assigned_score.score is not None else None
            if raw_score is not None:
                total_score += raw_score
            if assigned_score.submitted_at is not None:
                submitted_count += 1
            percent = None
            if raw_score is not None and possible_score > 0:
                percent = round(raw_score / possible_score * 100, 2)
            cells.append(
                TeacherCourseAssignmentScoreCell(
                    assignment_id=column.id,
                    assigned=True,
                    score=round(raw_score, 2) if raw_score is not None else None,
                    percent=percent,
                    submitted_at=assigned_score.submitted_at,
                    grading_status=assigned_score.grading_status,
                )
            )

        average_percent = round(total_score / max_score * 100, 2) if max_score > 0 else None
        students.append(
            TeacherCourseAssignmentScoreStudent(
                student_id=student_id,
                student_no=student_no if isinstance(student_no, str) else None,
                full_name=full_name if isinstance(full_name, str) else None,
                username=username if isinstance(username, str) else None,
                phone=phone if isinstance(phone, str) else None,
                submitted_count=submitted_count,
                assignment_count=assignment_count,
                total_score=round(total_score, 2),
                max_score=round(max_score, 2),
                average_percent=average_percent,
                cells=cells,
            )
        )

    students.sort(
        key=lambda item: (
            item.full_name or "",
            item.username or "",
            item.student_no or "",
            str(item.student_id),
        )
    )
    student_percents = [
        student.average_percent
        for student in students
        if student.average_percent is not None
    ]
    class_average_percent = (
        round(sum(student_percents) / len(student_percents), 2)
        if student_percents
        else None
    )
    return TeacherCourseAssignmentScoreSummary(
        course_id=course_id,
        semester_id=semester_id,
        assignment_count=len(assignment_columns),
        student_count=len(students),
        class_average_percent=class_average_percent,
        assignments=assignment_columns,
        students=students,
        generated_at=datetime.now(timezone.utc),
    )


@router.get("/{course_id}/questions", response_model=list[TeacherCourseQuestion])
async def list_teacher_course_questions(
    course_id: uuid.UUID,
    db: DB,
    user: CurrentUser,
    limit: Annotated[int, Query(ge=1, le=5000)] = 2000,
) -> list[TeacherCourseQuestion]:
    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(
        db,
        course_id,
        user=user,
        is_admin=is_admin,
        include_deleted=True,
    )
    default_bank = await _get_course_default_question_bank(db, course)
    if default_bank is None:
        return []

    stmt = (
        select(Question)
        .where(
            Question.deleted_at.is_(None),
            Question.question_bank_id == default_bank.id,
        )
        .options(
            selectinload(Question.creator),
            selectinload(Question.question_bank),
            selectinload(Question.tags),
            selectinload(Question.knowledge_points),
        )
        .order_by(Question.updated_at.desc())
        .limit(limit)
    )
    if not is_admin:
        stmt = stmt.where(teacher_owned_resource_filter(Question, user.id))
    questions = (await db.execute(stmt)).scalars().unique().all()
    return [await _build_question_response(db, question) for question in questions]


async def _question_ids_with_submitted_attempts(
    db: AsyncSession,
    question_ids: list[uuid.UUID],
) -> set[uuid.UUID]:
    if not question_ids:
        return set()
    stmt = (
        select(StudentExamAnswer.question_id)
        .distinct()
        .join(Exam, Exam.id == StudentExamAnswer.exam_id)
        .join(
            ExamStudent,
            and_(
                ExamStudent.exam_id == StudentExamAnswer.exam_id,
                ExamStudent.student_id == StudentExamAnswer.student_id,
            ),
        )
        .where(
            StudentExamAnswer.question_id.in_(question_ids),
            Exam.deleted_at.is_(None),
            ExamStudent.submitted_at.is_not(None),
        )
    )
    rows = await db.execute(stmt)
    return {row[0] for row in rows}


def _build_paginated_question_id_stmt(
    *,
    where_clause,
    include_question_knowledge_points: bool,
    include_knowledge_points: bool,
    page: int,
    page_size: int,
):
    """Return the ordered, deduplicated question IDs for one result page.

    PostgreSQL requires every expression used to order a ``SELECT DISTINCT``
    query to be present in its select list.  Keep ``updated_at`` in this
    intermediate query even though callers only consume the question ID.
    """
    stmt = select(Question.id, Question.updated_at).select_from(Question)
    if include_question_knowledge_points:
        stmt = stmt.join(
            question_knowledge_points, question_knowledge_points.c.question_id == Question.id
        )
    if include_knowledge_points:
        stmt = stmt.join(
            KnowledgePoint, KnowledgePoint.id == question_knowledge_points.c.knowledge_point_id
        )
    return (
        stmt.where(where_clause)
        .distinct()
        .order_by(Question.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )


@router.get("/{course_id}/questions/paginated", response_model=TeacherCourseQuestionList)
async def list_teacher_course_questions_paginated(
    course_id: uuid.UUID,
    db: DB,
    user: CurrentUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
    knowledge_point_id: Annotated[uuid.UUID | None, Query()] = None,
    types: Annotated[list[str] | None, Query()] = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
) -> TeacherCourseQuestionList:
    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(
        db,
        course_id,
        user=user,
        is_admin=is_admin,
        include_deleted=True,
    )
    default_bank = await _get_course_default_question_bank(db, course)
    if default_bank is None:
        return TeacherCourseQuestionList(items=[], total=0, type_counts={})

    q_clean = q.strip() if q else None
    kp_filter = knowledge_point_id is not None

    conditions: list = [
        Question.deleted_at.is_(None),
        Question.question_bank_id == default_bank.id,
    ]
    if not is_admin:
        conditions.append(teacher_owned_resource_filter(Question, user.id))
    if types:
        conditions.append(Question.type.in_(types))

    if kp_filter:
        subtree = _course_subtree_cte(knowledge_point_id)
        conditions.append(question_knowledge_points.c.knowledge_point_id.in_(select(subtree.c.id)))

    if q_clean:
        conditions.append(
            or_(
                Question.title.ilike(f"%{q_clean}%"),
                KnowledgePoint.name.ilike(f"%{q_clean}%"),
            )
        )

    where_clause = and_(*conditions)

    # Total count for pagination (respects all filters including types).
    count_stmt = select(func.count(func.distinct(Question.id))).select_from(Question)
    if kp_filter or q_clean:
        count_stmt = count_stmt.join(
            question_knowledge_points, question_knowledge_points.c.question_id == Question.id
        )
    if q_clean:
        count_stmt = count_stmt.join(
            KnowledgePoint, KnowledgePoint.id == question_knowledge_points.c.knowledge_point_id
        )
    count_stmt = count_stmt.where(where_clause)
    total = await db.scalar(count_stmt) or 0

    # Type counts ignore the `types` filter so the UI can show available counts.
    type_conditions: list = [
        Question.deleted_at.is_(None),
        Question.question_bank_id == default_bank.id,
    ]
    if not is_admin:
        type_conditions.append(teacher_owned_resource_filter(Question, user.id))
    if kp_filter:
        type_conditions.append(question_knowledge_points.c.knowledge_point_id.in_(select(subtree.c.id)))
    type_where = and_(*type_conditions)
    if q_clean:
        type_where = and_(
            type_where,
            or_(
                Question.title.ilike(f"%{q_clean}%"),
                KnowledgePoint.name.ilike(f"%{q_clean}%"),
            ),
        )
    type_stmt = (
        select(Question.type, func.count(func.distinct(Question.id)))
        .select_from(Question)
    )
    if kp_filter or q_clean:
        type_stmt = type_stmt.join(
            question_knowledge_points, question_knowledge_points.c.question_id == Question.id
        )
    if q_clean:
        type_stmt = type_stmt.join(
            KnowledgePoint, KnowledgePoint.id == question_knowledge_points.c.knowledge_point_id
        )
    type_stmt = type_stmt.where(type_where).group_by(Question.type)
    type_counts: dict[str, int] = {}
    for row in await db.execute(type_stmt):
        key = row[0].value if hasattr(row[0], "value") else row[0]
        type_counts[key] = row[1]

    # Paginated items. Select distinct question IDs first (so the joins used
    # for knowledge-point / search filtering do not multiply rows and shrink
    # the page below page_size), then load full rows with relationships.
    id_stmt = _build_paginated_question_id_stmt(
        where_clause=where_clause,
        include_question_knowledge_points=bool(kp_filter or q_clean),
        include_knowledge_points=bool(q_clean),
        page=page,
        page_size=page_size,
    )
    page_question_ids = list((await db.execute(id_stmt)).scalars().all())
    # SQLite can return the raw stored value (a hex string) instead of a UUID
    # object; coerce so the IN clause binds correctly.
    page_question_ids = [qid if isinstance(qid, uuid.UUID) else uuid.UUID(str(qid)) for qid in page_question_ids]

    questions: list = []
    if page_question_ids:
        items_stmt = (
            select(Question)
            .options(
                selectinload(Question.creator),
                selectinload(Question.question_bank),
                selectinload(Question.tags),
                selectinload(Question.knowledge_points),
            )
            .where(Question.id.in_(page_question_ids))
            .order_by(Question.updated_at.desc())
        )
        questions = list((await db.execute(items_stmt)).scalars().unique().all())

    submitted_ids = await _question_ids_with_submitted_attempts(db, [question.id for question in questions])
    items: list[TeacherCourseQuestion] = []
    for question in questions:
        in_use = question.id in submitted_ids
        edit_lock = QuestionEditLockInfo(
            in_use=in_use,
            allowed_fields=IN_USE_ALLOWED_FIELDS if in_use else [],
            regrade_on_fields=IN_USE_REGRADE_FIELDS if in_use else [],
            has_submitted_attempts=in_use,
        )
        response = QuestionResponse.from_question(question, edit_lock=edit_lock)
        items.append(TeacherCourseQuestion.model_validate(response))

    return TeacherCourseQuestionList(items=items, total=total, type_counts=type_counts)


@router.post(
    "/{course_id}/questions/complete-knowledge",
    response_model=CourseQuestionKnowledgeCompleteResponse,
    status_code=status.HTTP_201_CREATED,
)
async def complete_teacher_course_question_knowledge(
    course_id: uuid.UUID,
    body: CourseQuestionKnowledgeCompleteRequest,
    background_tasks: BackgroundTasks,
    db: DB,
    user: CurrentUser,
) -> CourseQuestionKnowledgeCompleteResponse:
    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(
        db,
        course_id,
        user=user,
        is_admin=is_admin,
        include_deleted=False,
    )
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=course.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权修改该课程")

    default_bank = await _get_course_default_question_bank(db, course)
    requested_ids = list(dict.fromkeys(body.question_ids))
    questions: list[Question] = []
    if default_bank is not None:
        stmt = (
            select(Question)
            .where(
                Question.deleted_at.is_(None),
                Question.question_bank_id == default_bank.id,
            )
            .options(selectinload(Question.knowledge_points))
            .order_by(Question.updated_at.desc())
        )
        if requested_ids:
            stmt = stmt.where(Question.id.in_(requested_ids))
        if not is_admin:
            stmt = stmt.where(teacher_owned_resource_filter(Question, user.id))
        questions = list((await db.execute(stmt)).scalars().unique().all())

    found_ids = {question.id for question in questions}
    missing_ids = [question_id for question_id in requested_ids if question_id not in found_ids]
    if missing_ids:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部分题目不属于当前课程或无权访问")

    question_ids = [question.id for question in questions]
    job = await create_question_import_job(db, user_id=user.id, total_count=len(question_ids))
    job.created_question_ids = [str(question_id) for question_id in question_ids]
    if question_ids:
        background_tasks.add_task(
            process_existing_question_knowledge_match_job,
            job_id=job.id,
            user_id=user.id,
            root_knowledge_point_id=course.id,
            question_ids=question_ids,
        )
    else:
        job.status = QuestionImportJobStatus.COMPLETED
        job.completed_at = datetime.now(timezone.utc)
    await db.commit()
    return CourseQuestionKnowledgeCompleteResponse(
        job_id=job.id,
        total_count=len(question_ids),
        question_ids=question_ids,
    )


@router.delete("/{course_id}/questions", status_code=status.HTTP_200_OK)
async def clear_teacher_course_questions(
    course_id: uuid.UUID, db: DB, user: CurrentUser
) -> dict[str, int]:
    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(
        db,
        course_id,
        user=user,
        is_admin=is_admin,
        include_deleted=False,
    )
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=course.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权修改该课程")

    default_bank = await _get_course_default_question_bank(db, course)
    if default_bank is None:
        return {"deleted": 0, "hard_deleted": 0, "soft_deleted": 0}

    stmt = (
        select(Question)
        .where(
            Question.deleted_at.is_(None),
            Question.question_bank_id == default_bank.id,
        )
    )
    if not is_admin:
        stmt = stmt.where(teacher_owned_resource_filter(Question, user.id))

    questions = (await db.execute(stmt)).scalars().unique().all()
    hard_deleted = 0
    soft_deleted = 0
    for question in questions:
        if await can_hard_delete_question(db, question.id):
            await db.delete(question)
            hard_deleted += 1
        else:
            await soft_delete_question(db, question)
            soft_deleted += 1

    await db.commit()
    return {
        "deleted": hard_deleted + soft_deleted,
        "hard_deleted": hard_deleted,
        "soft_deleted": soft_deleted,
    }


@router.get("/{course_id}/knowledge-tree", response_model=CourseKnowledgeNode)
async def get_teacher_course_knowledge_tree(course_id: uuid.UUID, db: DB, user: CurrentUser) -> CourseKnowledgeNode:
    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(
        db,
        course_id,
        user=user,
        is_admin=is_admin,
        include_deleted=True,
    )
    subtree = _course_subtree_cte(course_id, include_deleted_root=course.deleted_at is not None)
    subtree_ids = select(subtree.c.id)
    default_bank = await _get_course_default_question_bank(db, course)

    nodes = (
        await db.execute(
            select(KnowledgePoint)
            .where(KnowledgePoint.id.in_(subtree_ids))
            .order_by(KnowledgePoint.sort_order, KnowledgePoint.created_at)
        )
    ).scalars().all()

    q_rows = []
    if default_bank is not None:
        q_rows = (
            await db.execute(
                select(question_knowledge_points.c.knowledge_point_id, func.count(func.distinct(Question.id)))
                .select_from(question_knowledge_points)
                .join(Question, Question.id == question_knowledge_points.c.question_id)
                .where(
                    Question.deleted_at.is_(None),
                    Question.question_bank_id == default_bank.id,
                    question_knowledge_points.c.knowledge_point_id.in_(subtree_ids),
                )
                .group_by(question_knowledge_points.c.knowledge_point_id)
            )
        ).all()
    q_direct = {kp_id: count for kp_id, count in q_rows}

    m_rows = (
        await db.execute(
            select(LearningResource.node_id, func.count(LearningResource.id))
            .where(LearningResource.node_type == "kp", LearningResource.node_id.in_(subtree_ids))
            .group_by(LearningResource.node_id)
        )
    ).all()
    m_direct = {node_id: count for node_id, count in m_rows}

    children_map: dict[uuid.UUID | None, list[KnowledgePoint]] = {}
    for kp in nodes:
        children_map.setdefault(kp.parent_id, []).append(kp)

    def build(kp: KnowledgePoint) -> CourseKnowledgeNode:
        children = [build(child) for child in children_map.get(kp.id, [])]
        return CourseKnowledgeNode(
            id=kp.id,
            name=kp.name,
            question_count=q_direct.get(kp.id, 0) + sum(child.question_count for child in children),
            material_count=m_direct.get(kp.id, 0) + sum(child.material_count for child in children),
            children=children,
        )

    return build(course)


@router.delete(
    "/{course_id}/knowledge-points",
    status_code=status.HTTP_200_OK,
)
async def clear_course_knowledge_points(
    course_id: uuid.UUID, db: DB, user: CurrentUser
) -> dict[str, int]:
    """Delete every knowledge point under the course, keeping the course root itself.

    Direct children are removed; the `parent_id` cascade clears descendants at the DB level.
    LearningResource rows attached via polymorphic `node_id` are not foreign-keyed and follow
    the same fate as the single-KP delete path — left alone.
    """

    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(db, course_id, user=user, is_admin=is_admin)
    if not can_write_owned_resource(
        is_platform_admin=is_admin,
        current_user_id=user.id,
        owner_id=course.owner_id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权修改该课程")

    children = (
        await db.execute(
            select(KnowledgePoint).where(
                KnowledgePoint.parent_id == course.id,
                KnowledgePoint.deleted_at.is_(None),
            )
        )
    ).scalars().all()

    for child in children:
        await db.delete(child)
    await db.commit()
    return {"deleted": len(children)}


# ── Semesters ───────────────────────────────────────────────────────────────


async def _semester_counts(db: AsyncSession, semester_id: uuid.UUID) -> tuple[int, int]:
    """Return (exam_count, assignment_count) pinned to this semester."""

    stmt = (
        select(Exam.category, func.count(Exam.id))
        .join(ExamSemesterAssignment, ExamSemesterAssignment.exam_id == Exam.id)
        .where(
            ExamSemesterAssignment.course_semester_id == semester_id,
            Exam.deleted_at.is_(None),
        )
        .group_by(Exam.category)
    )
    rows = (await db.execute(stmt)).all()
    by_cat = {category: count for category, count in rows}
    return by_cat.get("exam", 0), by_cat.get("practice", 0)


def _semester_to_response(
    semester: CourseSemester, exam_count: int, assignment_count: int
) -> CourseSemesterResponse:
    return CourseSemesterResponse(
        id=semester.id,
        course_id=semester.course_id,
        name=semester.name,
        description=semester.description,
        semester_major_label=semester.semester_major_label,
        semester_major_description=semester.semester_major_description,
        class_ids=semester.class_ids or [],
        start_date=semester.start_date,
        end_date=semester.end_date,
        student_profile=semester.student_profile,
        exam_count=exam_count,
        assignment_count=assignment_count,
        created_at=semester.created_at,
        updated_at=semester.updated_at,
    )


@router.get("/{course_id}/semesters", response_model=list[CourseSemesterResponse])
async def list_course_semesters(
    course_id: uuid.UUID, db: DB, user: CurrentUser
) -> list[CourseSemesterResponse]:
    is_admin = await _is_course_admin(db, user)
    await _get_visible_course(db, course_id, user=user, is_admin=is_admin, include_deleted=True)
    stmt = (
        select(CourseSemester)
        .where(CourseSemester.course_id == course_id, CourseSemester.deleted_at.is_(None))
        .order_by(
            CourseSemester.start_date.desc().nullslast(),
            CourseSemester.created_at.desc(),
        )
    )
    semesters = (await db.execute(stmt)).scalars().all()
    return [
        _semester_to_response(semester, *(await _semester_counts(db, semester.id)))
        for semester in semesters
    ]


@router.post(
    "/{course_id}/semesters",
    response_model=CourseSemesterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_course_semester(
    course_id: uuid.UUID,
    payload: CourseSemesterCreate,
    db: DB,
    user: CurrentUser,
) -> CourseSemesterResponse:
    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(db, course_id, user=user, is_admin=is_admin)
    if not is_admin and course.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权为该课程新建学期")

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="学期名称不能为空")
    if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="结束日期不能早于开始日期")

    dupe_stmt = select(CourseSemester.id).where(
        CourseSemester.course_id == course_id,
        CourseSemester.name == name,
        CourseSemester.deleted_at.is_(None),
    )
    if (await db.execute(dupe_stmt)).scalar_one_or_none() is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="同名学期已存在")

    semester = CourseSemester(
        course_id=course_id,
        name=name,
        description=payload.description,
        semester_major_label=payload.semester_major_label.strip() if payload.semester_major_label else None,
        semester_major_description=payload.semester_major_description,
        class_ids=[str(class_id) for class_id in payload.class_ids],
        start_date=payload.start_date,
        end_date=payload.end_date,
        student_profile=payload.student_profile,
        owner_id=user.id,
    )
    db.add(semester)
    await db.commit()
    await db.refresh(semester)
    return _semester_to_response(semester, 0, 0)


@router.patch(
    "/{course_id}/semesters/{semester_id}/classes",
    response_model=CourseSemesterResponse,
)
async def update_course_semester_classes(
    course_id: uuid.UUID,
    semester_id: uuid.UUID,
    payload: CourseSemesterClassesUpdate,
    db: DB,
    user: CurrentUser,
) -> CourseSemesterResponse:
    """更新某个学期关联的班级（从学生管理的班级列表里选择）。"""
    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(db, course_id, user=user, is_admin=is_admin)
    if not is_admin and course.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权修改该课程的学期")

    stmt = select(CourseSemester).where(
        CourseSemester.id == semester_id,
        CourseSemester.course_id == course_id,
        CourseSemester.deleted_at.is_(None),
    )
    semester = (await db.execute(stmt)).scalar_one_or_none()
    if semester is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="学期不存在")

    semester.class_ids = [str(class_id) for class_id in payload.class_ids]
    await db.commit()
    await db.refresh(semester)
    exam_count, assignment_count = await _semester_counts(db, semester.id)
    return _semester_to_response(semester, exam_count, assignment_count)


COURSE_GRADE_COMPONENTS = (
    "chapter_task",
    "chapter_quiz",
    "assignment",
    "exam",
)


def _course_grade_context_key(semester_id: uuid.UUID | None) -> str:
    return str(semester_id) if semester_id is not None else "all"


async def _get_course_grade_students(
    *,
    db: AsyncSession,
    course_id: uuid.UUID,
    semester_id: uuid.UUID | None,
    user: User,
    is_admin: bool,
) -> tuple[KnowledgePoint, list[CourseSemester], list[tuple[User, Class]]]:
    course, *_ = await _get_visible_course(
        db,
        course_id,
        user=user,
        is_admin=is_admin,
        include_deleted=True,
    )
    if not is_admin and course.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权查看该课程的学生成绩")

    semester_stmt = select(CourseSemester).where(
        CourseSemester.course_id == course_id,
        CourseSemester.deleted_at.is_(None),
    )
    if semester_id is not None:
        semester_stmt = semester_stmt.where(CourseSemester.id == semester_id)
    semesters = list((await db.execute(semester_stmt)).scalars().all())
    if semester_id is not None and not semesters:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="学期不存在")

    class_ids: set[uuid.UUID] = set()
    for semester in semesters:
        for raw_class_id in semester.class_ids or []:
            try:
                class_ids.add(uuid.UUID(str(raw_class_id)))
            except ValueError:
                continue
    if not class_ids:
        return course, semesters, []

    student_stmt = (
        select(User, Class)
        .join(Class, User.class_id == Class.id)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .join(Role, Role.id == UserOrganization.role_id)
        .where(
            User.class_id.in_(class_ids),
            User.deleted_at.is_(None),
            Class.deleted_at.is_(None),
            Role.name.in_(("student", "assessee")),
            UserOrganization.org_id == Class.org_id,
        )
        .order_by(Class.name, User.full_name, User.student_id, User.username)
    )
    if not is_admin:
        student_stmt = student_stmt.join(
            TeacherStudent,
            (TeacherStudent.student_id == User.id)
            & (TeacherStudent.teacher_id == user.id),
        )
    student_rows = list((await db.execute(student_stmt)).unique().all())
    return course, semesters, student_rows


async def _build_course_grade_summary(
    *,
    db: AsyncSession,
    course_id: uuid.UUID,
    semester_id: uuid.UUID | None,
    user: User,
    is_admin: bool,
) -> CourseGradeSummary:
    course, _semesters, student_rows = await _get_course_grade_students(
        db=db,
        course_id=course_id,
        semester_id=semester_id,
        user=user,
        is_admin=is_admin,
    )
    weight_row = (
        await db.execute(
            select(CourseGradeWeight).where(CourseGradeWeight.course_id == course_id)
        )
    ).scalar_one_or_none()
    weights = CourseGradeWeights(**((weight_row.weights if weight_row else {}) or {}))

    students_by_id = {student.id: (student, class_row) for student, class_row in student_rows}
    student_ids = list(students_by_id)
    system_totals: dict[uuid.UUID, dict[str, list[float]]] = {
        student_id: {"assignment": [0.0, 0.0], "exam": [0.0, 0.0]}
        for student_id in student_ids
    }

    if student_ids:
        subtree = _course_subtree_cte(
            course_id,
            include_deleted_root=course.deleted_at is not None,
        )
        has_kp_in_subtree = exists().where(
            ExamQuestion.exam_id == Exam.id,
            ExamQuestion.question_id == question_knowledge_points.c.question_id,
            question_knowledge_points.c.knowledge_point_id.in_(select(subtree.c.id)),
        )
        exam_stmt = (
            select(Exam)
            .outerjoin(ExamSemesterAssignment, ExamSemesterAssignment.exam_id == Exam.id)
            .where(
                Exam.deleted_at.is_(None),
                Exam.category.in_(("practice", "exam")),
                or_(Exam.course_kp_id.in_(select(subtree.c.id)), has_kp_in_subtree),
            )
            .options(selectinload(Exam.exam_students))
        )
        if semester_id is not None:
            exam_stmt = exam_stmt.where(
                ExamSemesterAssignment.course_semester_id == semester_id
            )
        if not is_admin:
            exam_stmt = exam_stmt.where(teacher_owned_resource_filter(Exam, user.id))
        course_exams = list((await db.execute(exam_stmt)).scalars().unique().all())

        for exam in course_exams:
            component = "assignment" if exam.category == "practice" else "exam"
            possible_score = max(float(exam.total_score or 0), 0.0)
            if possible_score <= 0:
                continue
            for exam_student in exam.exam_students:
                if exam_student.student_id not in system_totals:
                    continue
                earned_score = float(exam_student.score or 0)
                system_totals[exam_student.student_id][component][0] += earned_score
                system_totals[exam_student.student_id][component][1] += possible_score

    manual_by_student: dict[uuid.UUID, dict[str, float]] = {}
    if student_ids:
        manual_rows = list(
            (
                await db.execute(
                    select(CourseStudentGrade).where(
                        CourseStudentGrade.course_id == course_id,
                        CourseStudentGrade.student_id.in_(student_ids),
                    )
                )
            ).scalars().all()
        )
        context_key = _course_grade_context_key(semester_id)
        for row in manual_rows:
            context_scores = (row.semester_scores or {}).get(context_key, {})
            if isinstance(context_scores, dict):
                manual_by_student[row.student_id] = context_scores

    grade_students: list[CourseGradeStudent] = []
    class_counts: dict[uuid.UUID, tuple[str, int]] = {}
    for student, class_row in student_rows:
        class_name, class_count = class_counts.get(class_row.id, (class_row.name, 0))
        class_counts[class_row.id] = (class_name, class_count + 1)
        manual_scores = manual_by_student.get(student.id, {})
        component_values: dict[str, CourseGradeComponent] = {}
        for component in COURSE_GRADE_COMPONENTS:
            system_score = None
            if component in ("assignment", "exam"):
                earned, possible = system_totals[student.id][component]
                if possible > 0:
                    system_score = round(earned / possible * 100, 2)
            manual_value = manual_scores.get(component)
            manual_score = (
                round(float(manual_value), 2)
                if isinstance(manual_value, (int, float))
                else None
            )
            effective_score = manual_score if manual_score is not None else system_score
            component_values[component] = CourseGradeComponent(
                score=effective_score,
                system_score=system_score,
                manual_score=manual_score,
                source=(
                    "manual"
                    if manual_score is not None
                    else "system"
                    if system_score is not None
                    else "none"
                ),
            )

        comprehensive_score = round(
            sum(
                (component_values[component].score or 0)
                * float(getattr(weights, component))
                / 100
                for component in COURSE_GRADE_COMPONENTS
            ),
            2,
        )
        grade_students.append(
            CourseGradeStudent(
                student_id=student.id,
                student_no=student.student_id,
                full_name=student.full_name,
                username=student.username,
                class_id=class_row.id,
                class_name=class_row.name,
                chapter_task=component_values["chapter_task"],
                chapter_quiz=component_values["chapter_quiz"],
                assignment=component_values["assignment"],
                exam=component_values["exam"],
                comprehensive_score=comprehensive_score,
            )
        )

    scores = [student.comprehensive_score for student in grade_students]
    class_average = round(sum(scores) / len(scores), 2) if scores else None
    distribution = CourseGradeDistribution(
        excellent=sum(1 for score in scores if score >= 80),
        passing=sum(1 for score in scores if 60 <= score < 80),
        needs_attention=sum(1 for score in scores if score < 60),
    )
    classes = [
        CourseGradeClass(id=class_id, name=name, student_count=count)
        for class_id, (name, count) in sorted(
            class_counts.items(), key=lambda item: item[1][0]
        )
    ]
    return CourseGradeSummary(
        course_id=course_id,
        semester_id=semester_id,
        weights=weights,
        class_average_score=class_average,
        student_count=len(grade_students),
        classes=classes,
        distribution=distribution,
        students=grade_students,
        generated_at=datetime.now(timezone.utc),
    )


@router.get("/{course_id}/grade-summary", response_model=CourseGradeSummary)
async def get_course_grade_summary(
    course_id: uuid.UUID,
    db: DB,
    user: CurrentUser,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
) -> CourseGradeSummary:
    is_admin = await _is_course_admin(db, user)
    return await _build_course_grade_summary(
        db=db,
        course_id=course_id,
        semester_id=semester_id,
        user=user,
        is_admin=is_admin,
    )


MASTERY_SAMPLE_THRESHOLD = 3
MASTERY_WEAK_ACCURACY = 60.0
MASTERY_CONSISTENCY_GAP = 25.0


def _percent(score: float, maximum: float) -> float | None:
    if maximum <= 0:
        return None
    return round(score / maximum * 100, 2)


def _variance(values: list[float]) -> float | None:
    if len(values) < 2:
        return None
    mean = sum(values) / len(values)
    return round(sum((value - mean) ** 2 for value in values) / len(values), 2)


def _empty_mastery_bucket() -> dict[str, object]:
    return {
        "score": 0.0,
        "max": 0.0,
        "attempts": 0,
        "questions": set(),
        "practice_score": 0.0,
        "practice_max": 0.0,
        "exam_score": 0.0,
        "exam_max": 0.0,
    }


def _add_mastery_attempt(
    bucket: dict[str, object],
    *,
    score: float,
    maximum: float,
    category: str,
    question_id: uuid.UUID | None = None,
) -> None:
    bucket["score"] = float(bucket["score"]) + score
    bucket["max"] = float(bucket["max"]) + maximum
    bucket["attempts"] = int(bucket["attempts"]) + 1
    if question_id is not None:
        questions = bucket["questions"]
        if isinstance(questions, set):
            questions.add(question_id)
    if category == "practice":
        bucket["practice_score"] = float(bucket["practice_score"]) + score
        bucket["practice_max"] = float(bucket["practice_max"]) + maximum
    else:
        bucket["exam_score"] = float(bucket["exam_score"]) + score
        bucket["exam_max"] = float(bucket["exam_max"]) + maximum


def _bucket_question_count(bucket: dict[str, object]) -> int:
    questions = bucket["questions"]
    return len(questions) if isinstance(questions, set) else 0


def _bucket_snapshot(bucket: dict[str, object]) -> dict[str, object]:
    accuracy = _percent(float(bucket["score"]), float(bucket["max"]))
    practice_accuracy = _percent(float(bucket["practice_score"]), float(bucket["practice_max"]))
    exam_accuracy = _percent(float(bucket["exam_score"]), float(bucket["exam_max"]))
    trend_delta = (
        round(exam_accuracy - practice_accuracy, 2)
        if exam_accuracy is not None and practice_accuracy is not None
        else None
    )
    return {
        "score": round(float(bucket["score"]), 2),
        "max": round(float(bucket["max"]), 2),
        "attempts": int(bucket["attempts"]),
        "question_count": _bucket_question_count(bucket),
        "accuracy": accuracy,
        "practice_accuracy": practice_accuracy,
        "exam_accuracy": exam_accuracy,
        "trend_delta": trend_delta,
    }


async def _build_course_mastery_summary(
    *,
    db: AsyncSession,
    course_id: uuid.UUID,
    semester_id: uuid.UUID | None,
    user: User,
    is_admin: bool,
) -> CourseMasterySummary:
    course, _semesters, roster_rows = await _get_course_grade_students(
        db=db,
        course_id=course_id,
        semester_id=semester_id,
        user=user,
        is_admin=is_admin,
    )

    subtree = _course_subtree_cte(
        course_id,
        include_deleted_root=course.deleted_at is not None,
    )
    subtree_ids = select(subtree.c.id)
    nodes = list(
        (
            await db.execute(
                select(KnowledgePoint)
                .where(KnowledgePoint.id.in_(subtree_ids))
                .order_by(KnowledgePoint.sort_order, KnowledgePoint.created_at)
            )
        )
        .scalars()
        .all()
    )
    node_by_id = {node.id: node for node in nodes}
    node_ids = set(node_by_id)
    children_map: dict[uuid.UUID | None, list[KnowledgePoint]] = {}
    for node in nodes:
        children_map.setdefault(node.parent_id, []).append(node)

    depth_by_id: dict[uuid.UUID, int] = {}

    def mark_depth(node: KnowledgePoint, depth: int) -> None:
        depth_by_id[node.id] = depth
        for child in children_map.get(node.id, []):
            mark_depth(child, depth + 1)

    if course.id in node_by_id:
        mark_depth(node_by_id[course.id], 0)

    has_kp_in_subtree = exists().where(
        ExamQuestion.exam_id == Exam.id,
        ExamQuestion.question_id == question_knowledge_points.c.question_id,
        question_knowledge_points.c.knowledge_point_id.in_(select(subtree.c.id)),
    )
    exam_stmt = (
        select(Exam)
        .outerjoin(ExamSemesterAssignment, ExamSemesterAssignment.exam_id == Exam.id)
        .where(
            Exam.deleted_at.is_(None),
            Exam.category.in_(("practice", "exam")),
            or_(Exam.course_kp_id.in_(select(subtree.c.id)), has_kp_in_subtree),
        )
        .options(selectinload(Exam.exam_questions))
    )
    if semester_id is not None:
        exam_stmt = exam_stmt.where(ExamSemesterAssignment.course_semester_id == semester_id)
    if not is_admin:
        exam_stmt = exam_stmt.where(teacher_owned_resource_filter(Exam, user.id))
    course_exams = list((await db.execute(exam_stmt)).scalars().unique().all())
    exam_ids = [exam.id for exam in course_exams]

    student_profiles: dict[uuid.UUID, dict[str, str | None]] = {
        student.id: {
            "student_no": student.student_id,
            "full_name": student.full_name,
            "username": student.username,
            "class_name": class_row.name,
        }
        for student, class_row in roster_rows
    }

    direct_unit_totals: dict[uuid.UUID, dict[str, object]] = {}
    student_unit_totals: dict[uuid.UUID, dict[uuid.UUID, dict[str, object]]] = {}
    student_overall: dict[uuid.UUID, dict[str, object]] = {}
    question_totals: dict[uuid.UUID, dict[str, object]] = {}
    question_student_totals: dict[uuid.UUID, dict[uuid.UUID, dict[str, object]]] = {}
    question_unit: dict[uuid.UUID, uuid.UUID] = {}
    overall_bucket = _empty_mastery_bucket()

    if exam_ids:
        answer_rows = (
            await db.execute(
                select(
                    StudentExamSubmissionAnswer,
                    Exam.category,
                    Exam.course_kp_id,
                    ExamQuestion.score_override,
                    Question,
                    User,
                    Class,
                )
                .join(
                    ExamStudent,
                    and_(
                        ExamStudent.exam_id == StudentExamSubmissionAnswer.exam_id,
                        ExamStudent.student_id == StudentExamSubmissionAnswer.student_id,
                        ExamStudent.latest_submission_id == StudentExamSubmissionAnswer.submission_id,
                    ),
                )
                .join(Exam, Exam.id == StudentExamSubmissionAnswer.exam_id)
                .join(
                    ExamQuestion,
                    and_(
                        ExamQuestion.exam_id == StudentExamSubmissionAnswer.exam_id,
                        ExamQuestion.question_id == StudentExamSubmissionAnswer.question_id,
                    ),
                )
                .join(Question, Question.id == StudentExamSubmissionAnswer.question_id)
                .join(User, User.id == StudentExamSubmissionAnswer.student_id)
                .outerjoin(Class, Class.id == User.class_id)
                .where(
                    StudentExamSubmissionAnswer.exam_id.in_(exam_ids),
                    Question.deleted_at.is_(None),
                )
                .options(selectinload(Question.knowledge_points))
            )
        ).all()

        for answer, category, exam_course_kp_id, score_override, question, student, class_row in answer_rows:
            maximum = float(score_override if score_override is not None else question.score or 0)
            if maximum <= 0:
                continue
            score = max(0.0, min(float(answer.score_awarded or 0), maximum))
            linked_unit_ids = [
                kp.id
                for kp in question.knowledge_points or []
                if kp.id in node_ids
            ]
            if not linked_unit_ids and exam_course_kp_id in node_ids:
                linked_unit_ids = [exam_course_kp_id]
            if not linked_unit_ids and course_id in node_ids:
                linked_unit_ids = [course_id]

            student_profiles.setdefault(
                student.id,
                {
                    "student_no": student.student_id,
                    "full_name": student.full_name,
                    "username": student.username,
                    "class_name": class_row.name if class_row else None,
                },
            )
            _add_mastery_attempt(
                overall_bucket,
                score=score,
                maximum=maximum,
                category=category,
                question_id=question.id,
            )
            _add_mastery_attempt(
                student_overall.setdefault(student.id, _empty_mastery_bucket()),
                score=score,
                maximum=maximum,
                category=category,
                question_id=question.id,
            )
            question_bucket = question_totals.setdefault(
                question.id,
                {
                    **_empty_mastery_bucket(),
                    "title": question.title,
                    "question_type": question.type.value if hasattr(question.type, "value") else str(question.type),
                },
            )
            _add_mastery_attempt(
                question_bucket,
                score=score,
                maximum=maximum,
                category=category,
                question_id=question.id,
            )
            _add_mastery_attempt(
                question_student_totals.setdefault(question.id, {}).setdefault(
                    student.id,
                    _empty_mastery_bucket(),
                ),
                score=score,
                maximum=maximum,
                category=category,
                question_id=question.id,
            )

            for unit_id in linked_unit_ids:
                question_unit.setdefault(question.id, unit_id)
                _add_mastery_attempt(
                    direct_unit_totals.setdefault(unit_id, _empty_mastery_bucket()),
                    score=score,
                    maximum=maximum,
                    category=category,
                    question_id=question.id,
                )
                _add_mastery_attempt(
                    student_unit_totals.setdefault(student.id, {}).setdefault(
                        unit_id,
                        _empty_mastery_bucket(),
                    ),
                    score=score,
                    maximum=maximum,
                    category=category,
                    question_id=question.id,
                )

    student_accuracy_rank = {
        student_id: _percent(float(bucket["score"]), float(bucket["max"]))
        for student_id, bucket in student_overall.items()
        if float(bucket["max"]) > 0
    }
    ranked_student_ids = [
        student_id
        for student_id, _accuracy in sorted(
            student_accuracy_rank.items(),
            key=lambda item: item[1] if item[1] is not None else -1,
            reverse=True,
        )
    ]
    split_size = max(1, round(len(ranked_student_ids) * 0.27)) if len(ranked_student_ids) >= 2 else 0
    high_student_ids = set(ranked_student_ids[:split_size])
    low_student_ids = set(ranked_student_ids[-split_size:]) if split_size else set()

    def group_question_accuracy(question_id: uuid.UUID, student_ids: set[uuid.UUID]) -> float | None:
        score = 0.0
        maximum = 0.0
        for student_id in student_ids:
            bucket = question_student_totals.get(question_id, {}).get(student_id)
            if not bucket:
                continue
            score += float(bucket["score"])
            maximum += float(bucket["max"])
        return _percent(score, maximum)

    question_models: list[CourseMasteryQuestion] = []
    question_accuracies_by_unit: dict[uuid.UUID, list[float]] = {}
    for question_id, bucket in question_totals.items():
        unit_id = question_unit.get(question_id)
        unit = node_by_id.get(unit_id) if unit_id is not None else None
        snapshot = _bucket_snapshot(bucket)
        accuracy = snapshot["accuracy"]
        if unit_id is not None and isinstance(accuracy, float):
            question_accuracies_by_unit.setdefault(unit_id, []).append(accuracy)
        high_accuracy = group_question_accuracy(question_id, high_student_ids)
        low_accuracy = group_question_accuracy(question_id, low_student_ids)
        discrimination = (
            round(high_accuracy - low_accuracy, 2)
            if high_accuracy is not None and low_accuracy is not None
            else None
        )
        question_models.append(
            CourseMasteryQuestion(
                id=question_id,
                title=str(bucket.get("title") or "未命名题目"),
                question_type=str(bucket.get("question_type") or ""),
                unit_id=unit_id,
                unit_name=unit.name if unit else None,
                attempt_count=int(snapshot["attempts"]),
                score_total=float(snapshot["score"]),
                max_score_total=float(snapshot["max"]),
                accuracy=accuracy if isinstance(accuracy, float) else None,
                discrimination=discrimination,
            )
        )

    unit_cache: dict[uuid.UUID, dict[str, object]] = {}

    def weighted(items: list[dict[str, object]], key: str) -> float | None:
        total_weight = 0
        total_value = 0.0
        for item in items:
            value = item.get(key)
            if not isinstance(value, (int, float)):
                continue
            weight = int(item.get("question_count") or item.get("attempts") or 0)
            if weight <= 0:
                continue
            total_weight += weight
            total_value += float(value) * weight
        return round(total_value / total_weight, 2) if total_weight > 0 else None

    def unit_aggregate(unit_id: uuid.UUID) -> dict[str, object]:
        if unit_id in unit_cache:
            return unit_cache[unit_id]
        direct = _bucket_snapshot(
            direct_unit_totals.get(unit_id, _empty_mastery_bucket())
        )
        child_items = [
            unit_aggregate(child.id)
            for child in children_map.get(unit_id, [])
        ]
        child_items_with_data = [
            item
            for item in child_items
            if float(item.get("max") or 0) > 0 or int(item.get("question_count") or 0) > 0
        ]
        if child_items_with_data:
            accuracy = weighted(child_items_with_data, "accuracy")
            practice_accuracy = weighted(child_items_with_data, "practice_accuracy")
            exam_accuracy = weighted(child_items_with_data, "exam_accuracy")
            trend_delta = (
                round(exam_accuracy - practice_accuracy, 2)
                if exam_accuracy is not None and practice_accuracy is not None
                else None
            )
            child_accuracies = [
                float(item["accuracy"])
                for item in child_items_with_data
                if isinstance(item.get("accuracy"), (int, float))
            ]
            aggregate = {
                "score": round(sum(float(item.get("score") or 0) for item in child_items_with_data), 2),
                "max": round(sum(float(item.get("max") or 0) for item in child_items_with_data), 2),
                "attempts": sum(int(item.get("attempts") or 0) for item in child_items_with_data),
                "question_count": sum(int(item.get("question_count") or 0) for item in child_items_with_data),
                "accuracy": accuracy,
                "practice_accuracy": practice_accuracy,
                "exam_accuracy": exam_accuracy,
                "trend_delta": trend_delta,
                "variance": _variance(child_accuracies),
            }
        else:
            direct_accuracies = question_accuracies_by_unit.get(unit_id, [])
            aggregate = {
                **direct,
                "variance": _variance(direct_accuracies),
            }
        unit_cache[unit_id] = aggregate
        return aggregate

    def unit_model(unit_id: uuid.UUID) -> CourseMasteryUnit:
        node = node_by_id[unit_id]
        parent = node_by_id.get(node.parent_id)
        aggregate = unit_aggregate(unit_id)
        question_count = int(aggregate.get("question_count") or 0)
        return CourseMasteryUnit(
            id=node.id,
            name=node.name,
            parent_id=node.parent_id,
            parent_name=parent.name if parent else None,
            depth=depth_by_id.get(node.id, 0),
            is_leaf=len(children_map.get(node.id, [])) == 0,
            question_count=question_count,
            attempt_count=int(aggregate.get("attempts") or 0),
            score_total=float(aggregate.get("score") or 0),
            max_score_total=float(aggregate.get("max") or 0),
            accuracy=aggregate.get("accuracy") if isinstance(aggregate.get("accuracy"), float) else None,
            practice_accuracy=aggregate.get("practice_accuracy") if isinstance(aggregate.get("practice_accuracy"), float) else None,
            exam_accuracy=aggregate.get("exam_accuracy") if isinstance(aggregate.get("exam_accuracy"), float) else None,
            trend_delta=aggregate.get("trend_delta") if isinstance(aggregate.get("trend_delta"), float) else None,
            variance=aggregate.get("variance") if isinstance(aggregate.get("variance"), float) else None,
            sample_insufficient=question_count < MASTERY_SAMPLE_THRESHOLD,
        )

    display_unit_ids = [node.id for node in nodes if node.id != course_id] or [course_id]
    unit_models = [unit_model(unit_id) for unit_id in display_unit_ids]
    unit_models.sort(
        key=lambda item: (
            item.accuracy is None,
            item.accuracy if item.accuracy is not None else 101,
            item.depth,
            item.name,
        )
    )

    def report_columns_for(unit_id: uuid.UUID) -> list[uuid.UUID]:
        children = children_map.get(unit_id, [])
        if not children:
            return [unit_id]
        result: list[uuid.UUID] = []
        for child in children:
            child_columns = report_columns_for(child.id)
            child_has_data = any(float(unit_aggregate(column_id).get("max") or 0) > 0 for column_id in child_columns)
            if child_has_data:
                result.extend(child_columns)
            elif float(unit_aggregate(child.id).get("max") or 0) > 0:
                result.append(child.id)
            else:
                result.extend(child_columns)
        return result

    matrix_column_ids = report_columns_for(course_id) if course_id in node_by_id else display_unit_ids
    if not matrix_column_ids:
        matrix_column_ids = display_unit_ids
    seen_columns: set[uuid.UUID] = set()
    matrix_column_ids = [
        unit_id
        for unit_id in matrix_column_ids
        if unit_id in node_by_id and not (unit_id in seen_columns or seen_columns.add(unit_id))
    ]
    matrix_columns = [unit_model(unit_id) for unit_id in matrix_column_ids]

    students: list[CourseMasteryStudent] = []
    for student_id, profile in student_profiles.items():
        cells: list[CourseMasteryMatrixCell] = []
        cell_accuracies: list[float] = []
        weak_units: list[tuple[str, float]] = []
        consistency_alerts: list[str] = []
        for unit in matrix_columns:
            bucket = student_unit_totals.get(student_id, {}).get(unit.id, _empty_mastery_bucket())
            snapshot = _bucket_snapshot(bucket)
            accuracy = snapshot["accuracy"]
            practice_accuracy = snapshot["practice_accuracy"]
            exam_accuracy = snapshot["exam_accuracy"]
            trend_delta = snapshot["trend_delta"]
            question_count = int(snapshot["question_count"])
            if isinstance(accuracy, float):
                cell_accuracies.append(accuracy)
                if accuracy < MASTERY_WEAK_ACCURACY:
                    weak_units.append((unit.name, accuracy))
            if isinstance(trend_delta, float) and abs(trend_delta) >= MASTERY_CONSISTENCY_GAP:
                consistency_alerts.append(unit.name)
            cells.append(
                CourseMasteryMatrixCell(
                    unit_id=unit.id,
                    accuracy=accuracy if isinstance(accuracy, float) else None,
                    practice_accuracy=practice_accuracy if isinstance(practice_accuracy, float) else None,
                    exam_accuracy=exam_accuracy if isinstance(exam_accuracy, float) else None,
                    trend_delta=trend_delta if isinstance(trend_delta, float) else None,
                    attempt_count=int(snapshot["attempts"]),
                    sample_insufficient=question_count < MASTERY_SAMPLE_THRESHOLD,
                )
            )
        weak_unit_names = [
            name
            for name, _accuracy in sorted(weak_units, key=lambda item: item[1])[:3]
        ]
        average_accuracy = round(sum(cell_accuracies) / len(cell_accuracies), 2) if cell_accuracies else None
        cluster_label = " / ".join(weak_unit_names[:2]) if weak_unit_names else None
        students.append(
            CourseMasteryStudent(
                student_id=student_id,
                student_no=profile.get("student_no"),
                full_name=profile.get("full_name"),
                username=profile.get("username"),
                class_name=profile.get("class_name"),
                average_accuracy=average_accuracy,
                weak_units=weak_unit_names,
                consistency_alerts=consistency_alerts[:3],
                cluster_label=cluster_label,
                cells=cells,
            )
        )

    students.sort(
        key=lambda item: (
            item.average_accuracy is None,
            item.average_accuracy if item.average_accuracy is not None else 101,
            item.full_name or item.username or "",
        )
    )
    question_models.sort(
        key=lambda item: (
            item.accuracy is None,
            item.accuracy if item.accuracy is not None else 101,
            item.discrimination is None,
            item.discrimination if item.discrimination is not None else 101,
        )
    )

    return CourseMasterySummary(
        course_id=course_id,
        semester_id=semester_id,
        sample_threshold=MASTERY_SAMPLE_THRESHOLD,
        student_count=len(students),
        question_count=len(question_models),
        overall_accuracy=_percent(
            float(overall_bucket["score"]),
            float(overall_bucket["max"]),
        ),
        units=unit_models,
        questions=question_models,
        matrix_columns=matrix_columns,
        students=students,
        generated_at=datetime.now(timezone.utc),
    )


@router.get("/{course_id}/mastery-summary", response_model=CourseMasterySummary)
async def get_course_mastery_summary(
    course_id: uuid.UUID,
    db: DB,
    user: CurrentUser,
    semester_id: Annotated[uuid.UUID | None, Query()] = None,
) -> CourseMasterySummary:
    is_admin = await _is_course_admin(db, user)
    return await _build_course_mastery_summary(
        db=db,
        course_id=course_id,
        semester_id=semester_id,
        user=user,
        is_admin=is_admin,
    )


@router.put(
    "/{course_id}/grade-summary/{student_id}",
    response_model=CourseStudentGradeUpdateResponse,
)
async def update_course_student_grade(
    course_id: uuid.UUID,
    student_id: uuid.UUID,
    payload: CourseStudentGradeUpdate,
    db: DB,
    user: CurrentUser,
) -> CourseStudentGradeUpdateResponse:
    is_admin = await _is_course_admin(db, user)
    _course, _semesters, student_rows = await _get_course_grade_students(
        db=db,
        course_id=course_id,
        semester_id=payload.semester_id,
        user=user,
        is_admin=is_admin,
    )
    if student_id not in {student.id for student, _class_row in student_rows}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="学生不在当前课程班级中")

    grade_row = (
        await db.execute(
            select(CourseStudentGrade).where(
                CourseStudentGrade.course_id == course_id,
                CourseStudentGrade.student_id == student_id,
            )
        )
    ).scalar_one_or_none()
    if grade_row is None:
        grade_row = CourseStudentGrade(
            course_id=course_id,
            student_id=student_id,
            semester_scores={},
        )
        db.add(grade_row)

    context_key = _course_grade_context_key(payload.semester_id)
    semester_scores = dict(grade_row.semester_scores or {})
    context_scores = dict(semester_scores.get(context_key, {}) or {})
    if payload.score is None:
        context_scores.pop(payload.component, None)
    else:
        context_scores[payload.component] = round(float(payload.score), 2)
    if context_scores:
        semester_scores[context_key] = context_scores
    else:
        semester_scores.pop(context_key, None)
    grade_row.semester_scores = semester_scores
    await db.commit()

    return CourseStudentGradeUpdateResponse(
        student_id=student_id,
        semester_id=payload.semester_id,
        component=payload.component,
        manual_score=(round(float(payload.score), 2) if payload.score is not None else None),
    )


@router.get("/{course_id}/grade-weights", response_model=CourseGradeWeights)
async def get_course_grade_weights(
    course_id: uuid.UUID, db: DB, user: CurrentUser
) -> CourseGradeWeights:
    """读取课程成绩权重；未设置时返回全 0 默认值。"""
    is_admin = await _is_course_admin(db, user)
    await _get_visible_course(db, course_id, user=user, is_admin=is_admin, include_deleted=True)
    row = (
        await db.execute(
            select(CourseGradeWeight).where(CourseGradeWeight.course_id == course_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return CourseGradeWeights()
    return CourseGradeWeights(**(row.weights or {}))


@router.put("/{course_id}/grade-weights", response_model=CourseGradeWeights)
async def update_course_grade_weights(
    course_id: uuid.UUID,
    payload: CourseGradeWeights,
    db: DB,
    user: CurrentUser,
) -> CourseGradeWeights:
    """保存课程成绩权重（章节任务点 / 章节测试 / 作业 / 考试）。"""
    is_admin = await _is_course_admin(db, user)
    course, *_ = await _get_visible_course(db, course_id, user=user, is_admin=is_admin)
    if not is_admin and course.owner_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权修改该课程的成绩权重")

    row = (
        await db.execute(
            select(CourseGradeWeight).where(CourseGradeWeight.course_id == course_id)
        )
    ).scalar_one_or_none()
    weights = payload.model_dump()
    if row is None:
        db.add(CourseGradeWeight(course_id=course_id, weights=weights))
    else:
        row.weights = weights
    await db.commit()
    return payload


@router.post(
    "/{course_id}/exams/{exam_id}/archive",
    response_model=TeacherCourseExam,
)
async def archive_exam_to_semester(
    course_id: uuid.UUID,
    exam_id: uuid.UUID,
    payload: ExamSemesterArchiveRequest,
    db: DB,
    user: CurrentUser,
) -> TeacherCourseExam:
    """Pin (or unpin with semester_id=null) an exam to one of the course's semesters."""

    is_admin = await _is_course_admin(db, user)
    await _get_visible_course(db, course_id, user=user, is_admin=is_admin)

    exam_stmt = select(Exam).where(Exam.id == exam_id, Exam.deleted_at.is_(None))
    if not is_admin:
        exam_stmt = exam_stmt.where(teacher_owned_resource_filter(Exam, user.id))
    exam = (await db.execute(exam_stmt)).scalar_one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="考试不存在或无权操作")

    existing = await db.get(ExamSemesterAssignment, exam_id)
    if payload.semester_id is None:
        if existing is not None:
            await db.delete(existing)
            await db.commit()
    else:
        sem_stmt = select(CourseSemester).where(
            CourseSemester.id == payload.semester_id,
            CourseSemester.course_id == course_id,
            CourseSemester.deleted_at.is_(None),
        )
        if (await db.execute(sem_stmt)).scalar_one_or_none() is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="学期不存在")
        if existing is None:
            db.add(ExamSemesterAssignment(exam_id=exam_id, course_semester_id=payload.semester_id))
        else:
            existing.course_semester_id = payload.semester_id
        await db.commit()

    rows = await _list_course_exams(
        course_id,
        category=exam.category,
        db=db,
        user=user,
        is_admin=is_admin,
        semester_id=None,
    )
    matched = next((row for row in rows if row.id == exam_id), None)
    if matched is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="考试不在课程范围")
    return matched
