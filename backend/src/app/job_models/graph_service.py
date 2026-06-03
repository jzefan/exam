"""Service layer for the job-course graph workspace."""

import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.job_models.graph_schemas import (
    GraphCourseCard,
    GraphCourseFocusResponse,
    GraphCourseKnowledgePoint,
    GraphJobCard,
    GraphJobFocusResponse,
    GraphLayoutPayload,
    GraphOverviewResponse,
    GraphLinkedSkill,
    GraphLayoutScope,
    GraphSkillCourseMapping,
    GraphSkillKnowledgePoint,
    GraphSkillSummary,
    SkillCourseMappingCreate,
)
from app.job_models.models import (
    CompetencyDimension,
    JobModel,
    JobModelGraphLayout,
    JobModelVersion,
    LearningResource,
    Skill,
    SkillCourseMapping,
    SkillKpMapping,
    SkillKnowledgePoint,
)
from app.learning.models import Direction, KnowledgePoint


class GraphNotFoundError(Exception):
    """Requested graph object was not found in the current organization."""


class GraphConflictError(Exception):
    """Requested graph mutation conflicts with an existing active mapping."""


class GraphValidationError(Exception):
    """Requested graph mutation violates graph rules."""


def _descendant_ids(
    root_id: uuid.UUID,
    children_by_parent: dict[uuid.UUID | None, list[uuid.UUID]],
) -> set[uuid.UUID]:
    descendants: set[uuid.UUID] = set()
    stack = list(children_by_parent.get(root_id, []))
    while stack:
        node_id = stack.pop()
        if node_id in descendants:
            continue
        descendants.add(node_id)
        stack.extend(children_by_parent.get(node_id, []))
    return descendants


async def _get_skill_for_org(
    db: AsyncSession,
    *,
    skill_id: uuid.UUID,
    org_id: uuid.UUID,
) -> Skill | None:
    result = await db.execute(
        select(Skill)
        .join(CompetencyDimension, Skill.dimension_id == CompetencyDimension.id)
        .join(JobModelVersion, CompetencyDimension.model_version_id == JobModelVersion.id)
        .join(JobModel, JobModelVersion.job_model_id == JobModel.id)
        .where(
            Skill.id == skill_id,
            Skill.deleted_at.is_(None),
            CompetencyDimension.deleted_at.is_(None),
            JobModelVersion.deleted_at.is_(None),
            JobModel.deleted_at.is_(None),
            JobModel.org_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def _get_course_subtree_ids(db: AsyncSession, course_root_id: uuid.UUID) -> set[uuid.UUID]:
    rows = await db.execute(
        select(KnowledgePoint.id, KnowledgePoint.parent_id).where(KnowledgePoint.deleted_at.is_(None))
    )
    children_by_parent: dict[uuid.UUID | None, list[uuid.UUID]] = defaultdict(list)
    for kp_id, parent_id in rows.all():
        children_by_parent[parent_id].append(kp_id)
    return {course_root_id} | _descendant_ids(course_root_id, children_by_parent)


async def get_graph_overview(db: AsyncSession, *, org_id: uuid.UUID) -> GraphOverviewResponse:
    """Build the default panorama payload for the graph workspace."""

    model_result = await db.execute(
        select(JobModel)
        .options(
            selectinload(JobModel.current_version)
            .selectinload(JobModelVersion.dimensions)
            .selectinload(CompetencyDimension.skills)
            .selectinload(Skill.knowledge_points)
        )
        .where(JobModel.org_id == org_id, JobModel.deleted_at.is_(None))
        .order_by(JobModel.updated_at.desc())
    )
    models = list(model_result.scalars().unique().all())

    mapping_result = await db.execute(
        select(SkillCourseMapping).where(
            SkillCourseMapping.deleted_at.is_(None),
            SkillCourseMapping.status != "rejected",
        )
    )
    mappings = list(mapping_result.scalars().all())
    mappings_by_skill: dict[uuid.UUID, list[SkillCourseMapping]] = defaultdict(list)
    mapped_skill_ids_by_course: dict[uuid.UUID, set[uuid.UUID]] = defaultdict(set)
    for mapping in mappings:
        mappings_by_skill[mapping.skill_id].append(mapping)
        mapped_skill_ids_by_course[mapping.course_root_knowledge_point_id].add(mapping.skill_id)

    jobs: list[GraphJobCard] = []
    skills: list[GraphSkillSummary] = []
    visible_skill_ids: set[uuid.UUID] = set()
    for model in models:
        version = model.current_version
        dimensions = version.dimensions if version is not None else []
        model_skill_count = 0
        for dimension in dimensions:
            for skill in dimension.skills:
                visible_skill_ids.add(skill.id)
                model_skill_count += 1
                skills.append(
                    GraphSkillSummary(
                        id=skill.id,
                        job_model_id=model.id,
                        dimension_name=dimension.name,
                        name=skill.name,
                        level=skill.level,
                        knowledge_point_count=len(skill.knowledge_points),
                        course_mapping_count=len(mappings_by_skill.get(skill.id, [])),
                    )
                )

        jobs.append(
            GraphJobCard(
                id=model.id,
                current_version_id=model.current_version_id,
                job_role=model.job_role,
                model_type=model.model_type,
                status=model.status,
                industry_name=model.industry_name,
                direction_name=model.direction_name,
                skill_count=model_skill_count,
                version=version.version if version is not None else None,
            )
        )

    mapping_cards = [
        GraphSkillCourseMapping(
            id=mapping.id,
            skill_id=mapping.skill_id,
            course_root_knowledge_point_id=mapping.course_root_knowledge_point_id,
            relation_type=mapping.relation_type,
            match_type=mapping.match_type,
            status=mapping.status,
        )
        for mapping in mappings
        if mapping.skill_id in visible_skill_ids
    ]

    kp_rows = await db.execute(
        select(KnowledgePoint.id, KnowledgePoint.parent_id).where(KnowledgePoint.deleted_at.is_(None))
    )
    children_by_parent: dict[uuid.UUID | None, list[uuid.UUID]] = defaultdict(list)
    for kp_id, parent_id in kp_rows.all():
        children_by_parent[parent_id].append(kp_id)

    resource_rows = await db.execute(
        select(LearningResource.node_id, func.count(LearningResource.id))
        .where(LearningResource.node_type == "kp", LearningResource.deleted_at.is_(None))
        .group_by(LearningResource.node_id)
    )
    resource_count_by_node = {node_id: count for node_id, count in resource_rows.all()}

    course_result = await db.execute(
        select(KnowledgePoint)
        .options(selectinload(KnowledgePoint.direction).selectinload(Direction.major))
        .where(KnowledgePoint.parent_id.is_(None), KnowledgePoint.deleted_at.is_(None))
        .order_by(KnowledgePoint.name)
    )
    root_courses = list(course_result.scalars().unique().all())

    courses: list[GraphCourseCard] = []
    for course in root_courses:
        descendants = _descendant_ids(course.id, children_by_parent)
        subtree_ids = descendants | {course.id}
        courses.append(
            GraphCourseCard(
                id=course.id,
                name=course.name,
                major_name=course.direction.major.name if course.direction and course.direction.major else None,
                direction_name=course.direction.name if course.direction else None,
                child_knowledge_point_count=len(descendants),
                mapped_skill_count=len(mapped_skill_ids_by_course.get(course.id, set())),
                resource_count=sum(resource_count_by_node.get(node_id, 0) for node_id in subtree_ids),
            )
        )

    layout_result = await db.execute(
        select(JobModelGraphLayout).where(
            JobModelGraphLayout.scope_type == "org_overview",
            JobModelGraphLayout.scope_id == org_id,
            JobModelGraphLayout.deleted_at.is_(None),
        )
    )
    layout = layout_result.scalar_one_or_none()

    return GraphOverviewResponse(
        jobs=jobs,
        courses=courses,
        skills=skills,
        skill_course_mappings=mapping_cards,
        layout_scope=GraphLayoutScope(scope_type="org_overview", scope_id=org_id),
        layout=(
            GraphLayoutPayload(
                id=layout.id,
                scope_type=layout.scope_type,
                scope_id=layout.scope_id,
                layout_json=layout.layout_json,
            )
            if layout is not None
            else None
        ),
    )


async def get_job_focus(
    db: AsyncSession,
    *,
    org_id: uuid.UUID,
    job_model_id: uuid.UUID,
) -> GraphJobFocusResponse:
    model_result = await db.execute(
        select(JobModel)
        .options(
            selectinload(JobModel.current_version)
            .selectinload(JobModelVersion.dimensions)
            .selectinload(CompetencyDimension.skills)
            .selectinload(Skill.knowledge_points)
        )
        .where(
            JobModel.id == job_model_id,
            JobModel.org_id == org_id,
            JobModel.deleted_at.is_(None),
        )
    )
    model = model_result.scalars().unique().one_or_none()
    if model is None:
        raise GraphNotFoundError("Job model not found")

    version = model.current_version
    dimensions = version.dimensions if version is not None else []
    skill_ids = [skill.id for dimension in dimensions for skill in dimension.skills]

    mappings_by_skill: dict[uuid.UUID, list[SkillCourseMapping]] = defaultdict(list)
    if skill_ids:
        mapping_result = await db.execute(
            select(SkillCourseMapping).where(
                SkillCourseMapping.skill_id.in_(skill_ids),
                SkillCourseMapping.deleted_at.is_(None),
                SkillCourseMapping.status != "rejected",
            )
        )
        for mapping in mapping_result.scalars().all():
            mappings_by_skill[mapping.skill_id].append(mapping)

    skills: list[GraphSkillSummary] = []
    skill_kps: list[GraphSkillKnowledgePoint] = []
    for dimension in dimensions:
        for skill in dimension.skills:
            skills.append(
                GraphSkillSummary(
                    id=skill.id,
                    job_model_id=model.id,
                    dimension_name=dimension.name,
                    name=skill.name,
                    level=skill.level,
                    knowledge_point_count=len(skill.knowledge_points),
                    course_mapping_count=len(mappings_by_skill.get(skill.id, [])),
                )
            )
            for kp in skill.knowledge_points:
                skill_kps.append(
                    GraphSkillKnowledgePoint(
                        id=kp.id,
                        skill_id=skill.id,
                        name=kp.name,
                        difficulty=kp.difficulty,
                    )
                )

    mapping_cards = [
        GraphSkillCourseMapping(
            id=mapping.id,
            skill_id=mapping.skill_id,
            course_root_knowledge_point_id=mapping.course_root_knowledge_point_id,
            relation_type=mapping.relation_type,
            match_type=mapping.match_type,
            status=mapping.status,
        )
        for skill_mappings in mappings_by_skill.values()
        for mapping in skill_mappings
    ]

    return GraphJobFocusResponse(
        job=GraphJobCard(
            id=model.id,
            current_version_id=model.current_version_id,
            job_role=model.job_role,
            model_type=model.model_type,
            status=model.status,
            industry_name=model.industry_name,
            direction_name=model.direction_name,
            skill_count=len(skill_ids),
            version=version.version if version is not None else None,
        ),
        skills=skills,
        skill_knowledge_points=skill_kps,
        skill_course_mappings=mapping_cards,
    )


async def get_course_focus(
    db: AsyncSession,
    *,
    org_id: uuid.UUID,
    course_root_id: uuid.UUID,
) -> GraphCourseFocusResponse:
    course_result = await db.execute(
        select(KnowledgePoint)
        .options(selectinload(KnowledgePoint.direction).selectinload(Direction.major))
        .where(KnowledgePoint.id == course_root_id, KnowledgePoint.deleted_at.is_(None))
    )
    course = course_result.scalars().unique().one_or_none()
    if course is None or course.parent_id is not None:
        raise GraphNotFoundError("Course not found")

    subtree_ids = await _get_course_subtree_ids(db, course_root_id)
    child_rows = await db.execute(
        select(KnowledgePoint)
        .where(
            KnowledgePoint.parent_id == course_root_id,
            KnowledgePoint.deleted_at.is_(None),
        )
        .order_by(KnowledgePoint.name)
    )
    children = list(child_rows.scalars().all())

    kp_mapping_rows = await db.execute(
        select(SkillKpMapping.knowledge_point_id, func.count(SkillKpMapping.skill_kp_id))
        .where(
            SkillKpMapping.knowledge_point_id.in_(subtree_ids),
            SkillKpMapping.deleted_at.is_(None),
            SkillKpMapping.status != "rejected",
        )
        .group_by(SkillKpMapping.knowledge_point_id)
    )
    mapped_kp_counts = {kp_id: count for kp_id, count in kp_mapping_rows.all()}

    mapping_rows = await db.execute(
        select(SkillCourseMapping)
        .where(
            SkillCourseMapping.course_root_knowledge_point_id == course_root_id,
            SkillCourseMapping.deleted_at.is_(None),
            SkillCourseMapping.status != "rejected",
        )
    )
    mappings = list(mapping_rows.scalars().all())
    mapping_cards = [
        GraphSkillCourseMapping(
            id=mapping.id,
            skill_id=mapping.skill_id,
            course_root_knowledge_point_id=mapping.course_root_knowledge_point_id,
            relation_type=mapping.relation_type,
            match_type=mapping.match_type,
            status=mapping.status,
        )
        for mapping in mappings
    ]

    linked_skills: list[GraphLinkedSkill] = []
    mapped_skill_ids = [mapping.skill_id for mapping in mappings]
    if mapped_skill_ids:
        linked_rows = await db.execute(
            select(Skill, CompetencyDimension, JobModel)
            .join(CompetencyDimension, Skill.dimension_id == CompetencyDimension.id)
            .join(JobModelVersion, CompetencyDimension.model_version_id == JobModelVersion.id)
            .join(JobModel, JobModelVersion.job_model_id == JobModel.id)
            .where(
                Skill.id.in_(mapped_skill_ids),
                Skill.deleted_at.is_(None),
                CompetencyDimension.deleted_at.is_(None),
                JobModelVersion.deleted_at.is_(None),
                JobModel.deleted_at.is_(None),
                JobModel.org_id == org_id,
            )
            .order_by(JobModel.job_role, Skill.name)
        )
        for skill, dimension, model in linked_rows.all():
            linked_skills.append(
                GraphLinkedSkill(
                    skill_id=skill.id,
                    skill_name=skill.name,
                    job_model_id=model.id,
                    job_role=model.job_role,
                    dimension_name=dimension.name,
                )
            )

    resource_rows = await db.execute(
        select(LearningResource.node_id, func.count(LearningResource.id))
        .where(
            LearningResource.node_type == "kp",
            LearningResource.node_id.in_(subtree_ids),
            LearningResource.deleted_at.is_(None),
        )
        .group_by(LearningResource.node_id)
    )
    resource_count = sum(count for _node_id, count in resource_rows.all())

    return GraphCourseFocusResponse(
        course=GraphCourseCard(
            id=course.id,
            name=course.name,
            major_name=course.direction.major.name if course.direction and course.direction.major else None,
            direction_name=course.direction.name if course.direction else None,
            child_knowledge_point_count=len(subtree_ids - {course_root_id}),
            mapped_skill_count=len({mapping.skill_id for mapping in mappings}),
            resource_count=resource_count,
        ),
        child_knowledge_points=[
            GraphCourseKnowledgePoint(
                id=child.id,
                course_root_id=course_root_id,
                parent_id=child.parent_id,
                name=child.name,
                mapped_skill_knowledge_point_count=mapped_kp_counts.get(child.id, 0),
            )
            for child in children
        ],
        linked_skills=linked_skills,
        skill_course_mappings=mapping_cards,
    )


async def create_skill_course_mapping(
    db: AsyncSession,
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    data: SkillCourseMappingCreate,
) -> GraphSkillCourseMapping:
    skill = await _get_skill_for_org(db, skill_id=data.skill_id, org_id=org_id)
    if skill is None:
        raise GraphNotFoundError("Skill not found")

    course = await db.get(KnowledgePoint, data.course_root_knowledge_point_id)
    if course is None or course.deleted_at is not None:
        raise GraphNotFoundError("Course not found")
    if course.parent_id is not None:
        raise GraphValidationError("Course mapping target must be a root knowledge point")

    duplicate_result = await db.execute(
        select(SkillCourseMapping).where(
            SkillCourseMapping.skill_id == data.skill_id,
            SkillCourseMapping.course_root_knowledge_point_id == data.course_root_knowledge_point_id,
            SkillCourseMapping.deleted_at.is_(None),
            SkillCourseMapping.status != "rejected",
        )
    )
    if duplicate_result.scalar_one_or_none() is not None:
        raise GraphConflictError("Skill is already mapped to this course")

    mapping = SkillCourseMapping(
        skill_id=data.skill_id,
        course_root_knowledge_point_id=data.course_root_knowledge_point_id,
        relation_type=data.relation_type,
        match_type=data.match_type,
        status=data.status,
        created_by=user_id,
    )
    db.add(mapping)
    await db.flush()
    return GraphSkillCourseMapping(
        id=mapping.id,
        skill_id=mapping.skill_id,
        course_root_knowledge_point_id=mapping.course_root_knowledge_point_id,
        relation_type=mapping.relation_type,
        match_type=mapping.match_type,
        status=mapping.status,
    )


async def delete_skill_course_mapping(
    db: AsyncSession,
    *,
    org_id: uuid.UUID,
    mapping_id: uuid.UUID,
) -> None:
    mapping = await db.get(SkillCourseMapping, mapping_id)
    if mapping is None or mapping.deleted_at is not None:
        raise GraphNotFoundError("Mapping not found")

    skill = await _get_skill_for_org(db, skill_id=mapping.skill_id, org_id=org_id)
    if skill is None:
        raise GraphNotFoundError("Mapping not found")

    now = datetime.now(UTC)
    mapping.deleted_at = now

    subtree_ids = await _get_course_subtree_ids(db, mapping.course_root_knowledge_point_id)
    kp_mapping_result = await db.execute(
        select(SkillKpMapping)
        .join(SkillKnowledgePoint, SkillKpMapping.skill_kp_id == SkillKnowledgePoint.id)
        .where(
            SkillKnowledgePoint.skill_id == mapping.skill_id,
            SkillKpMapping.knowledge_point_id.in_(subtree_ids),
            SkillKpMapping.deleted_at.is_(None),
        )
    )
    for kp_mapping in kp_mapping_result.scalars().all():
        kp_mapping.deleted_at = now
    await db.flush()


async def save_graph_layout(
    db: AsyncSession,
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    scope_type: str,
    scope_id: uuid.UUID,
    layout_json: dict[str, Any],
) -> GraphLayoutPayload:
    if scope_type not in {"org_overview", "job_model_version"}:
        raise GraphValidationError("Unsupported graph layout scope")
    if scope_type == "org_overview" and scope_id != org_id:
        raise GraphValidationError("Org overview layout scope must match current organization")

    layout_result = await db.execute(
        select(JobModelGraphLayout).where(
            JobModelGraphLayout.scope_type == scope_type,
            JobModelGraphLayout.scope_id == scope_id,
            JobModelGraphLayout.deleted_at.is_(None),
        )
    )
    layout = layout_result.scalar_one_or_none()
    if layout is None:
        layout = JobModelGraphLayout(
            scope_type=scope_type,
            scope_id=scope_id,
            layout_json=layout_json,
            updated_by=user_id,
        )
        db.add(layout)
    else:
        layout.layout_json = layout_json
        layout.updated_by = user_id
    await db.flush()
    return GraphLayoutPayload(
        id=layout.id,
        scope_type=layout.scope_type,
        scope_id=layout.scope_id,
        layout_json=layout.layout_json,
    )
