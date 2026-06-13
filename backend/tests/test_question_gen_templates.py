"""Tests for course question-generation templates (Step 1): CRUD + context assembly."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.learning.models import KnowledgePoint
from app.question_gen_templates import service
from app.question_gen_templates.schemas import (
    GenRules,
    ManualSeed,
    StudentProfile,
    TemplateCreate,
    TemplateGenerateRequest,
    TemplateMaterialInput,
)


async def _make_course(db: AsyncSession, name: str = "数据仓库技术") -> KnowledgePoint:
    course = KnowledgePoint(name=name, owner_id=uuid.uuid4())
    db.add(course)
    await db.commit()
    await db.refresh(course)
    return course


def _template_payload(course_id: uuid.UUID, **overrides) -> TemplateCreate:
    base = dict(
        course_kp_id=course_id,
        name="期末复习-应用型",
        is_default=True,
        student_profile=StudentProfile(
            teaching_stage="undergraduate",
            difficulty_preference="medium",
            teaching_goal="能独立设计分层数据仓库并编写基础 HiveQL",
        ),
        manual_seed_questions=["题干：什么是数据仓库？\n答案：面向主题的数据集合。"],
        gen_rules=GenRules(
            type_distribution={"choice": 2, "code": 1},
            difficulty_distribution={"easy": 20, "medium": 60, "hard": 20},
            style_rules=["编程题优先 Python"],
            default_scope_kp_ids=[],
        ),
        materials=[TemplateMaterialInput(resource_id=uuid.uuid4(), resource_title="第一章", text="数据仓库四大特征……")],
    )
    base.update(overrides)
    return TemplateCreate(**base)


@pytest.mark.asyncio
async def test_create_template_persists_all_parts(db_session: AsyncSession) -> None:
    course = await _make_course(db_session)
    template = await service.create_template(db_session, _template_payload(course.id), user_id=course.owner_id)

    assert template.name == "期末复习-应用型"
    assert template.is_default is True
    assert template.student_profile["teaching_stage"] == "undergraduate"
    assert template.student_profile["teaching_goal"].startswith("能独立设计")
    assert template.gen_rules["type_distribution"] == {"choice": 2, "code": 1}
    assert len(template.materials) == 1
    assert template.materials[0].resource_title == "第一章"
    assert template.materials[0].text.startswith("数据仓库")  # snapshot text persisted


@pytest.mark.asyncio
async def test_update_replaces_materials_when_provided(db_session: AsyncSession) -> None:
    from app.question_gen_templates.schemas import TemplateUpdate

    course = await _make_course(db_session)
    template = await service.create_template(db_session, _template_payload(course.id), user_id=course.owner_id)

    # Re-saving with the same material (text echoed back from the detail response) preserves it.
    kept = TemplateMaterialInput(resource_id=uuid.uuid4(), resource_title="第二章", text="Hive 体系结构……")
    updated = await service.update_template(db_session, template, TemplateUpdate(materials=[kept]))
    assert [m.resource_title for m in updated.materials] == ["第二章"]
    assert updated.materials[0].text.startswith("Hive")


@pytest.mark.asyncio
async def test_assemble_generate_request_merges_template_and_overrides(db_session: AsyncSession) -> None:
    course = await _make_course(db_session)
    template = await service.create_template(db_session, _template_payload(course.id), user_id=course.owner_id)

    # No overrides → uses template's rules.
    req = await service.assemble_generate_request(db_session, template, TemplateGenerateRequest())
    assert req.type_distribution == {"choice": 2, "code": 1}
    assert req.total_count == 3
    assert req.difficulty == 3  # dominant bucket "medium"
    assert req.course_name == "数据仓库技术"
    assert "数据仓库四大特征" in req.material_text  # material snapshot injected
    assert "教学对象" in req.prompt
    assert "难度偏好：中等" in req.prompt
    assert "什么是数据仓库" in req.prompt  # seed sample surfaced as style reference

    # Overrides win on type distribution + difficulty.
    req2 = await service.assemble_generate_request(
        db_session,
        template,
        TemplateGenerateRequest(type_distribution={"choice": 5}, difficulty=4, extra_prompt="多考查实际应用"),
    )
    assert req2.type_distribution == {"choice": 5}
    assert req2.total_count == 5
    assert req2.difficulty == 4
    assert "多考查实际应用" in req2.prompt


@pytest.mark.asyncio
async def test_generation_grounds_in_course_knowledge_base(db_session: AsyncSession) -> None:
    from app.job_models.models import LearningResource

    course = await _make_course(db_session)
    # A material under the course carries extracted knowledge fragments.
    db_session.add(
        LearningResource(
            node_id=course.id,
            node_type="kp",
            resource_type="document",
            title="第一章.pdf",
            knowledge_fragments=[{"type": "formula", "title": "二次方程", "content": "ax^2+bx+c=0"}],
        )
    )
    await db_session.commit()
    template = await service.create_template(db_session, _template_payload(course.id), user_id=course.owner_id)

    kb = await service.gather_course_knowledge_base(db_session, course.id)
    assert "公式" in kb and "二次方程" in kb  # typed fragment surfaced

    req = await service.assemble_generate_request(db_session, template, TemplateGenerateRequest())
    assert "课程知识库" in req.material_text  # generation is grounded in the knowledge base
    assert "二次方程" in req.material_text


@pytest.mark.asyncio
async def test_assemble_requires_a_type_distribution(db_session: AsyncSession) -> None:
    course = await _make_course(db_session)
    template = await service.create_template(
        db_session,
        _template_payload(course.id, gen_rules=GenRules()),  # empty rules → no type distribution
        user_id=course.owner_id,
    )
    with pytest.raises(ValueError):
        await service.assemble_generate_request(db_session, template, TemplateGenerateRequest())


@pytest.mark.asyncio
async def test_set_default_is_unique_per_course(db_session: AsyncSession) -> None:
    course = await _make_course(db_session)
    first = await service.create_template(db_session, _template_payload(course.id), user_id=course.owner_id)
    second = await service.create_template(
        db_session,
        _template_payload(course.id, name="平时练习", is_default=False),
        user_id=course.owner_id,
    )

    await service.set_default(db_session, second)
    await db_session.refresh(first)
    assert second.is_default is True
    assert first.is_default is False  # the previous default was cleared


@pytest.mark.asyncio
async def test_seed_usage_map_reports_skill_names(db_session: AsyncSession) -> None:
    course = await _make_course(db_session)
    shared_q = uuid.uuid4()
    only_a = uuid.uuid4()
    tpl_a = await service.create_template(
        db_session,
        _template_payload(course.id, name="技能A", seed_question_ids=[shared_q, only_a], is_default=False),
        user_id=course.owner_id,
    )
    tpl_b = await service.create_template(
        db_session,
        _template_payload(course.id, name="技能B", seed_question_ids=[shared_q], is_default=False),
        user_id=course.owner_id,
    )

    usage = await service.seed_usage_map(db_session, course_kp_id=course.id, user_id=course.owner_id)
    assert {u["name"] for u in usage[str(shared_q)]} == {"技能A", "技能B"}
    assert [u["name"] for u in usage[str(only_a)]] == ["技能A"]
    assert {u["id"] for u in usage[str(shared_q)]} == {str(tpl_a.id), str(tpl_b.id)}


@pytest.mark.asyncio
async def test_structured_manual_seed_round_trips_and_surfaces_typed_sample(
    db_session: AsyncSession,
) -> None:
    course = await _make_course(db_session)
    template = await service.create_template(
        db_session,
        _template_payload(
            course.id,
            manual_seed_questions=[
                ManualSeed(
                    type="choice",
                    text="下列哪项属于数据仓库特征？A.面向主题 B.易失",
                    answer="A",
                    analysis="数据仓库面向主题、非易失。",
                )
            ],
        ),
        user_id=course.owner_id,
    )

    # Stored as a structured dict (not a bare string).
    stored = template.manual_seed_questions[0]
    assert stored["type"] == "choice"
    assert stored["answer"] == "A"

    req = await service.assemble_generate_request(
        db_session, template, TemplateGenerateRequest(type_distribution={"choice": 1})
    )
    assert "题型：选择题" in req.prompt
    assert "下列哪项属于数据仓库特征" in req.prompt
    assert "答案：A" in req.prompt


@pytest.mark.asyncio
async def test_complete_seed_answer_analysis_returns_strings(monkeypatch) -> None:
    from app.questions import service as questions_service

    async def fake_deepseek(prompt: str) -> dict:
        assert "题干：" in prompt and "选择题" in prompt
        return {"answer": "B", "analysis": "因为 B 选项正确。", "extra": "ignored"}

    monkeypatch.setattr(questions_service, "_request_deepseek_json", fake_deepseek)
    result = await questions_service.complete_seed_answer_analysis("choice", "1+1=? A.1 B.2")
    assert result == {"answer": "B", "analysis": "因为 B 选项正确。"}


@pytest.mark.asyncio
async def test_prompt_renders_stage_and_goal(db_session: AsyncSession) -> None:
    from app.question_gen_templates.schemas import TemplateGenerateRequest

    course = await _make_course(db_session)
    template = await service.create_template(db_session, _template_payload(course.id), user_id=course.owner_id)
    request = await service.assemble_generate_request(
        db_session, template, TemplateGenerateRequest(type_distribution={"choice": 2})
    )
    assert "教学阶段：本科学生" in request.prompt
    assert "教学目标" in request.prompt
    assert "能独立设计分层数据仓库" in request.prompt
