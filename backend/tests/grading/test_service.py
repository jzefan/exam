import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.grading.models import (
    GradingAuditEvent,
    GradingResultSnapshot,
    GradingTask,
    ModelConfig,
    ProviderConfig,
    RoleBinding,
)
from app.grading.providers.base import GradingProviderError, GradingProviderResult
from app.grading.providers.deepseek import DeepSeekProvider
from app.grading.providers.openrouter import OpenRouterProvider
from app.grading.providers.qwen import QwenProvider
from app.grading.service import (
    _build_follow_up_prompt_pair,
    _build_prompt_pair,
    _build_provider_for_model,
    _humanize_grading_failure_message,
    run_grading_task,
)


class FakeProvider:
    def __init__(self, result: GradingProviderResult) -> None:
        self.result = result
        self.calls: list[tuple[str, str]] = []

    async def score(self, system_prompt: str, user_prompt: str) -> GradingProviderResult:
        self.calls.append((system_prompt, user_prompt))
        return self.result


class FailingProvider:
    def __init__(self, exc: Exception) -> None:
        self.exc = exc
        self.calls: list[tuple[str, str]] = []

    async def score(self, system_prompt: str, user_prompt: str) -> GradingProviderResult:
        self.calls.append((system_prompt, user_prompt))
        raise self.exc


def test_humanize_grading_failure_message_maps_provider_errors() -> None:
    assert _humanize_grading_failure_message("OpenRouter provider API key is not configured") == "Claude 模型未正确配置，当前未完成 AI 评估。"
    assert _humanize_grading_failure_message("Qwen provider API key is not configured") == "Qwen 模型未正确配置，当前未完成 AI 评估。"
    assert _humanize_grading_failure_message("response content must decode to a JSON object") == "AI 返回结果格式异常，请稍后重试。"


async def _create_role_binding_stack(db_session: AsyncSession) -> tuple[ProviderConfig, ModelConfig, RoleBinding]:
    provider = ProviderConfig(
        key="qwen-direct",
        provider_type="qwen",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        credential_env="EXAM_QWEN_API_KEY",
        is_active=True,
    )
    db_session.add(provider)
    await db_session.flush()

    model = ModelConfig(
        key="qwen-grader-v1",
        display_name="Qwen Grader",
        model_name="qwen-plus",
        provider_id=provider.id,
        temperature=0.1,
        is_active=True,
    )
    db_session.add(model)
    await db_session.flush()

    binding = RoleBinding(
        version=1,
        grader_model_id=model.id,
        reviewer_model_id=model.id,
        arbiter_model_id=model.id,
        is_active=True,
    )
    db_session.add(binding)
    await db_session.flush()
    return provider, model, binding


@pytest.mark.asyncio
async def test_run_grading_task_creates_primary_review_and_final_snapshots(db_session: AsyncSession) -> None:
    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="什么是幂等性",
        max_score=10,
        knowledge_tags=["接口设计", "幂等性"],
        student_answer_raw="重复执行结果一致",
        standard_answers=[{"summary": "同一请求多次执行结果一致"}],
        rubric_definition={"dimensions": [{"key": "coverage", "weight": 0.5}]},
        scoring_points=[{"key": "same_result", "weight": 0.5}],
        dimension_weights={"coverage": 0.5, "accuracy": 0.5},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    primary_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "primary"},
            score_total=8.0,
            dimension_scores={"coverage": 4.0, "accuracy": 4.0},
            deduction_reasons=["缺少一个边界案例"],
            strengths=["概念正确"],
            improvement_suggestions=["补充副作用说明"],
            evidence_summary={"matched_points": 2},
            risk_flags=[],
            provider_key="qwen-direct",
            provider_name="qwen",
            model_name="qwen-plus",
            metadata={},
        )
    )
    review_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "review"},
            score_total=8.5,
            dimension_scores={"coverage": 4.0, "accuracy": 4.5},
            deduction_reasons=["表达略简略"],
            strengths=["结构清晰"],
            improvement_suggestions=["增加一个例子"],
            evidence_summary={"matched_points": 2},
            risk_flags=[],
            provider_key="deepseek-direct",
            provider_name="deepseek",
            model_name="deepseek-v4-flash",
            metadata={},
        )
    )

    result = await run_grading_task(db_session, str(task.id), primary_provider, review_provider)
    await db_session.commit()

    assert result["status"] == "completed"
    assert result["arbitration_required"] is False
    assert primary_provider.calls
    assert review_provider.calls
    assert '"question_type": "short_answer"' in primary_provider.calls[0][1]
    assert '"max_score": 10' in primary_provider.calls[0][1]
    assert '"knowledge_tags": ["接口设计", "幂等性"]' in primary_provider.calls[0][1]
    assert "0 到 max_score" in primary_provider.calls[0][0]
    assert "必须使用简体中文回复" in primary_provider.calls[0][0]

    refreshed_task = await db_session.get(GradingTask, task.id)
    assert refreshed_task is not None
    assert refreshed_task.latest_primary_snapshot_id is not None
    assert refreshed_task.latest_review_snapshot_id is not None
    assert refreshed_task.latest_final_snapshot_id is not None

    snapshots_result = await db_session.execute(
        select(GradingResultSnapshot).where(GradingResultSnapshot.task_id == task.id)
    )
    snapshots = list(snapshots_result.scalars().all())
    assert {snapshot.snapshot_type for snapshot in snapshots} == {"primary", "review", "final"}

    final_snapshot = next(snapshot for snapshot in snapshots if snapshot.snapshot_type == "final")
    assert final_snapshot.score_total == 8.25
    assert final_snapshot.dimension_scores["accuracy"] == 4.25

    audit_result = await db_session.execute(
        select(GradingAuditEvent).where(GradingAuditEvent.task_id == task.id)
    )
    audit_events = list(audit_result.scalars().all())
    assert {event.event_type for event in audit_events} >= {
        "grading.primary_completed",
        "grading.review_completed",
        "grading.finalized",
    }


@pytest.mark.asyncio
async def test_run_grading_task_calls_arbiter_provider_for_model_output_even_without_conflict(
    db_session: AsyncSession,
) -> None:
    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="什么是幂等性",
        max_score=10,
        knowledge_tags=["接口设计", "幂等性"],
        student_answer_raw="重复执行结果一致",
        standard_answers=[{"summary": "同一请求多次执行结果一致"}],
        rubric_definition={"dimensions": [{"key": "coverage", "weight": 0.5}]},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    primary_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "primary"},
            score_total=8.0,
            dimension_scores={"coverage": 8.0},
            deduction_reasons=["表达略简略"],
            strengths=["概念正确"],
            improvement_suggestions=["补充例子"],
            evidence_summary={},
            risk_flags=[],
            provider_key="qwen-direct",
            provider_name="qwen",
            model_name="qwen-plus",
            metadata={},
        )
    )
    review_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "review"},
            score_total=8.2,
            dimension_scores={"coverage": 8.2},
            deduction_reasons=["可以更完整"],
            strengths=["答案方向正确"],
            improvement_suggestions=["补充副作用说明"],
            evidence_summary={},
            risk_flags=[],
            provider_key="deepseek-direct",
            provider_name="deepseek",
            model_name="deepseek-v4-flash",
            metadata={},
        )
    )
    arbiter_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "arbiter"},
            score_total=8.1,
            dimension_scores={"coverage": 8.1},
            deduction_reasons=["综合看可采用原分"],
            strengths=["两轮评分一致"],
            improvement_suggestions=["无需额外仲裁"],
            evidence_summary={"review_mode": "no_conflict_model_output"},
            risk_flags=[],
            provider_key="openrouter-arbiter",
            provider_name="openrouter",
            model_name="anthropic/claude-sonnet-4.6",
            metadata={},
        )
    )

    result = await run_grading_task(db_session, str(task.id), primary_provider, review_provider, arbiter_provider)
    await db_session.commit()

    assert result["status"] == "completed"
    assert result["arbitration_required"] is False
    assert result["reason"] is None
    assert arbiter_provider.calls
    assert "Arbitration reason: no_conflict_model_output" in arbiter_provider.calls[0][1]

    snapshots_result = await db_session.execute(
        select(GradingResultSnapshot).where(GradingResultSnapshot.task_id == task.id)
    )
    snapshots = list(snapshots_result.scalars().all())
    assert {snapshot.snapshot_type for snapshot in snapshots} == {"primary", "review", "arbiter", "final"}

    final_snapshot = next(snapshot for snapshot in snapshots if snapshot.snapshot_type == "final")
    assert final_snapshot.score_total == 8.1


@pytest.mark.asyncio
async def test_run_grading_task_keeps_final_score_when_optional_arbiter_fails(
    db_session: AsyncSession,
) -> None:
    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="什么是幂等性",
        max_score=10,
        knowledge_tags=["接口设计", "幂等性"],
        student_answer_raw="重复执行结果一致",
        standard_answers=[{"summary": "同一请求多次执行结果一致"}],
        rubric_definition={"dimensions": [{"key": "coverage", "weight": 0.5}]},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    primary_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "primary"},
            score_total=8.0,
            dimension_scores={"coverage": 8.0},
            deduction_reasons=["表达略简略"],
            strengths=["概念正确"],
            improvement_suggestions=["补充例子"],
            evidence_summary={},
            risk_flags=[],
            provider_key="qwen-direct",
            provider_name="qwen",
            model_name="qwen-plus",
            metadata={},
        )
    )
    review_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "review"},
            score_total=8.2,
            dimension_scores={"coverage": 8.2},
            deduction_reasons=["可以更完整"],
            strengths=["答案方向正确"],
            improvement_suggestions=["补充副作用说明"],
            evidence_summary={},
            risk_flags=[],
            provider_key="deepseek-direct",
            provider_name="deepseek",
            model_name="deepseek-v4-flash",
            metadata={},
        )
    )
    arbiter_provider = FailingProvider(
        GradingProviderError(
            message="normalized provider payload is missing required keys: score_total, dimension_scores",
            provider_name="openrouter",
            model_name="anthropic/claude-sonnet-4.6",
            raw_excerpt='{"unexpected": true}',
        )
    )

    result = await run_grading_task(db_session, str(task.id), primary_provider, review_provider, arbiter_provider)
    await db_session.commit()

    assert result["status"] == "completed"
    assert result["arbitration_required"] is False

    refreshed_task = await db_session.get(GradingTask, task.id)
    assert refreshed_task is not None
    assert refreshed_task.latest_final_snapshot_id is not None

    snapshots_result = await db_session.execute(
        select(GradingResultSnapshot).where(GradingResultSnapshot.task_id == task.id)
    )
    snapshots = list(snapshots_result.scalars().all())
    assert {snapshot.snapshot_type for snapshot in snapshots} == {"primary", "review", "final"}

    audit_result = await db_session.execute(
        select(GradingAuditEvent).where(GradingAuditEvent.task_id == task.id)
    )
    audit_events = list(audit_result.scalars().all())
    assert "grading.arbiter_failed" in {event.event_type for event in audit_events}


@pytest.mark.asyncio
async def test_grading_prompts_switch_to_english_when_locale_is_en(db_session: AsyncSession) -> None:
    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="Explain idempotency in one sentence.",
        max_score=10,
        knowledge_tags=["api"],
        student_answer_raw="Repeated requests yield the same result.",
        standard_answers=[{"summary": "Repeated execution yields the same result."}],
        rubric_definition={},
        role_binding_version=1,
        status="pending",
        language="zh-CN",
    )

    context = {"student_answer": task.student_answer_raw}
    system_prompt, user_prompt = _build_prompt_pair(task, context, "primary grader", "en-US")
    follow_up_system_prompt, follow_up_user_prompt = _build_follow_up_prompt_pair(
        task,
        context,
        "review grader",
        "Please focus on precision.",
        None,
        "en-US",
    )

    assert "高职高校课程评分专家" in system_prompt
    assert "严格依据 Rubric" in system_prompt
    assert "Respond in English." in system_prompt
    assert "Preferred locale: en-US" in user_prompt
    assert "高职高校课程评分专家" in follow_up_system_prompt
    assert "Respond in English." in follow_up_system_prompt
    assert "Preferred locale: en-US" in follow_up_user_prompt


@pytest.mark.asyncio
async def test_grading_prompts_default_to_chinese_expert_rules(db_session: AsyncSession) -> None:
    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="解释数据库事务的隔离性。",
        max_score=10,
        knowledge_tags=["数据库", "事务"],
        student_answer_raw="隔离性就是并发事务互不干扰。",
        standard_answers=[{"summary": "并发事务之间互不干扰"}],
        rubric_definition={},
        role_binding_version=1,
        status="pending",
        language="zh-CN",
    )

    context = {"student_answer": task.student_answer_raw}
    system_prompt, user_prompt = _build_prompt_pair(task, context, "primary grader", None)

    assert "高职高校课程评分专家" in system_prompt
    assert "必须使用简体中文回复" in system_prompt
    assert "严格依据 Rubric" in system_prompt
    assert "简答题专项补充" in system_prompt
    assert "本题 max_score 为 10" in system_prompt
    assert "Preferred locale: zh-CN" in user_prompt


@pytest.mark.asyncio
async def test_grading_prompts_use_sql_specialization_when_task_looks_like_sql(db_session: AsyncSession) -> None:
    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="请编写 SQL 语句，查询成绩大于 90 分的学生姓名。",
        max_score=10,
        knowledge_tags=["数据库", "SQL"],
        student_answer_raw="SELECT name FROM students WHERE score > 90;",
        student_answer_structured={"language": "sql", "code": "SELECT name FROM students WHERE score > 90;"},
        standard_answers=[{"summary": "使用 SELECT ... WHERE"}],
        rubric_definition={},
        role_binding_version=1,
        status="pending",
        language="zh-CN",
    )

    context = {"student_answer": task.student_answer_raw}
    system_prompt, _ = _build_prompt_pair(task, context, "primary grader", None)

    assert "SQL题专项补充" in system_prompt
    assert "查询结果正确性" in system_prompt


@pytest.mark.asyncio
async def test_review_grader_prompt_emphasizes_independent_audit(db_session: AsyncSession) -> None:
    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="解释幂等性",
        max_score=10,
        student_answer_raw="重复执行结果一致",
        standard_answers=[{"summary": "同一请求多次执行结果一致"}],
        rubric_definition={},
        role_binding_version=1,
        status="pending",
        language="zh-CN",
    )

    context = {"student_answer": task.student_answer_raw}
    primary_system, _ = _build_prompt_pair(task, context, "primary grader", None)
    review_system, _ = _build_prompt_pair(task, context, "review grader", None)

    assert "评分模型" in primary_system
    assert "复核模型" in review_system
    assert "重点关注主评模型可能遗漏" in review_system
    assert "重点关注主评模型可能遗漏" not in primary_system


@pytest.mark.asyncio
async def test_grading_prompts_use_code_specialization_for_code_type(db_session: AsyncSession) -> None:
    task = GradingTask(
        source_type="single_debug",
        question_type="code",
        question_content="实现一个返回两数之和的函数 two_sum。",
        max_score=10,
        programming_language="python",
        knowledge_tags=["算法"],
        student_answer_raw="def two_sum(nums, target):\n    return []",
        standard_answers=[{"summary": "返回正确下标"}],
        rubric_definition={"dimensions": [{"key": "correctness", "weight": 1.0}]},
        role_binding_version=1,
        status="pending",
        language="zh-CN",
    )

    context = {"student_answer": task.student_answer_raw}
    system_prompt, _ = _build_prompt_pair(task, context, "primary grader", None)

    assert "编程题专项补充" in system_prompt
    assert "功能正确性" in system_prompt
    assert "SQL题专项补充" not in system_prompt


@pytest.mark.asyncio
async def test_grading_prompts_route_essay_to_short_answer_specialization(db_session: AsyncSession) -> None:
    task = GradingTask(
        source_type="single_debug",
        question_type="essay",
        question_content="论述高职院校教学评价改革的意义。",
        max_score=20,
        knowledge_tags=["教学论"],
        student_answer_raw="评价改革有助于推动课堂转型……",
        standard_answers=[{"summary": "覆盖课堂转型与多元评价"}],
        rubric_definition={},
        role_binding_version=1,
        status="pending",
        language="zh-CN",
    )

    context = {"student_answer": task.student_answer_raw}
    system_prompt, _ = _build_prompt_pair(task, context, "primary grader", None)

    assert "简答题专项补充" in system_prompt
    assert "SQL题专项补充" not in system_prompt
    assert "编程题专项补充" not in system_prompt


@pytest.mark.asyncio
async def test_sql_heuristic_ignores_conceptual_short_answer_about_sql(db_session: AsyncSession) -> None:
    """题目和标签提到 SQL，但学生写的是散文答案 — 不应误判为 SQL 题。"""
    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="请解释什么是 SQL 注入以及常见防御手段。",
        max_score=10,
        knowledge_tags=["SQL", "安全"],
        student_answer_raw="SQL 注入是攻击者把恶意语句插入参数中，常见防御包括参数化查询和最小权限。",
        standard_answers=[{"summary": "参数化查询"}],
        rubric_definition={},
        role_binding_version=1,
        status="pending",
        language="zh-CN",
    )

    context = {"student_answer": task.student_answer_raw}
    system_prompt, _ = _build_prompt_pair(task, context, "primary grader", None)

    assert "简答题专项补充" in system_prompt
    assert "SQL题专项补充" not in system_prompt


@pytest.mark.asyncio
async def test_final_snapshot_merges_dimension_comments_from_primary_and_review(
    db_session: AsyncSession,
) -> None:
    """主评与复核给出 dimension_comments 时，final 快照应合并而不丢失任一方的解释。"""
    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="解释幂等性",
        max_score=10,
        student_answer_raw="重复执行结果一致",
        standard_answers=[{"summary": "同一请求多次执行结果一致"}],
        rubric_definition={"dimensions": [{"key": "coverage", "weight": 0.5}]},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    primary_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "primary"},
            score_total=8.0,
            dimension_scores={"coverage": 4.0, "accuracy": 4.0},
            dimension_comments={
                "coverage": "覆盖了核心知识点",
                "accuracy": "表述准确",
            },
            deduction_reasons=[],
            strengths=["概念正确"],
            improvement_suggestions=[],
            evidence_summary={"matched_points": 2},
            risk_flags=[],
            provider_key="qwen-direct",
            provider_name="qwen",
            model_name="qwen-plus",
            metadata={},
        )
    )
    review_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "review"},
            score_total=8.5,
            dimension_scores={"coverage": 4.0, "accuracy": 4.5},
            dimension_comments={
                "coverage": "覆盖了核心知识点",
                "accuracy": "表达精炼但可补充举例",
            },
            deduction_reasons=[],
            strengths=[],
            improvement_suggestions=[],
            evidence_summary={"matched_points": 2},
            risk_flags=[],
            provider_key="deepseek-direct",
            provider_name="deepseek",
            model_name="deepseek-v4-flash",
            metadata={},
        )
    )

    await run_grading_task(db_session, str(task.id), primary_provider, review_provider)
    await db_session.commit()

    snapshots_result = await db_session.execute(
        select(GradingResultSnapshot).where(GradingResultSnapshot.task_id == task.id)
    )
    snapshots = list(snapshots_result.scalars().all())
    final_snapshot = next(s for s in snapshots if s.snapshot_type == "final")

    # 完全相同的 comment 不应重复拼接
    assert final_snapshot.dimension_comments["coverage"] == "覆盖了核心知识点"
    # 不同 comment 应被拼接保留双方信息
    assert "表述准确" in final_snapshot.dimension_comments["accuracy"]
    assert "表达精炼但可补充举例" in final_snapshot.dimension_comments["accuracy"]

    primary_snapshot = next(s for s in snapshots if s.snapshot_type == "primary")
    assert primary_snapshot.dimension_comments == {
        "coverage": "覆盖了核心知识点",
        "accuracy": "表述准确",
    }


@pytest.mark.asyncio
async def test_sql_heuristic_requires_action_and_clause_in_answer(db_session: AsyncSession) -> None:
    """学生答案里同时出现 SELECT 和 FROM — 视为 SQL 题。"""
    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="查询订单表里 2024 年的全部订单号。",
        max_score=10,
        knowledge_tags=["数据库"],
        student_answer_raw="select order_id from orders where year(create_time) = 2024;",
        standard_answers=[{"summary": "SELECT 与 WHERE"}],
        rubric_definition={},
        role_binding_version=1,
        status="pending",
        language="zh-CN",
    )

    context = {"student_answer": task.student_answer_raw}
    system_prompt, _ = _build_prompt_pair(task, context, "primary grader", None)

    assert "SQL题专项补充" in system_prompt
    assert "简答题专项补充" not in system_prompt


@pytest.mark.asyncio
async def test_run_grading_task_marks_arbitration_required_on_conflict(db_session: AsyncSession) -> None:
    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="code",
        question_content="实现 two sum",
        max_score=100,
        student_answer_raw="def two_sum(nums, target): return []",
        standard_answers=[{"summary": "返回正确下标"}],
        rubric_definition={"dimensions": [{"key": "correctness", "weight": 0.4}]},
        test_summary={"passed": 1, "total": 3},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    primary_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "primary"},
            score_total=60,
            dimension_scores={"correctness": 20},
            deduction_reasons=["功能未完成"],
            strengths=["结构还行"],
            improvement_suggestions=["补齐主逻辑"],
            evidence_summary={"tests_passed": 1},
            risk_flags=[],
            provider_key="qwen-direct",
            provider_name="qwen",
            model_name="qwen-plus",
            metadata={},
        )
    )
    review_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "review"},
            score_total=82,
            dimension_scores={"correctness": 34},
            deduction_reasons=["只有小问题"],
            strengths=["功能大致可用"],
            improvement_suggestions=["补充异常处理"],
            evidence_summary={"tests_passed": 2},
            risk_flags=[],
            provider_key="deepseek-direct",
            provider_name="deepseek",
            model_name="deepseek-v4-flash",
            metadata={},
        )
    )
    arbiter_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "arbiter"},
            score_total=76,
            dimension_scores={"correctness": 30},
            deduction_reasons=["关键分支未覆盖"],
            strengths=["思路基本正确"],
            improvement_suggestions=["补齐返回路径并覆盖边界输入"],
            evidence_summary={"resolved_reason": "score_diff", "winner": "arbiter"},
            risk_flags=["arbiter_resolved"],
            provider_key="openrouter-arbiter",
            provider_name="openrouter",
            model_name="anthropic/claude-sonnet-4.6",
            metadata={},
        )
    )

    result = await run_grading_task(db_session, str(task.id), primary_provider, review_provider, arbiter_provider)
    await db_session.commit()

    assert result["status"] == "completed"
    assert result["arbitration_required"] is False
    assert result["reason"] == "score_diff"
    assert arbiter_provider.calls
    assert "Arbitration reason: score_diff" in arbiter_provider.calls[0][1]
    assert '"provider": "primary"' in arbiter_provider.calls[0][1]
    assert '"provider": "review"' in arbiter_provider.calls[0][1]

    refreshed_task = await db_session.get(GradingTask, task.id)
    assert refreshed_task is not None
    assert refreshed_task.latest_primary_snapshot_id is not None
    assert refreshed_task.latest_review_snapshot_id is not None
    assert refreshed_task.latest_final_snapshot_id is not None

    snapshots_result = await db_session.execute(
        select(GradingResultSnapshot).where(GradingResultSnapshot.task_id == task.id)
    )
    snapshots = list(snapshots_result.scalars().all())
    assert {snapshot.snapshot_type for snapshot in snapshots} == {"primary", "review", "arbiter", "final"}

    final_snapshot = next(snapshot for snapshot in snapshots if snapshot.snapshot_type == "final")
    arbiter_snapshot = next(snapshot for snapshot in snapshots if snapshot.snapshot_type == "arbiter")
    assert arbiter_snapshot.score_total == 76
    assert final_snapshot.score_total == 76
    assert final_snapshot.risk_flags == ["arbiter_resolved"]

    audit_result = await db_session.execute(
        select(GradingAuditEvent).where(GradingAuditEvent.task_id == task.id)
    )
    audit_events = list(audit_result.scalars().all())
    assert {event.event_type for event in audit_events} >= {
        "grading.arbitration_required",
        "grading.arbiter_completed",
        "grading.finalized",
    }


@pytest.mark.asyncio
async def test_run_grading_task_pins_final_to_review_when_arbiter_disabled(
    db_session: AsyncSession,
) -> None:
    # ``EXAM_ARBITER_ENABLED=false`` short-circuits arbitration: the reviewer
    # snapshot becomes the final result verbatim, regardless of how far it
    # diverges from the primary. No "arbitration_required" status, no
    # averaging.
    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="解释幂等性",
        max_score=10,
        student_answer_raw="重复执行结果一致",
        standard_answers=[{"summary": "重复执行结果一致"}],
        rubric_definition={"dimensions": [{"key": "coverage", "weight": 1.0}]},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    primary_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "primary"},
            score_total=10,
            dimension_scores={"coverage": 10},
            deduction_reasons=[],
            strengths=["完整正确"],
            improvement_suggestions=[],
            evidence_summary={},
            risk_flags=[],
            provider_key="qwen-direct",
            provider_name="qwen",
            model_name="qwen-plus",
            metadata={},
        )
    )
    review_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "review"},
            score_total=6,
            dimension_scores={"coverage": 6},
            deduction_reasons=["缺少业务场景"],
            strengths=["主旨正确"],
            improvement_suggestions=["补充例子"],
            evidence_summary={"note": "review"},
            risk_flags=["needs_detail"],
            provider_key="deepseek-direct",
            provider_name="deepseek",
            model_name="deepseek-v4-flash",
            metadata={},
        )
    )

    # Simulates EXAM_ARBITER_ENABLED=false — review pins the final.
    result = await run_grading_task(
        db_session,
        str(task.id),
        primary_provider,
        review_provider,
        None,
        review_only_final=True,
    )
    await db_session.commit()

    assert result["status"] == "completed"
    assert result["arbitration_required"] is False
    assert result["arbiter_disabled"] is True

    refreshed = await db_session.get(GradingTask, task.id)
    assert refreshed is not None
    assert refreshed.latest_arbitration_snapshot_id is None
    assert refreshed.latest_final_snapshot_id is not None
    assert refreshed.latest_final_snapshot.score_total == 6  # review's score, NOT averaged 8
    assert refreshed.latest_final_snapshot.dimension_scores == {"coverage": 6}
    assert refreshed.latest_final_snapshot.risk_flags == ["needs_detail"]

    audit_result = await db_session.execute(
        select(GradingAuditEvent)
        .where(GradingAuditEvent.task_id == task.id)
        .order_by(GradingAuditEvent.created_at)
    )
    events = list(audit_result.scalars().all())
    event_types = {event.event_type for event in events}
    # No arbitration_required / arbiter_failed events when arbiter is disabled.
    assert "grading.arbitration_required" not in event_types
    assert "grading.arbiter_failed" not in event_types
    finalized = next(event for event in events if event.event_type == "grading.finalized")
    assert finalized.event_payload.get("source") == "review_only"


@pytest.mark.asyncio
async def test_run_grading_task_with_role_binding_skips_arbiter_when_settings_disable_it(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # End-to-end: settings.arbiter_enabled=False must prevent
    # ``run_grading_task_with_role_binding`` from constructing an arbiter
    # provider, even when the role binding has one configured.
    from app.grading import service as grading_service

    monkeypatch.setattr(grading_service.settings, "arbiter_enabled", False)
    monkeypatch.setenv("EXAM_QWEN_API_KEY", "qwen-secret")
    monkeypatch.setenv("EXAM_DEEPSEEK_API_KEY", "deepseek-secret")
    monkeypatch.setenv("EXAM_DOUBAO_API_KEY", "doubao-secret")

    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="测试",
        max_score=10,
        student_answer_raw="answer",
        standard_answers=[{"summary": "ref"}],
        rubric_definition={"dimensions": []},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.commit()

    call_log: list[str] = []

    async def fake_request_completion(self, payload):
        call_log.append(self.provider_name)
        score = 10 if self.provider_name == "qwen" else 6
        return {
            "choices": [
                {
                    "message": {
                        "content": (
                            f'{{"score_total": {score}, "dimension_scores": {{}}, '
                            '"deduction_reasons": [], "strengths": [], '
                            '"improvement_suggestions": [], '
                            '"evidence_summary": {}, "risk_flags": []}'
                        )
                    }
                }
            ]
        }

    monkeypatch.setattr(
        "app.grading.providers.base.BaseGradingProvider._request_completion",
        fake_request_completion,
    )

    result = await grading_service.run_grading_task_with_role_binding(db_session, str(task.id))
    await db_session.commit()

    assert result["status"] == "completed"
    assert result.get("arbiter_disabled") is True
    # Exactly 2 LLM calls (primary + review). The arbiter leg is skipped, so
    # we never even build a doubao provider; ``call_log`` therefore has 2
    # entries, not 3.
    assert len(call_log) == 2


@pytest.mark.asyncio
async def test_run_grading_task_returns_failed_status_with_detailed_audit_on_primary_error(
    db_session: AsyncSession,
) -> None:
    # 回归：以前 service 在主评 / 复核失败时 raise，外层 wrapper 会 rollback 掉
    # 这条详细审计，运维只能看到 "stage=dispatch" 的粗糙记录。现在 service
    # 改成返回 failed dict + 已写入详细 audit，确保异常类型 / provider / 错误
    # 文案都能落盘。
    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="解释幂等性",
        max_score=10,
        student_answer_raw="重复执行结果相同。",
        standard_answers=[{"summary": "重复执行结果一致"}],
        rubric_definition={"dimensions": [{"key": "coverage", "weight": 1.0}]},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    primary_provider = FailingProvider(
        GradingProviderError(
            message="normalized provider payload field 'strengths' must be a list",
            provider_name="qwen",
            model_name="qwen-plus",
            raw_excerpt='{"strengths": "答得不错"}',
        )
    )
    review_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "review"},
            score_total=9,
            dimension_scores={"coverage": 9},
            deduction_reasons=[],
            strengths=[],
            improvement_suggestions=[],
            evidence_summary={},
            risk_flags=[],
            provider_key="deepseek-direct",
            provider_name="deepseek",
            model_name="deepseek-v4-flash",
            metadata={},
        )
    )

    result = await run_grading_task(db_session, str(task.id), primary_provider, review_provider)
    await db_session.commit()

    assert result["status"] == "failed"
    assert result["arbitration_required"] is False
    assert result["reason"] == "primary"

    refreshed = await db_session.get(GradingTask, task.id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.latest_final_snapshot_id is None

    audit_result = await db_session.execute(
        select(GradingAuditEvent).where(
            GradingAuditEvent.task_id == task.id,
            GradingAuditEvent.event_type == "grading.failed",
        )
    )
    failed_events = list(audit_result.scalars().all())
    assert len(failed_events) == 1
    payload = failed_events[0].event_payload
    assert payload["stage"] == "primary"
    assert payload["provider"] == "qwen"
    assert payload["model_name"] == "qwen-plus"
    assert payload["exception_type"].endswith("GradingProviderError")
    assert "strengths" in payload["message"]
    assert payload["raw_excerpt"] == '{"strengths": "答得不错"}'


@pytest.mark.asyncio
async def test_run_grading_task_falls_back_to_review_when_arbiter_fails_on_conflict(
    db_session: AsyncSession,
) -> None:
    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="解释幂等性",
        max_score=10,
        student_answer_raw="幂等就是重复执行结果相同。",
        standard_answers=[{"summary": "重复执行结果一致"}],
        rubric_definition={"dimensions": [{"key": "coverage", "weight": 1.0}]},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    primary_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "primary"},
            score_total=10,
            dimension_scores={"coverage": 10},
            deduction_reasons=[],
            strengths=["回答到位"],
            improvement_suggestions=[],
            evidence_summary={},
            risk_flags=[],
            provider_key="qwen-direct",
            provider_name="qwen",
            model_name="qwen-plus",
            metadata={},
        )
    )
    review_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "review"},
            score_total=7,
            dimension_scores={"coverage": 7},
            deduction_reasons=["缺少副作用说明"],
            strengths=["主旨正确"],
            improvement_suggestions=["补充示例"],
            evidence_summary={"note": "review"},
            risk_flags=["needs_detail"],
            provider_key="deepseek-direct",
            provider_name="deepseek",
            model_name="deepseek-v4-flash",
            metadata={},
        )
    )
    arbiter_provider = FailingProvider(
        GradingProviderError(
            message="Client error '400 Bad Request' for url ...",
            provider_name="doubao",
            model_name="doubao-seed-2-0-lite-260428",
            raw_excerpt='{"error":{"code":"InvalidParameter"}}',
        )
    )

    result = await run_grading_task(
        db_session, str(task.id), primary_provider, review_provider, arbiter_provider
    )
    await db_session.commit()

    assert result["status"] == "completed"
    assert result["arbitration_required"] is False
    assert result["arbiter_fallback"] is True

    refreshed_task = await db_session.get(GradingTask, task.id)
    assert refreshed_task is not None
    assert refreshed_task.latest_final_snapshot_id is not None
    assert refreshed_task.latest_arbitration_snapshot_id is None

    snapshots_result = await db_session.execute(
        select(GradingResultSnapshot).where(GradingResultSnapshot.task_id == task.id)
    )
    snapshots = list(snapshots_result.scalars().all())
    assert {snapshot.snapshot_type for snapshot in snapshots} == {"primary", "review", "final"}

    final_snapshot = next(snapshot for snapshot in snapshots if snapshot.snapshot_type == "final")
    assert final_snapshot.score_total == 7
    assert final_snapshot.dimension_scores == {"coverage": 7}
    assert final_snapshot.risk_flags == ["needs_detail"]

    audit_result = await db_session.execute(
        select(GradingAuditEvent).where(GradingAuditEvent.task_id == task.id)
    )
    audit_events = list(audit_result.scalars().all())
    event_types = {event.event_type for event in audit_events}
    assert {
        "grading.arbitration_required",
        "grading.arbiter_failed",
        "grading.finalized",
    } <= event_types

    finalized = next(event for event in audit_events if event.event_type == "grading.finalized")
    assert finalized.event_payload.get("source") == "review_fallback"

    failed = next(event for event in audit_events if event.event_type == "grading.arbiter_failed")
    assert failed.event_payload.get("fallback") == "review"


@pytest.mark.asyncio
async def test_run_grading_task_falls_back_to_review_when_arbiter_missing_on_conflict(
    db_session: AsyncSession,
) -> None:
    await _create_role_binding_stack(db_session)

    task = GradingTask(
        source_type="single_debug",
        question_type="short_answer",
        question_content="解释幂等性",
        max_score=10,
        student_answer_raw="幂等就是重复执行结果相同。",
        standard_answers=[{"summary": "重复执行结果一致"}],
        rubric_definition={"dimensions": [{"key": "coverage", "weight": 1.0}]},
        role_binding_version=1,
        status="pending",
    )
    db_session.add(task)
    await db_session.flush()

    primary_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "primary"},
            score_total=10,
            dimension_scores={"coverage": 10},
            deduction_reasons=[],
            strengths=[],
            improvement_suggestions=[],
            evidence_summary={},
            risk_flags=[],
            provider_key="qwen-direct",
            provider_name="qwen",
            model_name="qwen-plus",
            metadata={},
        )
    )
    review_provider = FakeProvider(
        GradingProviderResult(
            raw_content={"provider": "review"},
            score_total=6,
            dimension_scores={"coverage": 6},
            deduction_reasons=["核心要点缺失"],
            strengths=[],
            improvement_suggestions=[],
            evidence_summary={},
            risk_flags=[],
            provider_key="deepseek-direct",
            provider_name="deepseek",
            model_name="deepseek-v4-flash",
            metadata={},
        )
    )

    result = await run_grading_task(
        db_session, str(task.id), primary_provider, review_provider, None
    )
    await db_session.commit()

    assert result["status"] == "completed"
    assert result["arbitration_required"] is False
    assert result["arbiter_fallback"] is True

    refreshed_task = await db_session.get(GradingTask, task.id)
    assert refreshed_task is not None
    assert refreshed_task.latest_final_snapshot is not None
    assert refreshed_task.latest_final_snapshot.score_total == 6


@pytest.mark.asyncio
async def test_build_provider_for_model_reads_api_key_from_environment(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    qwen_provider = ProviderConfig(
        key="qwen-direct",
        provider_type="qwen",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        credential_env="EXAM_QWEN_API_KEY",
        is_active=True,
    )
    deepseek_provider = ProviderConfig(
        key="deepseek-direct",
        provider_type="deepseek",
        base_url="https://api.deepseek.com/v1",
        credential_env="EXAM_DEEPSEEK_API_KEY",
        is_active=True,
    )
    openrouter_provider = ProviderConfig(
        key="openrouter-arbiter",
        provider_type="openrouter",
        base_url="https://openrouter.ai/api/v1",
        credential_env="EXAM_OPENROUTER_API_KEY",
        is_active=True,
    )
    db_session.add_all([qwen_provider, deepseek_provider, openrouter_provider])
    await db_session.flush()

    qwen_model = ModelConfig(
        key="qwen-grader-v1",
        display_name="Qwen Grader",
        model_name="qwen-plus",
        provider_id=qwen_provider.id,
        temperature=0.1,
        is_active=True,
    )
    deepseek_model = ModelConfig(
        key="deepseek-review-v1",
        display_name="DeepSeek Reviewer",
        model_name="deepseek-v4-flash",
        provider_id=deepseek_provider.id,
        temperature=0.2,
        is_active=True,
    )
    openrouter_model = ModelConfig(
        key="claude-arbiter-v1",
        display_name="Claude Sonnet 4.6",
        model_name="anthropic/claude-sonnet-4.6",
        provider_id=openrouter_provider.id,
        temperature=0.0,
        is_active=True,
    )
    db_session.add_all([qwen_model, deepseek_model, openrouter_model])
    await db_session.flush()

    monkeypatch.setenv("EXAM_QWEN_API_KEY", "qwen-secret")
    monkeypatch.setenv("EXAM_DEEPSEEK_API_KEY", "deepseek-secret")
    monkeypatch.setenv("EXAM_OPENROUTER_API_KEY", "openrouter-secret")

    await db_session.refresh(qwen_model, ["provider"])
    await db_session.refresh(deepseek_model, ["provider"])
    await db_session.refresh(openrouter_model, ["provider"])

    qwen_client = _build_provider_for_model(qwen_model)
    deepseek_client = _build_provider_for_model(deepseek_model)
    openrouter_client = _build_provider_for_model(openrouter_model)

    assert isinstance(qwen_client, QwenProvider)
    assert isinstance(deepseek_client, DeepSeekProvider)
    assert isinstance(openrouter_client, OpenRouterProvider)
    assert qwen_client.api_key == "qwen-secret"
    assert deepseek_client.api_key == "deepseek-secret"
    assert openrouter_client.api_key == "openrouter-secret"


@pytest.mark.asyncio
async def test_build_provider_for_model_falls_back_to_settings_loaded_env_file(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider = ProviderConfig(
        key="qwen-direct",
        provider_type="qwen",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        credential_env="EXAM_QWEN_API_KEY",
        is_active=True,
    )
    db_session.add(provider)
    await db_session.flush()

    model = ModelConfig(
        key="qwen-grader-v1",
        display_name="Qwen Grader",
        model_name="qwen-plus",
        provider_id=provider.id,
        temperature=0.1,
        is_active=True,
    )
    db_session.add(model)
    await db_session.flush()
    await db_session.refresh(model, ["provider"])

    monkeypatch.delenv("EXAM_QWEN_API_KEY", raising=False)

    from app.grading import service as grading_service

    original_key = grading_service.settings.qwen_api_key
    grading_service.settings.qwen_api_key = "settings-loaded-qwen-key"
    try:
        qwen_client = _build_provider_for_model(model)
    finally:
        grading_service.settings.qwen_api_key = original_key

    assert isinstance(qwen_client, QwenProvider)
    assert qwen_client.api_key == "settings-loaded-qwen-key"
