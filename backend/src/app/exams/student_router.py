import asyncio
import json
import logging
import os
import re
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, WebSocket, WebSocketException, status
import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.auth.external_guest_dependencies import get_actor_for_exam
from app.auth.models import User
from app.auth.security import decode_access_token
from app.code_runner.client import run_code_via_judge_runner
from app.code_runner.service import run_code
from app.config import settings
from app.database import async_session, get_db
from app.exams.models import (
    AppealStatus,
    Exam,
    ExamStudent,
    GradingStatus,
    StudentExamAnswer,
    StudentExamAppeal,
    StudentNotification,
    StudentExamSubmission,
    StudentExamSubmissionAnswer,
    StudentQuestionProgress,
)
from app.exams.time_utils import coerce_persisted_exam_datetime_to_utc
from app.exams.student_schemas import (
    AppealCreateRequest,
    AppealResponse,
    SaveAnswersRequest,
    StartExamRequest,
    StudentCodeRunRequest,
    StudentCodeRunResponse,
    SubmitExamRequest,
    SubmitExamResponse,
    StudentNotificationResponse,
    StudentExamResultQuestionResponse,
    StudentExamResultResponse,
    StudentExamStartResponse,
    StudentQuestionPayload,
    SwitchReportRequest,
    WrongAnswerDetailResponse,
    WrongAnswerListItem,
)
from app.grading.models import GradingAuditEvent, GradingTask, RoleBinding
from app.grading.service import (
    apply_grading_task_failure_to_exam_submission,
    apply_grading_task_result_to_exam_submission,
    create_grading_task,
    run_grading_task_with_role_binding,
)
from app.lsp_runner.client import proxy_lsp_websocket
from app.lsp_runner.schemas import LspGatewaySession, LspLanguage, SUPPORTED_LSP_LANGUAGES
from app.questions.models import Question, QuestionType

logger = logging.getLogger(__name__)

router = APIRouter()
wrong_answers_router = APIRouter()
ExamActor = Annotated[User, Depends(get_actor_for_exam)]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    return coerce_persisted_exam_datetime_to_utc(value)


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def _strip_html(value: str | None) -> str:
    if not value:
        return ""
    without_tags = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", without_tags).strip()


_FILL_IN_BLANK_PLACEHOLDER_RE = re.compile(r"_{3,}|（\s*）|\(\s*\)|【\s*】")
_FILL_IN_EDGE_PUNCT_RE = re.compile(r"^[\s,，、.。．;；:：]+|[\s,，、.。．;；:：]+$")
_FILL_IN_GRADING_MODEL = "deepseek-v4-flash"


def _get_fill_in_expected_answers(answer: dict[str, Any]) -> list[str]:
    raw = answer.get("blanks")
    if raw is None:
        raw = answer.get("correct")
    if isinstance(raw, list):
        return [str(item) for item in raw]
    if raw is None:
        return []
    return [str(raw)]


def _count_fill_in_placeholders(content: dict[str, Any]) -> int:
    text = content.get("text") or content.get("html") or ""
    if not isinstance(text, str):
        return 0
    return len(_FILL_IN_BLANK_PLACEHOLDER_RE.findall(text))


def _normalize_fill_in_text(value: str) -> str:
    return _FILL_IN_EDGE_PUNCT_RE.sub("", _normalize_text(value))


def _is_fill_in_exact_match(actual: str, expected: str) -> bool:
    return _normalize_fill_in_text(actual) == _normalize_fill_in_text(expected)




def _parse_json_response_payload(content: str) -> Any:
    payload = content.strip()
    if payload.startswith("```"):
        payload = re.sub(r"^```[a-zA-Z]*\s*", "", payload)
        payload = re.sub(r"\s*```\s*$", "", payload)
    return json.loads(payload)


def _trim_grading_background_error(value: str | None, max_length: int = 240) -> str | None:
    if not value:
        return None
    compact = re.sub(r"\s+", " ", value).strip()
    if len(compact) <= max_length:
        return compact
    return f"{compact[: max_length - 1].rstrip()}…"


def _get_question_plain_text(question: Question) -> str:
    content = question.content if isinstance(question.content, dict) else {}
    text = content.get("text") or content.get("html") or question.title
    return _strip_html(str(text))


async def _request_fill_in_equivalence_with_deepseek(
    *,
    question_text: str,
    expected_answers: list[str],
    student_answers: list[str],
) -> list[dict[str, Any]]:
    if not settings.deepseek_api_key:
        raise RuntimeError("未配置 DeepSeek API Key")

    prompt = f"""
你是考试填空题自动批改助手。请判断学生每个填空答案是否可接受。

判定原则：
1. 不要求字符串完全相同，允许大小写、末尾标点、轻微格式差异、常见中英文术语写法差异。
2. 只有语义或术语确实等价时才判为正确，不能因为主题相关就判正确。
3. 每个空独立判定，不要跨空合并给分。
4. 技术类等价写法应视为正确，包括但不限于：
   - 模块/包路径：学生只写末尾组件也算正确，例如标准答案为 numpy.random，学生答 random，应给分；matplotlib.pyplot → pyplot 同理。
   - 函数/方法引用：省略类名或模块前缀但指向同一目标时，视为正确。
   - 数据类型别名：如 int64 与 numpy.int64、str 与 String 在特定语境下等价。
   - 命令/路径：允许省略可推断的前缀或后缀（如文件扩展名、绝对路径中的公共前缀）。
5. 若学生写的是标准答案的合理缩写、别名或惯用简写（如 pd 代表 pandas、np 代表 numpy），且在题干语境下无歧义，应视为正确。

题干：{question_text}
标准答案：{json.dumps(expected_answers, ensure_ascii=False)}
学生答案：{json.dumps(student_answers, ensure_ascii=False)}

只输出 JSON：
{{
  "matches": [
    {{"is_correct": true, "reason": "简短理由"}}
  ]
}}
matches 的长度必须等于标准答案长度，顺序与标准答案一致。
"""

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{settings.deepseek_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.deepseek_api_key}"},
            json={
                "model": _FILL_IN_GRADING_MODEL,
                "messages": [
                    {"role": "system", "content": "你只输出合法 JSON，不要输出 Markdown。"},
                    {"role": "user", "content": prompt.strip()},
                ],
                "temperature": 0,
                "max_tokens": 2000,
            },
        )

    if response.status_code >= 400:
        raise RuntimeError(response.text.strip() or "DeepSeek 填空题判分失败")

    content = response.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("DeepSeek 没有返回填空题判分结果")

    payload = _parse_json_response_payload(content)
    matches = payload.get("matches") if isinstance(payload, dict) else payload
    if not isinstance(matches, list):
        raise RuntimeError("DeepSeek 填空题判分结果格式无效")
    return [item for item in matches if isinstance(item, dict)]


def _build_student_question_content(question: Question) -> dict[str, Any]:
    content = deepcopy(question.content) if isinstance(question.content, dict) else {}
    question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
    if question_type != QuestionType.FILL_IN.value:
        return content

    explicit_count = content.get("blank_count")
    counts = [
        explicit_count if isinstance(explicit_count, int) and explicit_count > 0 else 0,
        len(_get_fill_in_expected_answers(question.answer or {})),
        _count_fill_in_placeholders(content),
    ]
    content["blank_count"] = max(counts) or 1
    return content


def _extract_answer_text(answer_content: dict[str, Any]) -> str:
    code = answer_content.get("code")
    if isinstance(code, str) and code.strip():
        language = answer_content.get("language")
        custom_input = answer_content.get("custom_input")
        parts = [code.strip()]
        if isinstance(language, str) and language.strip():
            parts.append(language.strip())
        if isinstance(custom_input, str) and custom_input.strip():
            parts.append(custom_input.strip())
        return " ".join(parts)

    html = answer_content.get("html")
    if isinstance(html, str) and html.strip():
        return _strip_html(html)

    blanks = answer_content.get("blanks")
    if isinstance(blanks, list):
        return " ".join(str(item).strip() for item in blanks if str(item).strip())

    selected = answer_content.get("selected")
    if isinstance(selected, list):
        return " ".join(str(item) for item in selected)

    value = answer_content.get("value")
    if isinstance(value, bool):
        return "true" if value else "false"

    return ""


def _extract_attachment_refs(answer_content: dict[str, Any]) -> list[dict[str, str]]:
    attachments = answer_content.get("attachments")
    if not isinstance(attachments, list):
        return []

    normalized: list[dict[str, str]] = []
    for item in attachments:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        url = item.get("url")
        if isinstance(name, str) and name.strip() and isinstance(url, str) and url.strip():
            normalized.append({"name": name.strip(), "url": url.strip()})
    return normalized


def _extract_websocket_token(websocket: WebSocket) -> str | None:
    authorization = websocket.headers.get("authorization")
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token.strip():
            return token.strip()
    query_token = websocket.query_params.get("token")
    return query_token.strip() if query_token and query_token.strip() else None


async def _get_current_user_from_websocket(db: AsyncSession, websocket: WebSocket) -> User:
    token = _extract_websocket_token(websocket)
    payload = decode_access_token(token) if token else None
    if payload is None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token")

    try:
        user_id = uuid.UUID(str(payload["sub"]))
    except (KeyError, ValueError) as exc:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Invalid token") from exc

    user = (
        await db.execute(
            select(User).where(
                User.id == user_id,
                User.deleted_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="User not found or inactive")
    return user


def _parse_lsp_language(raw_language: str) -> LspLanguage:
    if raw_language not in SUPPORTED_LSP_LANGUAGES:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Unsupported language")
    return raw_language


def _is_subjective_question_type(question_type: str) -> bool:
    return question_type in {
        QuestionType.SHORT_ANSWER.value,
        QuestionType.ESSAY.value,
        QuestionType.CODE.value,
    }


async def _get_active_role_binding_version(db: AsyncSession) -> int:
    binding = (
        await db.execute(
            select(RoleBinding).where(RoleBinding.is_active.is_(True)).order_by(RoleBinding.version.desc())
        )
    ).scalar_one_or_none()
    if binding is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No active grading role binding")
    return binding.version


def _build_grading_task_payload(
    *,
    exam: Exam,
    question: Question,
    question_score: float,
    answer_content: dict[str, Any],
    role_binding_version: int,
    source_business_id: str,
) -> dict[str, Any]:
    question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
    question_content = question.content.get("text") if isinstance(question.content, dict) else None
    raw_question_content = _strip_html(question_content if isinstance(question_content, str) else question.title)
    standard_answer = question.answer if isinstance(question.answer, dict) else {}
    language = answer_content.get("language") if isinstance(answer_content.get("language"), str) else None

    return {
        "source_type": "exam_submission",
        "source_business_id": source_business_id,
        "question_type": question_type,
        "question_content": raw_question_content or question.title,
        "subject": exam.title,
        "language": "zh-CN",
        "max_score": int(round(question_score)),
        "knowledge_tags": [],
        "fatal_rule_enabled": True,
        "student_answer_raw": _extract_answer_text(answer_content),
        "student_answer_structured": answer_content,
        "attachment_refs": _extract_attachment_refs(answer_content),
        "standard_answers": [standard_answer],
        "rubric_definition": {},
        "scoring_points": [],
        "dimension_weights": {},
        "deduction_rules": [],
        "fatal_error_rules": [],
        "role_binding_version": role_binding_version,
        "programming_language": language,
        "runtime_logs": [],
    }


# Cap concurrent LLM grading calls. Providers rate-limit aggressively, and we
# share this budget across all in-flight submissions on the worker. Set via env
# if more parallelism is safe for your account.
_GRADING_CONCURRENCY = int(os.environ.get("EXAM_GRADING_CONCURRENCY", "3") or 3)


async def _run_subjective_grading_tasks(task_ids: list[str]) -> None:
    """Drive a batch of grading tasks with bounded concurrency.

    Each task owns its own DB session so a failure in one cannot poison the
    others' transaction state. Concurrency is bounded by ``_GRADING_CONCURRENCY``
    to avoid stampeding the upstream LLM provider.
    """
    if not task_ids:
        return
    semaphore = asyncio.Semaphore(_GRADING_CONCURRENCY)

    async def _run(task_id: str) -> None:
        async with semaphore:
            await _run_single_subjective_grading_task(task_id)

    await asyncio.gather(*[_run(task_id) for task_id in task_ids], return_exceptions=True)


async def _run_single_subjective_grading_task(task_id: str) -> None:
    async with async_session() as db:
        try:
            result = await run_grading_task_with_role_binding(db, task_id)
            await db.commit()
        except Exception as exc:
            await db.rollback()
            task = await db.get(GradingTask, uuid.UUID(task_id))
            if task is not None:
                task.status = "failed"
                db.add(
                    GradingAuditEvent(
                        task_id=task.id,
                        event_type="grading.failed",
                        event_payload={
                            "message": str(exc),
                            "detail": _trim_grading_background_error(str(exc)),
                            "stage": "dispatch",
                        },
                        operator_type="system",
                        operator_id="system",
                    )
                )
                await db.commit()
            await _reconcile_failed_grading_task(db, task_id, reason=str(exc))
            logger.exception("subjective grading task %s failed", task_id)
            return

        task_status = result.get("status")
        if task_status == "arbitration_required":
            await _reconcile_failed_grading_task(
                db,
                task_id,
                reason=result.get("reason") or "arbitration_required",
                needs_human_review=True,
            )
            return
        if task_status != "completed":
            # Unknown non-terminal state — leave alone so retry/recovery can pick it up.
            return

        try:
            await apply_grading_task_result_to_exam_submission(db, task_id)
            await db.commit()
        except Exception as exc:
            await db.rollback()
            task = await db.get(GradingTask, uuid.UUID(task_id))
            if task is not None:
                db.add(
                    GradingAuditEvent(
                        task_id=task.id,
                        event_type="grading.apply_failed",
                        event_payload={
                            "message": str(exc),
                            "detail": _trim_grading_background_error(str(exc)),
                        },
                        operator_type="system",
                        operator_id="system",
                    )
                )
                await db.commit()
            await _reconcile_failed_grading_task(db, task_id, reason=f"apply_failed: {exc}")
            logger.exception("subjective grading task %s failed while applying result", task_id)


async def _reconcile_failed_grading_task(
    db: AsyncSession,
    task_id: str,
    *,
    reason: str,
    needs_human_review: bool = False,
) -> None:
    """Write a failure marker into the affected question's feedback and
    re-evaluate the parent exam_student.grading_status so the submission can
    leave PENDING_AI even when this individual task did not produce a final
    snapshot.
    """
    try:
        await apply_grading_task_failure_to_exam_submission(
            db,
            task_id,
            reason=reason,
            needs_human_review=needs_human_review,
        )
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("failed to reconcile exam submission for task %s", task_id)


async def _post_submit_housekeeping(
    *,
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
    wrong_question_ids: list[uuid.UUID],
    task_ids: list[str],
    now: datetime,
) -> None:
    """Run after submit commit — batches wrong-answer progress upserts, then AI grading.

    Kept off the hot path so 150 concurrent submissions don't each hold a long
    transaction through N+1 progress SELECTs. Grading tasks are created
    synchronously in submit (cheap) so tests/clients see them immediately.
    """
    if wrong_question_ids:
        async with async_session() as db:
            try:
                # One query instead of N: fetch all existing progress rows at once.
                existing_result = await db.execute(
                    select(StudentQuestionProgress).where(
                        StudentQuestionProgress.student_id == student_id,
                        StudentQuestionProgress.question_id.in_(wrong_question_ids),
                    )
                )
                existing = {row.question_id: row for row in existing_result.scalars().all()}
                new_rows: list[StudentQuestionProgress] = []
                for qid in wrong_question_ids:
                    progress = existing.get(qid)
                    if progress is None:
                        new_rows.append(
                            StudentQuestionProgress(
                                student_id=student_id,
                                question_id=qid,
                                last_exam_id=exam_id,
                                wrong_count=1,
                                mastered=False,
                                last_wrong_at=now,
                            )
                        )
                    else:
                        progress.last_exam_id = exam_id
                        progress.wrong_count += 1
                        progress.last_wrong_at = now
                        progress.mastered = False
                        progress.mastered_at = None
                if new_rows:
                    db.add_all(new_rows)
                await db.commit()
            except Exception:
                await db.rollback()

    if task_ids:
        try:
            await _run_subjective_grading_tasks(task_ids)
        except Exception:
            logger.exception("post submit grading housekeeping failed")


def _build_objective_feedback(
    *,
    correct: bool,
    max_score: float,
    actual_score: float,
    standard_answer: str,
    student_answer: str,
) -> dict[str, Any]:
    return {
        "dimensions": [
            {
                "name": "答案准确性",
                "score": actual_score,
                "max_score": max_score,
                "comment": "答案正确。" if correct else f"标准答案为 {standard_answer or '未设置'}。",
            }
        ],
        "strengths": ["答案与标准一致。"] if correct else [],
        "deductions": [] if correct else [f"你的答案为 {student_answer or '未作答'}，与标准答案不一致。"],
        "suggestions": [] if correct else ["回看对应知识点并复盘判断依据。"],
    }


def _build_subjective_feedback(
    *,
    max_score: float,
    actual_score: float,
    matched_points: list[str],
    missing_points: list[str],
) -> dict[str, Any]:
    structure_score = round(max_score * (0.3 if matched_points else 0.1), 2)
    coverage_score = round(max(actual_score - structure_score, 0), 2)
    return {
        "dimensions": [
            {
                "name": "要点覆盖",
                "score": coverage_score,
                "max_score": round(max_score * 0.7, 2),
                "comment": f"命中 {len(matched_points)} 个关键要点。",
            },
            {
                "name": "表达完整度",
                "score": min(structure_score, actual_score),
                "max_score": round(max_score * 0.3, 2),
                "comment": "答案结构较完整。" if matched_points else "答案内容较少，建议补充核心论述。",
            },
        ],
        "strengths": [f"涉及要点：{point}" for point in matched_points[:3]],
        "deductions": [f"缺少要点：{point}" for point in missing_points[:3]],
        "suggestions": (
            ["继续补充结论、依据或示例，让答案更完整。"]
            if missing_points
            else ["要点覆盖较好，可继续优化表述精炼度。"]
        ),
    }


def _build_code_feedback(
    *,
    max_score: float,
    actual_score: float,
    matched_points: list[str],
    missing_points: list[str],
    language: str | None,
    question_mode: str | None,
    function_name: str | None,
) -> dict[str, Any]:
    syntax_score = round(min(actual_score, max_score * 0.4), 2)
    logic_score = round(max(actual_score - syntax_score, 0), 2)
    is_function_mode = question_mode == "function"
    return {
        "dimensions": [
            {
                "name": "实现完整度",
                "score": logic_score,
                "max_score": round(max_score * 0.6, 2),
                "comment": f"命中 {len(matched_points)} 个关键实现点。",
            },
            {
                "name": "代码结构",
                "score": syntax_score,
                "max_score": round(max_score * 0.4, 2),
                "comment": (
                    f"已使用 {language} 语言作答。"
                    if language
                    else "已保存代码作答。"
                ),
            },
        ],
        "strengths": [
            *( [f"函数命名围绕 {function_name} 展开。"] if is_function_mode and function_name else [] ),
            *[f"已覆盖：{point}" for point in matched_points[:3]],
        ],
        "deductions": [f"仍缺少：{point}" for point in missing_points[:3]],
        "suggestions": (
            (
                ["继续补全边界处理、输入输出和示例测试。"]
                if missing_points and not is_function_mode
                else ["继续补全边界处理、返回值和示例测试。"]
                if missing_points
                else ["核心逻辑较完整，可继续优化时间复杂度与可读性。"]
            )
        ),
    }


async def _grade_fill_in_question_with_ai(
    question: Question,
    answer_content: dict[str, Any],
    score: float,
) -> tuple[float, bool, dict[str, Any]]:
    expected_list = _get_fill_in_expected_answers(question.answer or {})
    provided = answer_content.get("blanks", [])
    provided_list = [str(item) for item in provided] if isinstance(provided, list) else [str(provided)]
    total = max(len(expected_list), 1)

    match_flags = [False] * len(expected_list)
    ai_reasons: dict[int, str] = {}
    for index, expected_item in enumerate(expected_list):
        actual = provided_list[index] if index < len(provided_list) else ""
        match_flags[index] = _is_fill_in_exact_match(actual, expected_item)

    if expected_list and not all(match_flags):
        try:
            ai_matches = await _request_fill_in_equivalence_with_deepseek(
                question_text=_get_question_plain_text(question),
                expected_answers=expected_list,
                student_answers=[provided_list[index] if index < len(provided_list) else "" for index in range(len(expected_list))],
            )
            for index, item in enumerate(ai_matches[: len(expected_list)]):
                if match_flags[index]:
                    continue
                if item.get("is_correct") is True:
                    match_flags[index] = True
                    reason = item.get("reason")
                    if isinstance(reason, str) and reason.strip():
                        ai_reasons[index] = reason.strip()
        except Exception as exc:  # noqa: BLE001 - AI grading must not block exam submission.
            logger.warning("DeepSeek fill-in grading unavailable: %s", exc)

    matched = sum(1 for item in match_flags if item)
    missing_points = [
        f"第 {index + 1} 空应为 {expected_item}"
        for index, expected_item in enumerate(expected_list)
        if not match_flags[index]
    ]
    actual_score = round(score * matched / total, 2)
    correct = matched == total
    ai_strengths = [
        f"DeepSeek 判定第 {index + 1} 空等价：{reason}"
        for index, reason in sorted(ai_reasons.items())
    ]

    return (
        actual_score,
        correct,
        {
            "dimensions": [
                {
                    "name": "填空准确率",
                    "score": actual_score,
                    "max_score": score,
                    "comment": f"共命中 {matched}/{total} 个空。",
                }
            ],
            "strengths": ([f"命中 {matched} 个空。"] if matched else []) + ai_strengths,
            "deductions": missing_points,
            "suggestions": ["复查拼写、术语与顺序。"] if not correct else [],
        },
    )


async def _grade_question_with_ai(
    question: Question,
    answer_content: dict[str, Any],
    score: float,
) -> tuple[float, bool, dict[str, Any]]:
    question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
    if question_type == QuestionType.FILL_IN.value:
        return await _grade_fill_in_question_with_ai(question, answer_content, score)
    return _grade_question(question, answer_content, score)


def _grade_question(question: Question, answer_content: dict[str, Any], score: float) -> tuple[float, bool, dict[str, Any]]:
    question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
    standard_answer = question.answer or {}

    if question_type == QuestionType.CHOICE.value:
        expected = standard_answer.get("correct", [])
        expected_list = expected if isinstance(expected, list) else [expected]
        selected = answer_content.get("selected", [])
        selected_list = selected if isinstance(selected, list) else [selected]
        correct = sorted(str(item) for item in expected_list) == sorted(str(item) for item in selected_list)
        student_text = "、".join(str(item) for item in selected_list if item)
        expected_text = "、".join(str(item) for item in expected_list if item)
        return (
            score if correct else 0.0,
            correct,
            _build_objective_feedback(
                correct=correct,
                max_score=score,
                actual_score=score if correct else 0.0,
                standard_answer=expected_text,
                student_answer=student_text,
            ),
        )

    if question_type == QuestionType.TRUE_FALSE.value:
        expected = bool(standard_answer.get("correct"))
        student = answer_content.get("value")
        correct = student is expected
        return (
            score if correct else 0.0,
            correct,
            _build_objective_feedback(
                correct=correct,
                max_score=score,
                actual_score=score if correct else 0.0,
                standard_answer="正确" if expected else "错误",
                student_answer="正确" if student is True else "错误" if student is False else "",
            ),
        )

    if question_type == QuestionType.FILL_IN.value:
        expected_list = _get_fill_in_expected_answers(standard_answer)
        provided = answer_content.get("blanks", [])
        provided_list = [str(item) for item in provided] if isinstance(provided, list) else [str(provided)]
        total = max(len(expected_list), 1)
        matched = 0
        missing_points: list[str] = []
        for index, expected_item in enumerate(expected_list):
            actual = provided_list[index] if index < len(provided_list) else ""
            if _is_fill_in_exact_match(actual, expected_item):
                matched += 1
            else:
                missing_points.append(f"第 {index + 1} 空应为 {expected_item}")
        actual_score = round(score * matched / total, 2)
        correct = matched == total
        return (
            actual_score,
            correct,
            {
                "dimensions": [
                    {
                        "name": "填空准确率",
                        "score": actual_score,
                        "max_score": score,
                        "comment": f"共命中 {matched}/{total} 个空。",
                    }
                ],
                "strengths": [f"命中 {matched} 个空。"] if matched else [],
                "deductions": missing_points,
                "suggestions": ["复查拼写、术语与顺序。"] if not correct else [],
            },
        )

    if question_type == QuestionType.CODE.value:
        code = answer_content.get("code")
        code_text = code.strip() if isinstance(code, str) else ""
        if not code_text:
            return 0.0, False, {
                "dimensions": [
                    {
                        "name": "代码提交",
                        "score": 0.0,
                        "max_score": score,
                        "comment": "尚未提交代码。",
                    }
                ],
                "strengths": [],
                "deductions": ["未检测到代码内容。"],
                "suggestions": ["请先补充代码实现，再提交考试。"],
            }

        required_patterns = standard_answer.get("required_patterns", [])
        pattern_list = [str(item) for item in required_patterns if str(item).strip()] if isinstance(required_patterns, list) else []
        if not pattern_list:
            pattern_list = [str(item) for item in standard_answer.get("points", []) if str(item).strip()] if isinstance(standard_answer.get("points", []), list) else []

        normalized_code = _normalize_text(code_text)
        matched_points = [point for point in pattern_list if _normalize_text(point) in normalized_code]
        missing_points = [point for point in pattern_list if point not in matched_points]
        coverage = len(matched_points) / len(pattern_list) if pattern_list else 0.5
        actual_score = round(score * coverage, 2)
        language = answer_content.get("language")
        function_name = None
        question_mode = None
        if isinstance(question.content, dict):
            raw_mode = question.content.get("mode")
            question_mode = str(raw_mode) if raw_mode else None
            raw_name = question.content.get("function_name")
            function_name = str(raw_name) if raw_name else None
        correct = coverage >= 0.6
        return (
            actual_score,
            correct,
            _build_code_feedback(
                max_score=score,
                actual_score=actual_score,
                matched_points=matched_points,
                missing_points=missing_points,
                language=str(language) if isinstance(language, str) else None,
                question_mode=question_mode,
                function_name=function_name,
            ),
        )

    points = standard_answer.get("points", [])
    point_list = [str(item) for item in points if str(item).strip()] if isinstance(points, list) else []
    answer_text = _normalize_text(_extract_answer_text(answer_content))
    if not point_list:
        feedback = _build_subjective_feedback(
            max_score=score,
            actual_score=0.0,
            matched_points=[],
            missing_points=["暂未配置评分要点"],
        )
        return 0.0, False, feedback

    matched_points = [point for point in point_list if _normalize_text(point) in answer_text]
    missing_points = [point for point in point_list if point not in matched_points]
    coverage = len(matched_points) / len(point_list)
    actual_score = round(score * coverage, 2)
    correct = coverage >= 0.6
    feedback = _build_subjective_feedback(
        max_score=score,
        actual_score=actual_score,
        matched_points=matched_points,
        missing_points=missing_points,
    )
    return actual_score, correct, feedback


async def _get_exam_for_student(
    db: AsyncSession,
    exam_id: uuid.UUID,
    student_id: uuid.UUID,
) -> tuple[Exam, ExamStudent]:
    result = await db.execute(
        select(Exam)
        .join(ExamStudent, ExamStudent.exam_id == Exam.id)
        .where(
            Exam.id == exam_id,
            Exam.deleted_at.is_(None),
            ExamStudent.student_id == student_id,
        )
    )
    exam = result.scalars().unique().one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

    exam_student = next((item for item in exam.exam_students if item.student_id == student_id), None)
    if exam_student is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Exam not assigned")

    return exam, exam_student


def _ensure_exam_open(exam: Exam) -> None:
    now = _utcnow()
    start_time = _as_utc(exam.start_time)
    end_time = _as_utc(exam.end_time)
    if exam.status == "closed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam is closed")
    if start_time and start_time > now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam has not started")
    if end_time and end_time < now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam has ended")


def _ensure_exam_attempt_in_progress(exam_student: ExamStudent) -> None:
    if exam_student.started_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam not started")
    if exam_student.submitted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam already submitted")


def _ensure_exam_attempt_in_progress_for_websocket(exam_student: ExamStudent) -> None:
    if exam_student.started_at is None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Exam not started")
    if exam_student.submitted_at is not None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Exam already submitted")


def _can_start_retake(exam: Exam, exam_student: ExamStudent) -> bool:
    if exam_student.submitted_at is None:
        return False
    if not exam.allow_retake:
        return False
    now = _utcnow()
    start_time = _as_utc(exam.start_time)
    end_time = _as_utc(exam.end_time)
    if exam.status == "closed":
        return False
    if start_time and start_time > now:
        return False
    if end_time and end_time < now:
        return False
    return True


def _reset_exam_student_for_retake(exam_student: ExamStudent) -> None:
    exam_student.started_at = _utcnow()
    exam_student.saved_answers = {}
    exam_student.submitted_at = None
    exam_student.switch_count = 0
    exam_student.latest_submission_id = None
    exam_student.grading_status = GradingStatus.REVIEWED.value
    exam_student.objective_score = None
    exam_student.subjective_score = None
    exam_student.score = None
    exam_student.ai_scored_at = None
    exam_student.reviewed_at = None
    exam_student.graded_at = None


async def _get_exam_question_for_student(
    db: AsyncSession,
    exam: Exam,
    question_id: uuid.UUID,
) -> Question:
    question = (
        await db.execute(
            select(Question).where(
                Question.id == question_id,
            )
        )
    ).scalar_one_or_none()
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")

    if all(exam_question.question_id != question_id for exam_question in exam.exam_questions):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Question does not belong to exam")

    if question.type != QuestionType.CODE:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Question is not a code question")

    return question


@router.post("/exams/{exam_id}/start", response_model=StudentExamStartResponse)
async def start_exam(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: ExamActor,
    payload: StartExamRequest | None = None,
) -> StudentExamStartResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    _ensure_exam_open(exam)
    if exam_student.submitted_at is not None:
        wants_retake = bool(payload and payload.retake)
        if not wants_retake:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam already submitted")
        if not _can_start_retake(exam, exam_student):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Retake is not allowed")

        _reset_exam_student_for_retake(exam_student)
        await db.execute(
            delete(StudentExamAnswer).where(
                StudentExamAnswer.exam_id == exam.id,
                StudentExamAnswer.student_id == user.id,
            )
        )
        await db.commit()
        await db.refresh(exam)
        exam_student = next(item for item in exam.exam_students if item.student_id == user.id)

    if exam_student.started_at is None:
        exam_student.started_at = _utcnow()
        await db.commit()
        await db.refresh(exam)
        exam_student = next(item for item in exam.exam_students if item.student_id == user.id)

    questions = [
        StudentQuestionPayload(
            question_id=eq.question_id,
            order=eq.order,
            score=eq.score_override if eq.score_override is not None else eq.question.score,
            type=eq.question.type.value,
            title=eq.question.title,
            content=_build_student_question_content(eq.question),
            options=eq.question.options,
        )
        for eq in sorted(exam.exam_questions, key=lambda item: item.order)
    ]

    return StudentExamStartResponse(
        exam_id=exam.id,
        title=exam.title,
        duration_minutes=exam.duration_minutes,
        max_switch_count=exam.max_switch_count,
        allow_retake=exam.allow_retake,
        started_at=exam_student.started_at,
        end_time=exam.end_time,
        questions=questions,
        saved_answers={str(key): value for key, value in (exam_student.saved_answers or {}).items()},
        switch_count=exam_student.switch_count,
    )


@router.post("/exams/{exam_id}/questions/{question_id}/run", response_model=StudentCodeRunResponse)
async def run_exam_question_code(
    exam_id: uuid.UUID,
    question_id: uuid.UUID,
    payload: StudentCodeRunRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: ExamActor,
) -> StudentCodeRunResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    _ensure_exam_open(exam)
    _ensure_exam_attempt_in_progress(exam_student)
    question = await _get_exam_question_for_student(db, exam, question_id)

    sample_tests: list[dict[str, Any]] = []
    if isinstance(question.content, dict):
        raw_sample_tests = question.content.get("sample_tests")
        if isinstance(raw_sample_tests, list):
            sample_tests = [item for item in raw_sample_tests if isinstance(item, dict)]

    if settings.judge_runner_url:
        result = await run_code_via_judge_runner(settings.judge_runner_url, payload, sample_tests)
    else:
        result = await asyncio.to_thread(run_code, payload, sample_tests=sample_tests)
    return StudentCodeRunResponse.model_validate(result.model_dump())


@router.websocket("/exams/{exam_id}/questions/{question_id}/lsp")
async def stream_exam_question_lsp(
    websocket: WebSocket,
    exam_id: uuid.UUID,
    question_id: uuid.UUID,
    language: str = Query(...),
) -> None:
    async with async_session() as db:
        user = await _get_current_user_from_websocket(db, websocket)
        try:
            exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
            _ensure_exam_open(exam)
            _ensure_exam_attempt_in_progress_for_websocket(exam_student)
            await _get_exam_question_for_student(db, exam, question_id)
            parsed_language = _parse_lsp_language(language)
        except HTTPException as exc:
            raise WebSocketException(
                code=status.WS_1008_POLICY_VIOLATION,
                reason=str(exc.detail),
            ) from exc

    if not settings.lsp_runner_url:
        await websocket.accept()
        await websocket.close(code=status.WS_1013_TRY_AGAIN_LATER, reason="Language service unavailable")
        return

    session = LspGatewaySession(
        student_id=user.id,
        exam_id=exam_id,
        question_id=question_id,
        language=parsed_language,
    )
    await proxy_lsp_websocket(websocket, settings.lsp_runner_url, session)


@router.post("/exams/{exam_id}/answers")
async def save_answers(
    exam_id: uuid.UUID,
    payload: SaveAnswersRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: ExamActor,
) -> dict[str, Any]:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    _ensure_exam_open(exam)
    if exam_student.submitted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam already submitted")

    saved_answers = dict(exam_student.saved_answers or {})
    for item in payload.answers:
        saved_answers[str(item.question_id)] = deepcopy(item.answer_content)
    exam_student.saved_answers = saved_answers
    await db.commit()
    return {"saved": len(payload.answers)}


@router.post("/exams/{exam_id}/switch")
async def report_switch(
    exam_id: uuid.UUID,
    payload: SwitchReportRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: ExamActor,
) -> dict[str, Any]:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    exam_student.switch_count = payload.switch_count
    await db.commit()
    return {
        "switch_count": exam_student.switch_count,
        "max_switch_count": exam.max_switch_count,
        "force_submit": exam.max_switch_count > 0 and exam_student.switch_count >= exam.max_switch_count,
    }


@router.post("/exams/{exam_id}/submit", response_model=SubmitExamResponse)
async def submit_exam(
    exam_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: ExamActor,
    payload: SubmitExamRequest | None = None,
) -> SubmitExamResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    if exam_student.submitted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam already submitted")

    answers_map = dict(exam_student.saved_answers or {})
    for item in payload.answers if payload else []:
        answers_map[str(item.question_id)] = deepcopy(item.answer_content)
    exam_student.saved_answers = answers_map

    now = _utcnow()
    next_attempt_no = exam_student.submission_count + 1
    submission = StudentExamSubmission(
        exam_id=exam.id,
        student_id=user.id,
        attempt_no=next_attempt_no,
        submitted_at=now,
        grading_status=GradingStatus.REVIEWED.value,
        objective_score=0.0,
        subjective_score=0.0,
        score=0.0,
    )
    db.add(submission)
    await db.flush()

    await db.execute(
        delete(StudentExamAnswer).where(
            StudentExamAnswer.exam_id == exam.id,
            StudentExamAnswer.student_id == user.id,
        )
    )

    sorted_exam_questions = sorted(exam.exam_questions, key=lambda item: item.order)

    # Pass 1: grade objectives in-memory, collect subjective payloads for deferred creation.
    objective_score = 0.0
    answer_rows: list[StudentExamAnswer] = []
    submission_answer_rows: list[StudentExamSubmissionAnswer] = []
    wrong_question_ids: list[uuid.UUID] = []
    subjective_payloads: list[dict[str, Any]] = []
    has_subjective = False
    role_binding_version: int | None = None

    for exam_question in sorted_exam_questions:
        question = exam_question.question
        answer_content = deepcopy(answers_map.get(str(question.id), {}))
        question_score = exam_question.score_override if exam_question.score_override is not None else question.score
        question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
        is_subjective = _is_subjective_question_type(question_type)

        if is_subjective:
            has_subjective = True
            if role_binding_version is None:
                role_binding_version = await _get_active_role_binding_version(db)
            score_awarded = 0.0
            is_correct = False
            feedback: dict[str, Any] = {}
            subjective_payloads.append(
                _build_grading_task_payload(
                    exam=exam,
                    question=question,
                    question_score=question_score,
                    answer_content=answer_content,
                    role_binding_version=role_binding_version,
                    source_business_id=f"{exam.id}:{question.id}:{user.id}:{submission.id}",
                )
            )
        else:
            score_awarded, is_correct, feedback = await _grade_question_with_ai(question, answer_content, question_score)
            objective_score += score_awarded

        answer_rows.append(
            StudentExamAnswer(
                exam_id=exam.id,
                student_id=user.id,
                question_id=question.id,
                answer_content=answer_content,
                score_awarded=score_awarded,
                is_correct=is_correct,
                feedback=feedback,
            )
        )
        submission_answer_rows.append(
            StudentExamSubmissionAnswer(
                submission_id=submission.id,
                exam_id=exam.id,
                student_id=user.id,
                question_id=question.id,
                answer_content=answer_content,
                score_awarded=score_awarded,
                is_correct=is_correct,
                feedback=feedback,
            )
        )
        if not is_correct and not is_subjective:
            wrong_question_ids.append(question.id)

    # Single batched insert — one round-trip instead of N.
    db.add_all(answer_rows)
    db.add_all(submission_answer_rows)

    # Create grading tasks synchronously so clients see them immediately after submit.
    task_ids: list[str] = []
    for payload in subjective_payloads:
        task = await create_grading_task(db, payload)
        task_ids.append(str(task.id))

    exam_student.submitted_at = now
    exam_student.latest_submission_id = submission.id
    exam_student.submission_count = next_attempt_no
    exam_student.objective_score = round(objective_score, 2)
    exam_student.subjective_score = 0.0
    exam_student.score = round(objective_score, 2)
    if has_subjective:
        exam_student.grading_status = GradingStatus.PENDING_AI.value
        exam_student.ai_scored_at = None
        exam_student.reviewed_at = None
        exam_student.graded_at = None
    else:
        exam_student.grading_status = GradingStatus.REVIEWED.value
        exam_student.ai_scored_at = now
        exam_student.reviewed_at = now
        exam_student.graded_at = now

    submission.objective_score = exam_student.objective_score
    submission.subjective_score = exam_student.subjective_score
    submission.score = exam_student.score
    submission.grading_status = exam_student.grading_status

    await db.commit()

    # Defer non-critical work off the submit request path. Student sees "submitted"
    # immediately; progress tracking + grading-task creation + AI grading happen async.
    background_tasks.add_task(
        _post_submit_housekeeping,
        exam_id=exam.id,
        student_id=user.id,
        wrong_question_ids=wrong_question_ids,
        task_ids=task_ids,
        now=now,
    )

    return SubmitExamResponse(
        submitted=True,
        score=exam_student.score,
        grading_status=exam_student.grading_status,
    )


@router.get("/exams/{exam_id}/result", response_model=StudentExamResultResponse)
async def get_exam_result(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> StudentExamResultResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    if exam_student.submitted_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam not submitted")

    is_pending_ai = exam_student.grading_status == GradingStatus.PENDING_AI.value

    if not exam.show_result and not is_pending_ai and exam.category != "practice":
        return StudentExamResultResponse(
            exam_id=exam.id,
            title=exam.title,
            submitted_at=exam_student.submitted_at,
            total_score=exam.total_score,
            score=exam_student.score,
            objective_score=exam_student.objective_score,
            subjective_score=exam_student.subjective_score,
            grading_status=exam_student.grading_status,
            can_view=False,
            blocked_reason="教师暂未开放查看结果权限",
        )

    answers_result = await db.execute(
        select(StudentExamAnswer).where(
            StudentExamAnswer.exam_id == exam.id,
            StudentExamAnswer.student_id == user.id,
        )
    )
    answers = {
        item.question_id: item for item in answers_result.scalars().all()
    }
    appeals_result = await db.execute(
        select(StudentExamAppeal).where(
            StudentExamAppeal.exam_id == exam.id,
            StudentExamAppeal.student_id == user.id,
        )
    )
    appeals = {
        item.question_id: item for item in appeals_result.scalars().all()
    }

    _SUBJECTIVE_TYPES = {"short_answer", "essay", "code"}

    question_items: list[StudentExamResultQuestionResponse] = []
    for exam_question in sorted(exam.exam_questions, key=lambda item: item.order):
        question = exam_question.question
        answer = answers.get(question.id)
        appeal = appeals.get(question.id)
        answer_feedback = (answer.feedback or {}) if answer else {}
        grading_failed = bool(answer_feedback.get("grading_failed"))
        needs_human_review = bool(answer_feedback.get("needs_human_review"))
        grading_pending = (
            is_pending_ai
            and question.type.value in _SUBJECTIVE_TYPES
            and not grading_failed
        )
        question_items.append(
            StudentExamResultQuestionResponse(
                question_id=question.id,
                order=exam_question.order,
                type=question.type.value,
                title=question.title,
                content=_build_student_question_content(question),
                options=question.options,
                total_score=exam_question.score_override if exam_question.score_override is not None else question.score,
                score_awarded=answer.score_awarded if answer else 0.0,
                is_correct=answer.is_correct if answer else False,
                answer_content=answer.answer_content if answer else {},
                standard_answer=question.answer or {},
                analysis=question.analysis if (exam.show_result or exam.category == "practice") else None,
                feedback=answer.feedback if answer and (exam.show_result or exam.category == "practice") else {},
                appeal_status=appeal.status if appeal else None,
                appeal_reason=appeal.reason if appeal else None,
                appeal_reply=appeal.teacher_reply if appeal else None,
                grading_pending=grading_pending,
                grading_failed=grading_failed,
                needs_human_review=needs_human_review,
            )
        )

    return StudentExamResultResponse(
        exam_id=exam.id,
        title=exam.title,
        submitted_at=exam_student.submitted_at,
        total_score=exam.total_score,
        score=exam_student.score,
        objective_score=exam_student.objective_score,
        subjective_score=exam_student.subjective_score,
        grading_status=exam_student.grading_status,
        can_view=True,
        blocked_reason=(
            "主观题正在进行 AI 评分，主观题分数将在评估完成后更新。客观题分数已可见。"
            if is_pending_ai
            else None
        ),
        questions=question_items,
    )


@router.post(
    "/exams/{exam_id}/questions/{question_id}/regrade",
    status_code=status.HTTP_202_ACCEPTED,
)
async def regrade_subjective_question(
    exam_id: uuid.UUID,
    question_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> dict[str, str]:
    """Re-run AI grading for a single subjective question whose latest task ended
    in ``failed`` or ``arbitration_required``.

    Used by the student result page's "重新评分" button so students aren't
    stranded when an LLM call failed once. Limited to the student's own
    submitted exam.
    """
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    if exam_student.submitted_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam not submitted")

    submission_id = exam_student.latest_submission_id
    if submission_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Submission not found")

    locator_prefix = f"{exam_id}:{question_id}:{user.id}:{submission_id}"
    task_row = await db.execute(
        select(GradingTask)
        .where(
            GradingTask.source_type == "exam_submission",
            GradingTask.source_business_id == locator_prefix,
        )
        .order_by(GradingTask.created_at.desc())
        .limit(1)
    )
    task = task_row.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Grading task not found")

    if task.status not in {"failed", "arbitration_required"}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该题目当前评分状态不允许重新评分",
        )

    task.status = "pending"
    db.add(
        GradingAuditEvent(
            task_id=task.id,
            event_type="grading.regrade_requested",
            event_payload={"requested_by": "student"},
            operator_type="student",
            operator_id=str(user.id),
        )
    )
    exam_student.grading_status = GradingStatus.PENDING_AI.value
    await db.commit()

    background_tasks.add_task(_run_subjective_grading_tasks, [str(task.id)])
    return {"task_id": str(task.id), "status": "pending"}


@router.get("/notifications/unread", response_model=list[StudentNotificationResponse])
async def list_unread_notifications(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> list[StudentNotificationResponse]:
    notifications = (
        await db.execute(
            select(StudentNotification)
            .where(
                StudentNotification.student_id == user.id,
                StudentNotification.read_at.is_(None),
            )
            .order_by(StudentNotification.created_at.desc())
        )
    ).scalars().all()
    return [StudentNotificationResponse.model_validate(notification) for notification in notifications]


@router.post("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> dict[str, Any]:
    notification = (
        await db.execute(
            select(StudentNotification).where(
                StudentNotification.id == notification_id,
                StudentNotification.student_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.read_at = _utcnow()
    await db.commit()
    return {"read": True}


@router.post("/exams/{exam_id}/appeals", response_model=AppealResponse, status_code=status.HTTP_201_CREATED)
async def create_appeal(
    exam_id: uuid.UUID,
    payload: AppealCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> AppealResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    if exam_student.submitted_at is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam not submitted")

    existing_result = await db.execute(
        select(StudentExamAppeal).where(
            StudentExamAppeal.exam_id == exam.id,
            StudentExamAppeal.student_id == user.id,
            StudentExamAppeal.question_id == payload.question_id,
        )
    )
    existing = existing_result.scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Appeal already submitted")

    appeal = StudentExamAppeal(
        exam_id=exam.id,
        student_id=user.id,
        question_id=payload.question_id,
        reason=payload.reason,
        status=AppealStatus.PENDING.value,
    )
    db.add(appeal)
    await db.commit()
    await db.refresh(appeal)
    return AppealResponse.model_validate(appeal)


@wrong_answers_router.get("", response_model=list[WrongAnswerListItem])
async def list_wrong_answers(
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
    question_type: Annotated[str | None, Query(alias="question_type")] = None,
    tag: str | None = None,
    mastered: bool = False,
) -> list[WrongAnswerListItem]:
    query = (
        select(StudentQuestionProgress, Question, Exam)
        .join(Question, Question.id == StudentQuestionProgress.question_id)
        .outerjoin(Exam, Exam.id == StudentQuestionProgress.last_exam_id)
        .where(
            StudentQuestionProgress.student_id == user.id,
            StudentQuestionProgress.wrong_count > 0,
            StudentQuestionProgress.mastered.is_(mastered),
        )
    )

    if mastered:
        query = query.order_by(StudentQuestionProgress.mastered_at.desc())
    else:
        query = query.order_by(StudentQuestionProgress.last_wrong_at.desc())

    result = await db.execute(query)

    items: list[WrongAnswerListItem] = []
    for progress, question, exam in result.all():
        if question_type and question.type.value != question_type:
            continue
        tag_names = [item.name for item in question.tags]
        if tag and tag not in tag_names:
            continue
        items.append(
            WrongAnswerListItem(
                id=progress.id,
                question_id=question.id,
                question_title=question.title,
                question_type=question.type.value,
                exam_title=exam.title if exam else "历史考试",
                wrong_count=progress.wrong_count,
                last_wrong_at=progress.last_wrong_at or progress.updated_at,
                mastered_at=progress.mastered_at,
                tags=tag_names,
                mastered=progress.mastered,
            )
        )
    return items


@wrong_answers_router.get("/{progress_id}", response_model=WrongAnswerDetailResponse)
async def get_wrong_answer_detail(
    progress_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> WrongAnswerDetailResponse:
    result = await db.execute(
        select(StudentQuestionProgress, Question, Exam)
        .join(Question, Question.id == StudentQuestionProgress.question_id)
        .outerjoin(Exam, Exam.id == StudentQuestionProgress.last_exam_id)
        .where(
            StudentQuestionProgress.id == progress_id,
            StudentQuestionProgress.student_id == user.id,
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wrong answer not found")

    progress, question, exam = row
    latest_answer_result = await db.execute(
        select(StudentExamAnswer).where(
            StudentExamAnswer.student_id == user.id,
            StudentExamAnswer.question_id == question.id,
        ).order_by(StudentExamAnswer.created_at.desc())
    )
    latest_answer = latest_answer_result.scalars().first()

    return WrongAnswerDetailResponse(
        id=progress.id,
        question_id=question.id,
        question_title=question.title,
        question_type=question.type.value,
        exam_title=exam.title if exam else "历史考试",
        wrong_count=progress.wrong_count,
        last_wrong_at=progress.last_wrong_at or progress.updated_at,
        tags=[item.name for item in question.tags],
        mastered=progress.mastered,
        question_content=question.content,
        standard_answer=question.answer,
        analysis=question.analysis,
        student_answer=latest_answer.answer_content if latest_answer else {},
        feedback=latest_answer.feedback if latest_answer else {},
    )


@wrong_answers_router.post("/{progress_id}/mastered")
async def mark_wrong_answer_mastered(
    progress_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> dict[str, Any]:
    result = await db.execute(
        select(StudentQuestionProgress).where(
            StudentQuestionProgress.id == progress_id,
            StudentQuestionProgress.student_id == user.id,
        )
    )
    progress = result.scalar_one_or_none()
    if progress is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wrong answer not found")

    progress.mastered = True
    progress.mastered_at = _utcnow()
    await db.commit()
    return {"mastered": True}
