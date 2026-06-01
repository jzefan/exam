import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.auth.models import User
from app.exams.models import Exam, StudentExamAppeal
from app.grading.models import GradingResultSnapshot, GradingTask, ModelConfig, ProviderConfig, RoleBinding
from app.questions.models import Question, QuestionType


async def _seed_role_binding_v1(db_session: AsyncSession) -> None:
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
        temperature=0.1,
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

    db_session.add(
        RoleBinding(
            version=1,
            grader_model_id=qwen_model.id,
            reviewer_model_id=deepseek_model.id,
            arbiter_model_id=openrouter_model.id,
            is_active=True,
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_create_grading_task_returns_pending_task(admin_client) -> None:
    response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "single_debug",
            "question_type": "short_answer",
            "question_content": "什么是幂等性",
            "max_score": 10,
            "student_answer_raw": "重复执行结果一致",
            "standard_answers": [{"summary": "同一请求多次执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["status"] == "pending"
    assert payload["question_type"] == "short_answer"


@pytest.mark.asyncio
async def test_list_grading_tasks_returns_workbench_items(admin_client) -> None:
    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": "exam-java-midterm:code-q5:B-208",
            "question_type": "code",
            "question_content": "实现 two sum",
            "max_score": 100,
            "student_answer_raw": "def two_sum(nums, target): return []",
            "standard_answers": [{"summary": "返回正确下标"}],
            "rubric_definition": {"dimensions": [{"key": "correctness", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    list_response = await admin_client.get("/api/grading/tasks")

    assert list_response.status_code == 200
    payload = list_response.json()
    assert len(payload) == 1
    assert payload[0]["id"] == task_id
    assert payload[0]["source_business_id"] == "exam-java-midterm:code-q5:B-208"
    assert payload[0]["status"] == "pending"
    assert payload[0]["final_score"] is None
    assert payload[0]["arbitration_required"] is False
    assert payload[0]["manual_override"] is False


@pytest.mark.asyncio
async def test_manual_score_override_creates_audit_facing_snapshot(admin_client) -> None:
    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "single_debug",
            "question_type": "short_answer",
            "question_content": "什么是幂等性",
            "max_score": 10,
            "student_answer_raw": "重复执行结果一致",
            "standard_answers": [{"summary": "同一请求多次执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    override_response = await admin_client.post(
        f"/api/grading/tasks/{task_id}/manual-score",
        json={"score_total": 9, "reason": "教师确认语义已覆盖"},
    )

    assert override_response.status_code == 200
    payload = override_response.json()
    assert payload["score_total"] == 9
    assert payload["snapshot_type"] == "manual"


@pytest.mark.asyncio
async def test_confirm_grading_task_supports_legacy_exam_submission_locator(admin_client) -> None:
    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": "exam-java-midterm:essay-q3:A-102",
            "question_type": "short_answer",
            "question_content": "什么是幂等性",
            "max_score": 10,
            "student_answer_raw": "重复执行结果一致",
            "standard_answers": [{"summary": "同一请求多次执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    await admin_client.post(
        f"/api/grading/tasks/{task_id}/manual-score",
        json={"score_total": 9, "reason": "教师确认语义已覆盖"},
    )

    confirm_response = await admin_client.post(f"/api/grading/tasks/{task_id}/confirm")

    assert confirm_response.status_code == 200
    payload = confirm_response.json()
    assert payload["status"] == "pending"
    assert payload["grading_status"] == "reviewed"


@pytest.mark.asyncio
async def test_get_grading_report_returns_manual_final_score(admin_client) -> None:
    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "single_debug",
            "question_type": "short_answer",
            "question_content": "什么是幂等性",
            "max_score": 10,
            "student_answer_raw": "重复执行结果一致",
            "standard_answers": [{"summary": "同一请求多次执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    await admin_client.post(
        f"/api/grading/tasks/{task_id}/manual-score",
        json={"score_total": 9, "reason": "教师确认语义已覆盖"},
    )

    report_response = await admin_client.get(f"/api/grading/tasks/{task_id}/report")

    assert report_response.status_code == 200
    payload = report_response.json()
    assert payload["task_id"] == task_id
    assert payload["status"] == "pending"
    assert payload["question_type"] == "short_answer"
    assert payload["final_score"] == 9
    assert payload["result_source"] == "manual"
    assert payload["context"]["question_content"] == "什么是幂等性"
    assert payload["context"]["student_answer_raw"] == "重复执行结果一致"
    assert payload["context"]["execution_evidence"]["test_summary"] is None
    assert payload["snapshots"][0]["snapshot_type"] == "manual"
    assert payload["snapshots"][0]["deduction_reasons"] == ["教师确认语义已覆盖"]
    assert payload["audit_events"][-1]["event_type"] == "manual.score_override"


@pytest.mark.asyncio
async def test_pending_grading_candidate_detail_triggers_on_demand_grading(
    admin_client,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "single_debug",
            "question_type": "short_answer",
            "question_content": "什么是幂等性",
            "max_score": 10,
            "student_answer_raw": "重复执行结果一致",
            "standard_answers": [{"summary": "同一请求多次执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    async def fake_run(db, current_task_id: str, *args, **kwargs):
        task = await db.get(GradingTask, uuid.UUID(current_task_id))
        snapshot = GradingResultSnapshot(
            task_id=task.id,
            snapshot_type="final",
            score_total=8,
            dimension_scores={"coverage": 8},
            dimension_comments={},
            deduction_reasons=[],
            strengths=["自动补跑后生成建议分"],
            improvement_suggestions=[],
            evidence_summary={"summary": "已完成评分"},
            risk_flags=[],
            prompt_template_version=task.prompt_template_version,
            role_binding_version=task.role_binding_version,
            created_by="system",
        )
        db.add(snapshot)
        await db.flush()
        task.latest_final_snapshot = snapshot
        task.status = "completed"
        return {"status": "completed", "arbitration_required": False, "reason": None}

    async def fake_apply(*_args, **_kwargs):
        return {"status": "completed"}

    monkeypatch.setattr("app.grading.service.run_grading_task_with_role_binding", fake_run)
    monkeypatch.setattr("app.grading.service.apply_grading_task_result_to_exam_submission", fake_apply)

    detail_response = await admin_client.get(f"/api/grading/inbox/tasks/{task_id}")

    assert detail_response.status_code == 200
    payload = detail_response.json()
    assert payload["suggested_score"] == 8
    assert payload["evaluation_note"] is None


@pytest.mark.asyncio
async def test_grading_inbox_uses_real_exam_and_candidate_labels(
    admin_client,
    db_session: AsyncSession,
) -> None:
    creator = await create_user(
        db_session,
        UserCreate(
            username="teacher_inbox",
            email="teacher_inbox@example.com",
            password="teacherpass123",
            full_name="阅卷老师",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_inbox",
            email="student_inbox@example.com",
            password="studentpass123",
            full_name="张三",
        ),
    )
    student.student_id = "S2026001"

    exam = Exam(
        title="Java 后端期中考试",
        description=None,
        duration_minutes=90,
        total_score=100,
        status="draft",
        position_id=None,
        max_switch_count=0,
        show_result=False,
        notes_template=None,
        created_by=creator.id,
        owner_id=creator.id,
    )
    question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="什么是幂等性",
        content={"text": "什么是幂等性"},
        options=None,
        answer={"points": ["重复执行结果一致"]},
        analysis=None,
        difficulty=3,
        score=10,
        created_by=creator.id,
        owner_id=creator.id,
    )
    db_session.add_all([exam, question])
    await db_session.commit()

    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": f"{exam.id}:{question.id}:{student.id}",
            "question_type": "short_answer",
            "question_content": "什么是幂等性，请一句话解释。",
            "max_score": 10,
            "student_answer_raw": "同一个请求重复执行多次，结果保持一致。",
            "standard_answers": [{"summary": "重复执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 1}]},
            "role_binding_version": 1,
        },
    )

    task_id = create_response.json()["id"]

    inbox_response = await admin_client.get("/api/grading/inbox")
    assert inbox_response.status_code == 200
    inbox_payload = inbox_response.json()
    assert inbox_payload["exams"][0]["exam_label"] == "Java 后端期中考试"

    question_response = await admin_client.get(f"/api/grading/inbox/questions/{exam.id}/{question.id}")
    assert question_response.status_code == 200
    question_payload = question_response.json()
    assert question_payload["exam_label"] == "Java 后端期中考试"
    assert question_payload["candidates"][0]["candidate_name"] == "张三"
    assert question_payload["candidates"][0]["candidate_code"] == "S2026001"

    detail_response = await admin_client.get(f"/api/grading/inbox/tasks/{task_id}")
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()
    assert detail_payload["candidate_name"] == "张三"
    assert detail_payload["candidate_code"] == "S2026001"


@pytest.mark.asyncio
async def test_teacher_grading_inbox_only_includes_owned_exam_tasks(
    client,
    db_session: AsyncSession,
) -> None:
    teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_grading_owner",
            email="teacher_grading_owner@example.com",
            password="teacherpass123",
            full_name="Owner Teacher",
        ),
    )
    other_teacher = await create_user(
        db_session,
        UserCreate(
            username="teacher_grading_other",
            email="teacher_grading_other@example.com",
            password="teacherpass123",
            full_name="Other Teacher",
        ),
    )
    student = await create_user(
        db_session,
        UserCreate(
            username="student_grading_scope",
            email="student_grading_scope@example.com",
            password="studentpass123",
            full_name="Scope Student",
        ),
    )
    own_exam = Exam(
        title="我的阅卷考试",
        duration_minutes=60,
        total_score=10,
        status="completed",
        max_switch_count=0,
        show_result=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    other_exam = Exam(
        title="他人阅卷考试",
        duration_minutes=60,
        total_score=10,
        status="completed",
        max_switch_count=0,
        show_result=True,
        created_by=other_teacher.id,
        owner_id=other_teacher.id,
    )
    question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="阅卷范围题",
        content={"text": "scope"},
        options=None,
        answer={"points": ["scope"]},
        analysis=None,
        difficulty=2,
        score=10,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([own_exam, other_exam, question])
    await db_session.flush()

    own_task = GradingTask(
        source_type="exam_submission",
        source_business_id=f"{own_exam.id}:{question.id}:{student.id}",
        question_type="short_answer",
        question_content="scope",
        max_score=10,
        student_answer_raw="scope",
        standard_answers=[],
        rubric_definition={},
        knowledge_tags=[],
        role_binding_version=1,
        status="pending",
    )
    other_task = GradingTask(
        source_type="exam_submission",
        source_business_id=f"{other_exam.id}:{question.id}:{student.id}",
        question_type="short_answer",
        question_content="scope",
        max_score=10,
        student_answer_raw="scope",
        standard_answers=[],
        rubric_definition={},
        knowledge_tags=[],
        role_binding_version=1,
        status="pending",
    )
    db_session.add_all([own_task, other_task])
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    inbox_response = await client.get("/api/grading/inbox")
    detail_response = await client.get(f"/api/grading/inbox/tasks/{other_task.id}")

    assert inbox_response.status_code == 200
    assert [exam["exam_label"] for exam in inbox_response.json()["exams"]] == ["我的阅卷考试"]
    assert detail_response.status_code == 404


@pytest.mark.asyncio
async def test_run_grading_task_endpoint_executes_three_role_flow(
    admin_client,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.grading.service.settings.arbiter_enabled", True)
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
        temperature=0.1,
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

    binding = RoleBinding(
        version=1,
        grader_model_id=qwen_model.id,
        reviewer_model_id=deepseek_model.id,
        arbiter_model_id=openrouter_model.id,
        is_active=True,
    )
    db_session.add(binding)
    await db_session.commit()

    monkeypatch.setenv("EXAM_QWEN_API_KEY", "qwen-secret")
    monkeypatch.setenv("EXAM_DEEPSEEK_API_KEY", "deepseek-secret")
    monkeypatch.setenv("EXAM_OPENROUTER_API_KEY", "openrouter-secret")

    async def fake_request_completion(self, payload):
        if self.provider_name == "qwen":
            return {
                "choices": [
                    {"message": {"content": '{"score_total": 60, "dimension_scores": {"correctness": 20}, "deduction_reasons": ["功能未完成"], "strengths": ["结构还行"], "improvement_suggestions": ["补齐主逻辑"], "evidence_summary": {"tests_passed": 1}, "risk_flags": []}'}}
                ]
            }
        if self.provider_name == "deepseek":
            return {
                "choices": [
                    {"message": {"content": '{"score_total": 82, "dimension_scores": {"correctness": 34}, "deduction_reasons": ["只有小问题"], "strengths": ["功能大致可用"], "improvement_suggestions": ["补充异常处理"], "evidence_summary": {"tests_passed": 2}, "risk_flags": []}'}}
                ]
            }
        return {
            "choices": [
                {"message": {"content": '{"score_total": 76, "dimension_scores": {"correctness": 30}, "deduction_reasons": ["关键分支未覆盖"], "strengths": ["思路基本正确"], "improvement_suggestions": ["补齐返回路径并覆盖边界输入"], "evidence_summary": {"resolved_reason": "score_diff"}, "risk_flags": ["arbiter_resolved"]}'}}
            ]
        }

    monkeypatch.setattr(
        "app.grading.providers.base.BaseGradingProvider._request_completion",
        fake_request_completion,
    )

    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "single_debug",
            "question_type": "code",
            "question_content": "实现 two sum",
            "max_score": 100,
            "student_answer_raw": "def two_sum(nums, target): return []",
            "standard_answers": [{"summary": "返回正确下标"}],
            "rubric_definition": {"dimensions": [{"key": "correctness", "weight": 0.4}]},
            "test_summary": {"passed": 1, "total": 3},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    run_response = await admin_client.post(f"/api/grading/tasks/{task_id}/run")

    assert run_response.status_code == 200
    payload = run_response.json()
    assert payload["status"] == "completed"
    assert payload["arbitration_required"] is False
    assert payload["reason"] == "score_diff"


@pytest.mark.asyncio
async def test_get_grading_report_returns_rich_code_task_details(
    admin_client,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.grading.service.settings.arbiter_enabled", True)
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
        temperature=0.1,
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

    binding = RoleBinding(
        version=1,
        grader_model_id=qwen_model.id,
        reviewer_model_id=deepseek_model.id,
        arbiter_model_id=openrouter_model.id,
        is_active=True,
    )
    db_session.add(binding)
    await db_session.commit()

    monkeypatch.setenv("EXAM_QWEN_API_KEY", "qwen-secret")
    monkeypatch.setenv("EXAM_DEEPSEEK_API_KEY", "deepseek-secret")
    monkeypatch.setenv("EXAM_OPENROUTER_API_KEY", "openrouter-secret")

    async def fake_request_completion(self, payload):
        if self.provider_name == "qwen":
            return {
                "choices": [
                    {"message": {"content": '{"score_total": 60, "dimension_scores": {"correctness": 20}, "deduction_reasons": ["功能未完成"], "strengths": ["结构还行"], "improvement_suggestions": ["补齐主逻辑"], "evidence_summary": {"tests_passed": 1}, "risk_flags": []}'}}
                ]
            }
        if self.provider_name == "deepseek":
            return {
                "choices": [
                    {"message": {"content": '{"score_total": 82, "dimension_scores": {"correctness": 34}, "deduction_reasons": ["只有小问题"], "strengths": ["功能大致可用"], "improvement_suggestions": ["补充异常处理"], "evidence_summary": {"tests_passed": 2}, "risk_flags": []}'}}
                ]
            }
        return {
            "choices": [
                {"message": {"content": '{"score_total": 76, "dimension_scores": {"correctness": 30}, "deduction_reasons": ["关键分支未覆盖"], "strengths": ["思路基本正确"], "improvement_suggestions": ["补齐返回路径并覆盖边界输入"], "evidence_summary": {"resolved_reason": "score_diff"}, "risk_flags": ["arbiter_resolved"]}'}}
            ]
        }

    monkeypatch.setattr(
        "app.grading.providers.base.BaseGradingProvider._request_completion",
        fake_request_completion,
    )

    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": "exam-1:code-q5:candidate-b208",
            "question_type": "code",
            "question_content": "实现 two sum",
            "max_score": 100,
            "student_answer_raw": "def two_sum(nums, target): return []",
            "standard_answers": [{"summary": "返回正确下标"}],
            "rubric_definition": {"dimensions": [{"key": "correctness", "weight": 0.4}]},
            "scoring_points": [{"label": "返回正确下标"}],
            "dimension_weights": {"correctness": 0.4},
            "test_summary": {"passed": 1, "total": 3},
            "compile_result": {"status": "passed"},
            "runtime_result": {"status": "failed"},
            "runtime_logs": [{"message": "Case 1 failed"}],
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    await admin_client.post(f"/api/grading/tasks/{task_id}/run")
    report_response = await admin_client.get(f"/api/grading/tasks/{task_id}/report")

    assert report_response.status_code == 200
    payload = report_response.json()
    assert payload["task_id"] == task_id
    assert payload["status"] == "completed"
    assert payload["result_source"] == "arbiter"
    assert payload["context"]["source_type"] == "exam_submission"
    assert payload["context"]["execution_evidence"]["test_summary"] == {"passed": 1, "total": 3}
    assert payload["context"]["execution_evidence"]["compile_result"] == {"status": "passed"}
    assert payload["snapshots"][0]["snapshot_type"] == "primary"
    assert payload["snapshots"][0]["model_label"] == "Qwen Grader / qwen-plus"
    assert payload["snapshots"][1]["snapshot_type"] == "review"
    assert payload["snapshots"][2]["snapshot_type"] == "arbiter"
    assert payload["snapshots"][3]["snapshot_type"] == "final"
    assert payload["snapshots"][3]["model_label"] == "Arbiter Final / resolved"
    assert any(event["event_type"] == "grading.finalized" for event in payload["audit_events"])


@pytest.mark.asyncio
async def test_grading_inbox_endpoint_returns_exam_grouped_questions(admin_client) -> None:
    await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": "exam-java-midterm:essay-q3:A-102",
            "question_type": "short_answer",
            "question_content": "什么是幂等性？",
            "max_score": 20,
            "knowledge_tags": ["接口设计", "幂等"],
            "student_answer_raw": "重复执行结果一致",
            "standard_answers": [{"summary": "重复执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": "exam-java-midterm:essay-q3:A-115",
            "question_type": "short_answer",
            "question_content": "什么是幂等性？",
            "max_score": 20,
            "knowledge_tags": ["接口设计", "幂等"],
            "student_answer_raw": "不会多扣款",
            "standard_answers": [{"summary": "重复执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]
    await admin_client.post(
        f"/api/grading/tasks/{task_id}/manual-score",
        json={"score_total": 18, "reason": "教师确认可直接通过"},
    )

    response = await admin_client.get("/api/grading/inbox")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["exams"]) == 1
    exam = payload["exams"][0]
    assert exam["exam_id"] == "exam-java-midterm"
    assert exam["exam_label"] == "Java Midterm"
    assert len(exam["questions"]) == 1
    question = exam["questions"][0]
    assert question["question_id"] == "essay-q3"
    assert question["question_label"] == "主观题 3"
    assert question["pending_count"] == 1
    assert question["completed_count"] == 1
    assert question["candidate_count"] == 2


@pytest.mark.asyncio
async def test_grading_question_candidates_endpoint_returns_question_workspace(admin_client) -> None:
    first_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": "exam-java-midterm:essay-q3:A-102",
            "question_type": "short_answer",
            "question_content": "什么是幂等性？",
            "max_score": 20,
            "student_answer_raw": "重复执行结果一致",
            "standard_answers": [{"summary": "重复执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    second_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": "exam-java-midterm:essay-q3:A-115",
            "question_type": "short_answer",
            "question_content": "什么是幂等性？",
            "max_score": 20,
            "student_answer_raw": "不会多扣款",
            "standard_answers": [{"summary": "重复执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    await admin_client.post(
        f"/api/grading/tasks/{second_response.json()['id']}/manual-score",
        json={"score_total": 18, "reason": "教师确认可直接通过"},
    )

    response = await admin_client.get("/api/grading/inbox/questions/exam-java-midterm/essay-q3")

    assert response.status_code == 200
    payload = response.json()
    assert payload["question_id"] == "essay-q3"
    assert payload["question_label"] == "主观题 3"
    assert payload["max_score"] == 20
    assert [candidate["candidate_name"] for candidate in payload["candidates"]] == ["考生 A-115", "考生 A-102"]
    assert payload["candidates"][0]["status"] == "人工改分"
    assert payload["candidates"][1]["status"] == "待评分"
    assert payload["candidates"][0]["score"] == 18
    assert payload["candidates"][0]["manual_override"] is True
    assert first_response.json()["id"] == payload["candidates"][1]["task_id"]


@pytest.mark.asyncio
async def test_grading_candidate_detail_endpoint_returns_llm_comments(
    admin_client,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.grading.service.settings.arbiter_enabled", True)
    await _seed_role_binding_v1(db_session)
    monkeypatch.setenv("EXAM_QWEN_API_KEY", "qwen-secret")
    monkeypatch.setenv("EXAM_DEEPSEEK_API_KEY", "deepseek-secret")
    monkeypatch.setenv("EXAM_OPENROUTER_API_KEY", "openrouter-secret")

    async def fake_request_completion(self, payload):
        if self.provider_name == "qwen":
            return {
                "choices": [
                    {"message": {"content": '{"score_total": 10, "dimension_scores": {"coverage": 10}, "deduction_reasons": ["术语稍弱"], "strengths": ["定义正确"], "improvement_suggestions": ["补充副作用"], "evidence_summary": {"points": ["same_result"]}, "risk_flags": []}'}}
                ]
            }
        if self.provider_name == "deepseek":
            return {
                "choices": [
                    {"message": {"content": '{"score_total": 18, "dimension_scores": {"coverage": 18}, "deduction_reasons": ["场景略少"], "strengths": ["表达简洁"], "improvement_suggestions": ["补一个接口例子"], "evidence_summary": {"points": ["same_result", "business_case"]}, "risk_flags": []}'}}
                ]
            }
        return {
            "choices": [
                {"message": {"content": '{"score_total": 16, "dimension_scores": {"coverage": 16}, "deduction_reasons": ["综合后保持中间值"], "strengths": ["理解正确"], "improvement_suggestions": ["补充术语"], "evidence_summary": {"resolved_reason": "score_diff"}, "risk_flags": ["arbiter_resolved"]}'}}
            ]
        }

    monkeypatch.setattr(
        "app.grading.providers.base.BaseGradingProvider._request_completion",
        fake_request_completion,
    )

    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": "exam-java-midterm:essay-q3:A-102",
            "question_type": "short_answer",
            "question_content": "什么是幂等性？",
            "max_score": 20,
            "knowledge_tags": ["接口设计", "幂等"],
            "student_answer_raw": "同一个请求重复执行，结果保持一致。",
            "standard_answers": [{"summary": "重复执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]
    await admin_client.post(f"/api/grading/tasks/{task_id}/run")

    response = await admin_client.get(f"/api/grading/inbox/tasks/{task_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["task_id"] == task_id
    assert payload["candidate_name"] == "考生 A-102"
    assert payload["candidate_code"] == "A-102"
    assert payload["suggested_score"] == 16
    assert payload["student_answer_raw"] == "同一个请求重复执行，结果保持一致。"
    assert payload["attachment_refs"] == []
    assert [model["stage"] for model in payload["models"]] == ["primary", "review", "arbiter"]
    assert payload["models"][0]["model_label"] == "Qwen Grader / qwen-plus"
    assert payload["models"][0]["process"]

    # Re-grade the same task. After the second run, the inbox detail must
    # still show exactly one snapshot per role — not 2× Qwen / 2× DeepSeek /
    # 2× Doubao. Historical snapshots stay in the DB for audit but the
    # response only surfaces the latest per role.
    second_run = await admin_client.post(f"/api/grading/tasks/{task_id}/run")
    assert second_run.status_code == 200
    second_response = await admin_client.get(f"/api/grading/inbox/tasks/{task_id}")
    assert second_response.status_code == 200
    stages = [model["stage"] for model in second_response.json()["models"]]
    assert stages == ["primary", "review", "arbiter"]
    assert len(stages) == len(set(stages)), "duplicate roles in inbox detail after re-grade"


@pytest.mark.asyncio
async def test_grading_candidate_detail_endpoint_returns_attachment_refs(
    admin_client,
    db_session: AsyncSession,
) -> None:
    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": "exam-java-midterm:essay-q3:A-102",
            "question_type": "short_answer",
            "question_content": "请结合附件说明设计思路",
            "max_score": 20,
            "knowledge_tags": ["结构化表达"],
            "student_answer_raw": "",
            "attachment_refs": [
                {"name": "设计说明.docx", "url": "/api/uploads/files/design.docx"},
                {"name": "草图.png", "url": "/api/uploads/files/sketch.png"},
            ],
            "standard_answers": [{"summary": "说明设计思路"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    response = await admin_client.get(f"/api/grading/inbox/tasks/{task_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["attachment_refs"] == [
        {"name": "设计说明.docx", "url": "/api/uploads/files/design.docx"},
        {"name": "草图.png", "url": "/api/uploads/files/sketch.png"},
    ]


@pytest.mark.asyncio
async def test_grading_candidate_detail_endpoint_includes_student_feedback(
    admin_client,
    db_session: AsyncSession,
) -> None:
    student = User(
        username="stud-feedback",
        email="stud-feedback@example.com",
        password_hash="hashed",
        full_name="Stud Feedback",
        is_active=True,
    )
    db_session.add(student)
    await db_session.flush()

    question = Question(
        type=QuestionType.SHORT_ANSWER,
        title="什么是幂等性？",
        content={"html": "<p>什么是幂等性？</p>"},
        options=None,
        answer={"points": ["重复执行结果一致"]},
        analysis="关注重复执行后的系统状态。",
        difficulty=2,
        score=20,
        created_by=student.id,
        owner_id=student.id,
    )
    exam = Exam(
        title="反馈联调考试",
        description=None,
        duration_minutes=60,
        total_score=20,
        status="completed",
        max_switch_count=0,
        show_result=True,
        notes_template=None,
        created_by=student.id,
        owner_id=student.id,
    )
    db_session.add_all([question, exam])
    await db_session.flush()

    db_session.add(
        StudentExamAppeal(
            exam_id=exam.id,
            student_id=student.id,
            question_id=question.id,
            reason="我已经补充了重复写入场景，请老师再看一下。",
            teacher_reply="好的，我会结合你的说明重新检查。",
        )
    )
    await db_session.commit()

    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": f"{exam.id}:{question.id}:{student.username}",
            "question_type": "short_answer",
            "question_content": "什么是幂等性？",
            "max_score": 20,
            "student_answer_raw": "重复执行结果一致。",
            "standard_answers": [{"summary": "重复执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    response = await admin_client.get(f"/api/grading/inbox/tasks/{task_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["student_feedback"] == "我已经补充了重复写入场景，请老师再看一下。"
    assert payload["teacher_feedback_reply"] == "好的，我会结合你的说明重新检查。"
    assert payload["feedback_created_at"] is not None


@pytest.mark.asyncio
async def test_grading_prompt_follow_up_endpoint_returns_model_comments(
    admin_client,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _seed_role_binding_v1(db_session)
    monkeypatch.setenv("EXAM_QWEN_API_KEY", "qwen-secret")
    monkeypatch.setenv("EXAM_DEEPSEEK_API_KEY", "deepseek-secret")
    monkeypatch.setenv("EXAM_OPENROUTER_API_KEY", "openrouter-secret")

    captured_prompts: dict[str, str] = {}
    captured_system_prompts: dict[str, str] = {}

    async def fake_request_completion(self, payload):
        messages = payload["messages"]
        captured_system_prompts[self.provider_name] = messages[0]["content"]
        captured_prompts[self.provider_name] = messages[-1]["content"]
        if self.provider_name == "qwen":
            return {
                "choices": [
                    {"message": {"content": '{"score_total": 8, "dimension_scores": {"coverage": 8}, "deduction_reasons": ["请补充副作用说明"], "strengths": ["定义正确"], "improvement_suggestions": ["补充例子"], "evidence_summary": {"focus": ["idempotency"]}, "risk_flags": []}'}}
                ]
            }
        if self.provider_name == "deepseek":
            return {
                "choices": [
                    {"message": {"content": '{"score_total": 9, "dimension_scores": {"coverage": 9}, "deduction_reasons": ["术语还可更完整"], "strengths": ["表达简洁"], "improvement_suggestions": ["补充接口场景"], "evidence_summary": {"focus": ["knowledge_point"]}, "risk_flags": []}'}}
                ]
            }
        return {
            "choices": [
                {"message": {"content": '{"score_total": 8.5, "dimension_scores": {"coverage": 8.5}, "deduction_reasons": ["综合后建议补一个业务例子"], "strengths": ["理解正确"], "improvement_suggestions": ["补充边界条件"], "evidence_summary": {"focus": ["arbiter"]}, "risk_flags": ["follow_up"]}'}}
            ]
        }

    monkeypatch.setattr(
        "app.grading.providers.base.BaseGradingProvider._request_completion",
        fake_request_completion,
    )

    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": "exam-java-midterm:essay-q3:A-102",
            "question_type": "short_answer",
            "question_content": "什么是幂等性？",
            "max_score": 10,
            "knowledge_tags": ["接口设计", "幂等性"],
            "student_answer_raw": "同一个请求重复执行多次，结果保持一致。",
            "standard_answers": [{"summary": "重复执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    response = await admin_client.post(
        f"/api/grading/tasks/{task_id}/follow-up",
        json={"prompt": "请重点检查是否明确体现了副作用不会重复发生", "locale": "en-US"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["prompt"] == "请重点检查是否明确体现了副作用不会重复发生"
    assert [item["stage"] for item in payload["models"]] == ["primary", "review", "arbiter"]
    assert payload["models"][0]["model_label"] == "Qwen Grader / qwen-plus"
    assert payload["models"][2]["model_label"] == "Claude Sonnet 4.6 / anthropic/claude-sonnet-4.6"
    assert payload["models"][2]["risk_flags"] == ["follow_up"]
    assert "Teacher follow-up prompt: 请重点检查是否明确体现了副作用不会重复发生" in captured_prompts["qwen"]
    assert "高职高校课程评分专家" in captured_system_prompts["qwen"]
    assert "严格依据 Rubric" in captured_system_prompts["qwen"]
    assert "Respond in English." in captured_system_prompts["qwen"]
    assert "Preferred locale: en-US" in captured_prompts["qwen"]
    assert "Max score: 10" in captured_prompts["qwen"]
    assert 'Knowledge tags: ["接口设计", "幂等性"]' in captured_prompts["qwen"]


@pytest.mark.asyncio
async def test_grading_prompt_follow_up_keeps_multiple_history_rounds(
    admin_client,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _seed_role_binding_v1(db_session)
    monkeypatch.setenv("EXAM_QWEN_API_KEY", "qwen-secret")
    monkeypatch.setenv("EXAM_DEEPSEEK_API_KEY", "deepseek-secret")
    monkeypatch.setenv("EXAM_OPENROUTER_API_KEY", "openrouter-secret")

    async def fake_request_completion(self, payload):
        return {
            "choices": [
                {"message": {"content": '{"score_total": 8, "dimension_scores": {"coverage": 8}, "deduction_reasons": ["补充说明"], "strengths": ["方向正确"], "improvement_suggestions": ["再给例子"], "evidence_summary": {"focus": ["history"]}, "risk_flags": []}'}}
            ]
        }

    monkeypatch.setattr(
        "app.grading.providers.base.BaseGradingProvider._request_completion",
        fake_request_completion,
    )

    create_response = await admin_client.post(
        "/api/grading/tasks",
        json={
            "source_type": "exam_submission",
            "source_business_id": "exam-java-midterm:essay-q3:A-102",
            "question_type": "short_answer",
            "question_content": "什么是幂等性？",
            "max_score": 10,
            "knowledge_tags": ["接口设计", "幂等性"],
            "student_answer_raw": "同一个请求重复执行多次，结果保持一致。",
            "standard_answers": [{"summary": "重复执行结果一致"}],
            "rubric_definition": {"dimensions": [{"key": "coverage", "weight": 0.5}]},
            "role_binding_version": 1,
        },
    )
    task_id = create_response.json()["id"]

    for _ in range(2):
        response = await admin_client.post(
            f"/api/grading/tasks/{task_id}/follow-up",
            json={"prompt": "请再次确认是否覆盖副作用边界", "locale": "zh-CN"},
        )
        assert response.status_code == 200

    detail_response = await admin_client.get(f"/api/grading/inbox/tasks/{task_id}")
    assert detail_response.status_code == 200
    detail_payload = detail_response.json()
    matching = [item for item in detail_payload["follow_ups"] if item["prompt"] == "请再次确认是否覆盖副作用边界"]
    assert len(matching) == 2
