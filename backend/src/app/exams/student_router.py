import asyncio
from collections.abc import AsyncIterator
from collections import Counter
import hashlib
from html import unescape
import json
import logging
import os
import re
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any
import unicodedata

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, WebSocket, WebSocketException, status
from fastapi.responses import StreamingResponse

from app.activity_logs.service import CATEGORY_EXAM, log_event
import httpx
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.auth.external_guest_dependencies import get_actor_for_exam
from app.auth.models import User
from app.auth.security import decode_access_token
from app.auth.user_settings import get_user_ai_config
from app.code_runner.client import run_code_via_judge_runner
from app.code_runner.service import run_code
from app.config import settings
from app.database import async_session, get_db
from app.exams.models import (
    AppealStatus,
    Exam,
    ExamAttemptState,
    ExamQuestion,
    ExamStudent,
    GradingStatus,
    StudentExamAnswer,
    StudentExamAppeal,
    StudentNotification,
    StudentExamSubmission,
    StudentExamSubmissionAnswer,
    StudentQuestionProgress,
)
from app.exams.question_sanitizer import sanitize_question_content, sanitize_question_options
from app.exams.time_utils import coerce_persisted_exam_datetime_to_utc
from app.exams.wrong_answers import (
    REMEDIAL_DEFAULT_TOTAL,
    REMEDIAL_MAX_TOTAL,
    collect_wrong_question_groups,
    count_remedial_practices_by_source,
    create_remedial_practice,
    default_allocations,
    list_remedial_practices,
    load_exam_question_orders,
    load_exams_by_ids,
    load_hidden_practice_sources,
    load_student_wrong_answers,
    resolve_effective_exam_id,
)
from app.exams.student_schemas import (
    AppealCreateRequest,
    AppealResponse,
    AttemptStatusResponse,
    RemedialPracticeAnalysisResponse,
    RemedialPracticeCreateRequest,
    RemedialPracticeCreateResponse,
    RemedialPracticeGroupItem,
    RemedialPracticeSummaryItem,
    SaveAnswersRequest,
    SelectedTextExplainRequest,
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
    VisibilityEventsRequest,
    VisibilityEventsResponse,
    WrongAnswerDetailResponse,
    WrongAnswerListItem,
)
from app.grading.models import GradingAuditEvent, GradingTask, RoleBinding
from app.grading.service import (
    apply_grading_task_failure_to_exam_submission,
    apply_grading_task_result_to_exam_submission,
    create_grading_task,
    list_active_exam_submission_task_question_ids,
    run_grading_task_with_role_binding,
)
from app.lsp_runner.client import proxy_lsp_websocket
from app.lsp_runner.schemas import LspGatewaySession, LspLanguage, SUPPORTED_LSP_LANGUAGES
from app.questions.models import Question, QuestionType
from app.questions.ai_generate import AIModelProvider

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


def _question_type_value(question_type: Any) -> str:
    if isinstance(question_type, QuestionType):
        return question_type.value
    value = getattr(question_type, "value", question_type)
    return str(value)


def _normalize_answer_points(answer: dict[str, Any]) -> list[str]:
    raw_points = answer.get("points")
    if isinstance(raw_points, list):
        return [str(item).strip() for item in raw_points if str(item).strip()]
    if isinstance(raw_points, str) and raw_points.strip():
        return [line.strip() for line in raw_points.splitlines() if line.strip()]

    for key in ("summary", "text", "answer", "correct"):
        value = answer.get(key)
        if isinstance(value, list):
            points = [str(item).strip() for item in value if str(item).strip()]
            if points:
                return points
        if isinstance(value, str) and value.strip():
            return [line.strip() for line in value.splitlines() if line.strip()]

    return []


def _dimension_max_scores(question_score: float, weights: dict[str, float]) -> dict[str, float]:
    return {key: round(question_score * weight, 2) for key, weight in weights.items()}


def _build_default_rubric_definition(question_type: str, question_score: float) -> tuple[dict[str, Any], dict[str, float]]:
    if question_type == QuestionType.CODE.value:
        weights = {
            "test_correctness": 0.55,
            "functional_completeness": 0.25,
            "edge_cases": 0.1,
            "code_quality": 0.1,
        }
        max_scores = _dimension_max_scores(question_score, weights)
        return (
            {
                "source": "system_default",
                "version": "2026-05-subjective-rubric-v1",
                "dimensions": [
                    {
                        "key": "test_correctness",
                        "label": "测试正确性",
                        "weight": weights["test_correctness"],
                        "max_score": max_scores["test_correctness"],
                        "criteria": "依据公开和隐藏测试、编译结果、运行结果判断输出是否符合期望。",
                    },
                    {
                        "key": "functional_completeness",
                        "label": "功能完整度",
                        "weight": weights["functional_completeness"],
                        "max_score": max_scores["functional_completeness"],
                        "criteria": "核心算法、输入读取、输出格式和题目要求的主要功能是否完整实现。",
                    },
                    {
                        "key": "edge_cases",
                        "label": "边界与异常处理",
                        "weight": weights["edge_cases"],
                        "max_score": max_scores["edge_cases"],
                        "criteria": "是否考虑边界数据、空值、重复值、极值、异常路径或题目要求的特殊情况。",
                    },
                    {
                        "key": "code_quality",
                        "label": "代码质量",
                        "weight": weights["code_quality"],
                        "max_score": max_scores["code_quality"],
                        "criteria": "代码结构、可读性、复杂度、变量命名和实现方式是否合理。",
                    },
                ],
            },
            weights,
        )

    if question_type == QuestionType.ESSAY.value:
        weights = {
            "answer_point_coverage": 0.35,
            "argument_accuracy": 0.25,
            "argument_depth": 0.25,
            "structure_expression": 0.15,
        }
        max_scores = _dimension_max_scores(question_score, weights)
        return (
            {
                "source": "system_default",
                "version": "2026-05-subjective-rubric-v1",
                "dimensions": [
                    {
                        "key": "answer_point_coverage",
                        "label": "要点覆盖",
                        "weight": weights["answer_point_coverage"],
                        "max_score": max_scores["answer_point_coverage"],
                        "criteria": "是否覆盖标准答案或答案要点中的核心观点、概念和结论。",
                    },
                    {
                        "key": "argument_accuracy",
                        "label": "观点准确性",
                        "weight": weights["argument_accuracy"],
                        "max_score": max_scores["argument_accuracy"],
                        "criteria": "核心判断、术语使用、事实和逻辑是否准确，是否存在明显错误。",
                    },
                    {
                        "key": "argument_depth",
                        "label": "论证深度",
                        "weight": weights["argument_depth"],
                        "max_score": max_scores["argument_depth"],
                        "criteria": "是否有充分解释、因果链条、例证、对比或场景分析，而不是只罗列结论。",
                    },
                    {
                        "key": "structure_expression",
                        "label": "结构与表达",
                        "weight": weights["structure_expression"],
                        "max_score": max_scores["structure_expression"],
                        "criteria": "行文结构、层次、表达清晰度和专业表述是否达到题目要求。",
                    },
                ],
            },
            weights,
        )

    weights = {
        "answer_point_coverage": 0.5,
        "accuracy": 0.3,
        "logic_completeness": 0.15,
        "expression_quality": 0.05,
    }
    max_scores = _dimension_max_scores(question_score, weights)
    return (
        {
            "source": "system_default",
            "version": "2026-05-subjective-rubric-v1",
            "dimensions": [
                {
                    "key": "answer_point_coverage",
                    "label": "要点覆盖",
                    "weight": weights["answer_point_coverage"],
                    "max_score": max_scores["answer_point_coverage"],
                    "criteria": "是否覆盖标准答案或答案要点中的核心概念、条件、步骤和结论。",
                },
                {
                    "key": "accuracy",
                    "label": "准确性",
                    "weight": weights["accuracy"],
                    "max_score": max_scores["accuracy"],
                    "criteria": "知识点、术语、关系和结论是否准确，是否存在概念混淆。",
                },
                {
                    "key": "logic_completeness",
                    "label": "逻辑完整性",
                    "weight": weights["logic_completeness"],
                    "max_score": max_scores["logic_completeness"],
                    "criteria": "解释链条是否完整，是否说明原因、条件、过程或必要补充。",
                },
                {
                    "key": "expression_quality",
                    "label": "表达规范性",
                    "weight": weights["expression_quality"],
                    "max_score": max_scores["expression_quality"],
                    "criteria": "表述是否清晰、规范、易理解；非关键措辞差异不得机械扣分。",
                },
            ],
        },
        weights,
    )


def _build_scoring_points(question_type: str, answer: dict[str, Any], content: dict[str, Any]) -> list[dict[str, Any]]:
    if question_type == QuestionType.CODE.value:
        points: list[dict[str, Any]] = [
            {
                "key": "test_correctness",
                "expected": "通过公开与隐藏测试用例，输出与期望结果一致",
            }
        ]
        sample_tests = content.get("sample_tests")
        if isinstance(sample_tests, list) and sample_tests:
            points.append(
                {
                    "key": "sample_tests",
                    "expected": "至少正确处理题目提供的示例测试",
                    "cases": sample_tests,
                }
            )
        for key, label in (
            ("input_description", "输入说明"),
            ("output_description", "输出说明"),
            ("constraints", "约束条件"),
            ("function_name", "函数名"),
            ("signature", "函数签名"),
        ):
            value = content.get(key)
            if value:
                points.append({"key": key, "expected": f"{label}: {value}"})
        return points

    points = _normalize_answer_points(answer)
    return [
        {
            "key": f"point_{index + 1}",
            "expected": point,
            "weight": round(1 / len(points), 4) if points else 1,
        }
        for index, point in enumerate(points)
    ]


def _build_standard_answers(question_type: str, answer: dict[str, Any], analysis: str | None) -> list[dict[str, Any]]:
    analysis_text = _strip_html(analysis)
    if question_type == QuestionType.CODE.value:
        reference_code = answer.get("code")
        item: dict[str, Any] = {}
        if isinstance(reference_code, str) and reference_code.strip():
            item["reference_code"] = reference_code.strip()
        if analysis_text:
            item["analysis"] = analysis_text
        return [item] if item else []

    points = _normalize_answer_points(answer)
    item: dict[str, Any] = {"points": points}
    if analysis_text:
        item["analysis"] = analysis_text
    return [item] if points or analysis_text else []


_FILL_IN_BLANK_PLACEHOLDER_RE = re.compile(r"_{3,}|（\s*）|\(\s*\)|【\s*】")
_FILL_IN_EDGE_PUNCT_RE = re.compile(r"^[\s,，、.。．;；:：]+|[\s,，、.。．;；:：]+$")
_FILL_IN_GRADING_MODEL = "deepseek-flash"
_FILL_IN_INVISIBLE_CHAR_RE = re.compile(r"[\u200b\u200c\u200d\ufeff]")
_FILL_IN_EMPTY_CALL_RE = re.compile(r"^([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)\(\)$")
_FILL_IN_SIMPLE_SUBSCRIPT_RE = re.compile(r"_\{([a-z0-9]+)\}")
_FILL_IN_FORMULA_SPACING_RE = re.compile(r"\s*([{}_^=+\-*/(),;:])\s*")
_FILL_IN_GRADING_CACHE_KEY = "_fill_in_grading_cache"


def _split_fill_in_text(text: str) -> list[str]:
    """Split a free-form fill-in answer string into per-blank items.

    Uses the same separators as the import builder (`buildAnswerPayload`) so a
    multi-blank standard answer written as one string (common for AI-generated
    questions, whose answer is stored as ``{"text": "..."}``) is split into the
    individual blanks. Falls back to the whole trimmed string when there is no
    separator.
    """
    parts = [part.strip() for part in re.split(r"[;,；，\n]", text)]
    parts = [part for part in parts if part]
    if parts:
        return parts
    stripped = text.strip()
    return [stripped] if stripped else []


def _get_fill_in_expected_answers(answer: dict[str, Any]) -> list[str]:
    raw = answer.get("blanks")
    if raw is None:
        raw = answer.get("correct")
    if isinstance(raw, list):
        return [str(item) for item in raw]
    if isinstance(raw, str):
        # A scalar string under blanks/correct: keep as a single expected answer
        # (manual/import store lists; a lone string is treated as one blank).
        stripped = raw.strip()
        return [stripped] if stripped else []
    if raw is not None:
        return [str(raw)]

    # Fallback: AI-generated fill-in questions store the answer as {"text": ...}
    # (see ai_generate_prompt). Without this, expected answers come back empty
    # and even an identical student answer scores 0 — and the AI equivalence
    # path (gated on a non-empty expected list) never runs.
    for key in ("text", "answer"):
        value = answer.get(key)
        if isinstance(value, str) and value.strip():
            return _split_fill_in_text(value)
        if isinstance(value, list) and value:
            return [str(item) for item in value]
    return []


def _count_fill_in_placeholders(content: dict[str, Any]) -> int:
    text = content.get("text") or content.get("html") or ""
    if not isinstance(text, str):
        return 0
    return len(_FILL_IN_BLANK_PLACEHOLDER_RE.findall(text))


def _normalize_fill_in_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    normalized = _FILL_IN_INVISIBLE_CHAR_RE.sub("", normalized)
    normalized = (
        normalized
        .replace("，", ",")
        .replace("。", ".")
        .replace("．", ".")
        .replace("：", ":")
        .replace("；", ";")
        .replace("（", "(")
        .replace("）", ")")
    )

    if any(marker in normalized for marker in ("\\", "^", "_", "{", "}")):
        normalized = normalized.replace(r"\left", "").replace(r"\right", "")
        normalized = _FILL_IN_SIMPLE_SUBSCRIPT_RE.sub(r"_\1", normalized)
        normalized = _FILL_IN_FORMULA_SPACING_RE.sub(r"\1", normalized)

    empty_call_match = _FILL_IN_EMPTY_CALL_RE.fullmatch(normalized.strip())
    if empty_call_match:
        normalized = empty_call_match.group(1)

    return _FILL_IN_EDGE_PUNCT_RE.sub("", _normalize_text(normalized))


def _is_fill_in_exact_match(actual: str, expected: str) -> bool:
    return _normalize_fill_in_text(actual) == _normalize_fill_in_text(expected)


def _has_fill_in_answer(provided_list: list[str]) -> bool:
    return any(_normalize_fill_in_text(item) for item in provided_list)


def _is_fill_in_unordered_full_match(provided_list: list[str], expected_list: list[str]) -> bool:
    if len(provided_list) != len(expected_list):
        return False
    normalized_provided = [_normalize_fill_in_text(item) for item in provided_list]
    normalized_expected = [_normalize_fill_in_text(item) for item in expected_list]
    if any(not item for item in normalized_provided) or any(not item for item in normalized_expected):
        return False
    return Counter(normalized_provided) == Counter(normalized_expected)


def _try_joined_fill_in_match(provided_list: list[str], expected_list: list[str]) -> bool:
    """Check if a single provided answer matches all expected items joined together.

    Handles the common case where a standard answer containing commas (e.g. inside a
    LaTeX expression) is incorrectly split into multiple expected items at import time,
    while the student answers the whole thing as one blank.
    """
    if len(provided_list) != 1 or len(expected_list) <= 1:
        return False
    for sep in (",", "，", ";", "；"):
        joined = sep.join(expected_list)
        if _is_fill_in_exact_match(provided_list[0], joined):
            return True
    return False


def _build_fill_in_unordered_exact_match_flags(
    provided_list: list[str],
    expected_list: list[str],
) -> list[bool]:
    match_flags = [False] * len(expected_list)
    expected_indices_by_answer: dict[str, list[int]] = {}
    for index, expected_item in enumerate(expected_list):
        normalized = _normalize_fill_in_text(expected_item)
        if normalized:
            expected_indices_by_answer.setdefault(normalized, []).append(index)

    for provided_item in provided_list:
        normalized = _normalize_fill_in_text(provided_item)
        if not normalized:
            continue
        candidate_indices = expected_indices_by_answer.get(normalized)
        if not candidate_indices:
            continue
        expected_index = candidate_indices.pop(0)
        match_flags[expected_index] = True

    return match_flags


_FILL_IN_GRADING_SIGNATURE_VERSION = "v3"  # bump to invalidate old caches


def _build_fill_in_grading_signature(
    *,
    expected_list: list[str],
    provided_list: list[str],
    score: float,
    knowledge_points: list[str] | None = None,
) -> str:
    payload = {
        "v": _FILL_IN_GRADING_SIGNATURE_VERSION,
        "expected": [_normalize_fill_in_text(item) for item in expected_list],
        "provided": [_normalize_fill_in_text(item) for item in provided_list],
        "score": round(float(score), 4),
        "knowledge_points": sorted(knowledge_points or []),
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _get_cached_fill_in_grading(
    answer_content: dict[str, Any],
    signature: str,
) -> tuple[float, bool, dict[str, Any]] | None:
    cache = answer_content.get(_FILL_IN_GRADING_CACHE_KEY)
    if not isinstance(cache, dict) or cache.get("signature") != signature:
        return None
    feedback = cache.get("feedback")
    if not isinstance(feedback, dict):
        return None
    try:
        score = float(cache.get("score_awarded", 0.0))
    except (TypeError, ValueError):
        return None
    return score, bool(cache.get("is_correct")), deepcopy(feedback)


def _set_cached_fill_in_grading(
    answer_content: dict[str, Any],
    *,
    signature: str,
    score_awarded: float,
    is_correct: bool,
    feedback: dict[str, Any],
) -> None:
    answer_content[_FILL_IN_GRADING_CACHE_KEY] = {
        "signature": signature,
        "score_awarded": score_awarded,
        "is_correct": is_correct,
        "feedback": deepcopy(feedback),
        "evaluated_at": _utcnow().isoformat(),
    }


def _strip_internal_answer_metadata(answer_content: Any) -> dict[str, Any]:
    if not isinstance(answer_content, dict):
        return {}
    cleaned = deepcopy(answer_content)
    cleaned.pop(_FILL_IN_GRADING_CACHE_KEY, None)
    return cleaned


def _build_public_saved_answers(saved_answers: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(saved_answers, dict):
        return {}
    return {
        str(question_id): _strip_internal_answer_metadata(answer_content)
        for question_id, answer_content in saved_answers.items()
    }


def _carry_forward_fill_in_cache(
    *,
    incoming: dict[str, Any],
    previous: Any,
) -> dict[str, Any]:
    answer_content = deepcopy(incoming)
    if _FILL_IN_GRADING_CACHE_KEY in answer_content:
        return answer_content
    if isinstance(previous, dict) and isinstance(previous.get(_FILL_IN_GRADING_CACHE_KEY), dict):
        answer_content[_FILL_IN_GRADING_CACHE_KEY] = deepcopy(previous[_FILL_IN_GRADING_CACHE_KEY])
    return answer_content




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
    knowledge_points: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Ask DeepSeek to score each blank in a fill-in question.

    Returns a list of `{"score": 0|0.5|1, "is_correct": bool, "reason": str}`
    entries, one per `expected_answers[i]`. Score 1 = full credit, 0.5 =
    partial credit (knowledge-point aligned but text mismatch), 0 = no credit.
    """
    if not settings.deepseek_api_key:
        raise RuntimeError("未配置 DeepSeek API Key")

    knowledge_block = ""
    if knowledge_points:
        knowledge_block = f"\n知识点：{json.dumps(knowledge_points, ensure_ascii=False)}"

    prompt = f"""
你是考试填空题自动批改助手。请对每个填空进行评分。

输入说明：
- 题目内容：题目原文。
- 考生答案：考生在每个空填写的内容（按空的顺序）。
- 标准答案：每个空对应一个可接受答案列表，按优先级排序；考生命中任意一项即视为正确。
- 知识点（可选）：题目涉及的知识点，可作为部分分判定依据。

判题规则：
1. 同义词匹配：考生答案与该空任一标准答案语义等价，视为正确（得 1 分）。
2. 格式宽容：忽略前后空格、全/半角差异；字母不分大小写；忽略末尾标点。
3. 顺序无关：多个空之间允许位置错位，只要"该空填的内容"在标准答案集合中可被一一对应即可，但每个考生答案至多匹配一个标准答案。
4. 知识点修正：若知识点明确、考生答案符合该知识点但文字不完全匹配，可酌情给部分分数 0.5。
5. 完全错误：答案与标准答案无任何语义或文字关联，计 0 分。

题目内容：{question_text}{knowledge_block}
标准答案：{json.dumps(expected_answers, ensure_ascii=False)}
考生答案：{json.dumps(student_answers, ensure_ascii=False)}

只输出 JSON，禁止包含 Markdown 围栏或额外说明：
{{
  "matches": [
    {{"score": 1, "reason": "简短理由"}}
  ]
}}
matches 的长度必须等于标准答案长度，顺序与标准答案一致。
score 取值仅允许 0、0.5、1 中之一。
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
    return [_normalize_fill_in_match_payload(item) for item in matches if isinstance(item, dict)]


def _normalize_fill_in_match_payload(item: dict[str, Any]) -> dict[str, Any]:
    """Coerce one match entry to {score, is_correct, reason}.

    Accepts the new {score} schema and the legacy {is_correct} schema so a
    half-rolled-out prompt or a cached LLM call doesn't crash the grader.
    """
    score_raw = item.get("score")
    if isinstance(score_raw, (int, float)):
        score = float(score_raw)
    elif isinstance(score_raw, str):
        try:
            score = float(score_raw)
        except ValueError:
            score = 1.0 if item.get("is_correct") is True else 0.0
    else:
        score = 1.0 if item.get("is_correct") is True else 0.0
    # Clamp to {0, 0.5, 1} — the prompt forbids other values, but a tolerant
    # parser is cheaper than an LLM retry on a rare malformed response.
    if score >= 1.0:
        score = 1.0
    elif score >= 0.5:
        score = 0.5
    else:
        score = 0.0
    reason = item.get("reason")
    return {
        "score": score,
        "is_correct": score >= 1.0,
        "reason": str(reason).strip() if isinstance(reason, str) else "",
    }


def _build_student_question_content(question: Question) -> dict[str, Any]:
    content = deepcopy(question.content) if isinstance(question.content, dict) else {}
    question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
    if question_type == QuestionType.CHOICE.value:
        answer = question.answer or {}
        if isinstance(answer, dict):
            content["multi"] = content.get("multi") is True or isinstance(answer.get("correct"), list)
    if question_type == QuestionType.FILL_IN.value:
        explicit_count = content.get("blank_count")
        counts = [
            explicit_count if isinstance(explicit_count, int) and explicit_count > 0 else 0,
            len(_get_fill_in_expected_answers(question.answer or {})),
            _count_fill_in_placeholders(content),
        ]
        content["blank_count"] = max(counts) or 1
    return sanitize_question_content(content)


def _extract_answer_text(answer_content: dict[str, Any]) -> str:
    code = answer_content.get("code")
    if isinstance(code, str) and code.strip():
        # Keep the answer body separate from editor/runtime metadata.  The
        # grading task already persists language and the full structured
        # payload in dedicated fields; appending them here makes tokens such
        # as ``python`` look like part of the student's source code.
        return code.strip()

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
    question_type = _question_type_value(question.type)
    question_content = question.content.get("text") if isinstance(question.content, dict) else None
    raw_question_content = _strip_html(question_content if isinstance(question_content, str) else question.title)
    standard_answer = question.answer if isinstance(question.answer, dict) else {}
    question_content_structured = question.content if isinstance(question.content, dict) else {}
    standard_answers = _build_standard_answers(question_type, standard_answer, question.analysis)
    scoring_points = _build_scoring_points(question_type, standard_answer, question_content_structured)
    rubric_definition, dimension_weights = _build_default_rubric_definition(question_type, question_score)
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
        "standard_answers": standard_answers,
        "rubric_definition": rubric_definition,
        "scoring_points": scoring_points,
        "dimension_weights": dimension_weights,
        "deduction_rules": [
            {
                "condition": "answer_is_empty_or_irrelevant",
                "rule": "未作答、明显空泛、与题目无关时，对相关维度给 0 分，并在 risk_flags 标记。",
            },
            {
                "condition": "semantic_equivalent_expression",
                "rule": "表达方式不同但与标准答案语义等价时，应按对应要点给分，不按关键词机械扣分。",
            },
        ],
        "fatal_error_rules": [
            {
                "condition": "blank_answer",
                "rule": "学生完全未作答或仅输入无意义字符时，总分为 0。",
            }
        ],
        "role_binding_version": role_binding_version,
        "programming_language": language,
        "runtime_logs": [],
    }


# Cap concurrent LLM grading calls. Providers rate-limit aggressively (the
# doubao arbiter account, for example, runs at ~1 QPS). The semaphore is
# **module-level** so the budget is shared across every in-flight student
# submission on this worker — otherwise 30 students submitting at once would
# each get their own Semaphore(N) and 30×N concurrent calls would stampede
# the upstream provider. Tune via ``EXAM_GRADING_CONCURRENCY`` to match the
# slowest provider's rate limit.
_GRADING_CONCURRENCY = int(os.environ.get("EXAM_GRADING_CONCURRENCY", "3") or 3)
_GRADING_SEMAPHORE: asyncio.Semaphore | None = None


def _get_grading_semaphore() -> asyncio.Semaphore:
    # Lazy init — ``asyncio.Semaphore`` must be created inside a running event
    # loop on older Pythons, and lazily ensures we pick up the worker's loop
    # rather than capturing one at import time.
    global _GRADING_SEMAPHORE
    if _GRADING_SEMAPHORE is None:
        _GRADING_SEMAPHORE = asyncio.Semaphore(_GRADING_CONCURRENCY)
    return _GRADING_SEMAPHORE


async def _run_subjective_grading_tasks(task_ids: list[str]) -> None:
    """Drive a batch of grading tasks with bounded concurrency.

    Each task owns its own DB session so a failure in one cannot poison the
    others' transaction state. Concurrency is bounded by the **shared**
    process-wide semaphore so that simultaneous submissions don't multiply
    the LLM call rate (30 submitters × Semaphore(3) ≠ 90 in flight; it's
    still 3).
    """
    if not task_ids:
        return
    semaphore = _get_grading_semaphore()

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
        if task_status == "failed":
            # 主评 / 复核失败：service 已经写了详细审计；这里只做考生侧 reconcile，
            # 不写额外的 grading.failed（否则会冲淡 service 那条精细记录）。
            await _reconcile_failed_grading_task(
                db,
                task_id,
                reason=result.get("reason") or "grading_failed",
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
    *,
    force_recompute: bool = False,
) -> tuple[float, bool, dict[str, Any]]:
    expected_list = _get_fill_in_expected_answers(question.answer or {})
    provided = answer_content.get("blanks", [])
    provided_list = [str(item) for item in provided] if isinstance(provided, list) else [str(provided)]
    total = max(len(expected_list), 1)
    knowledge_points = [
        kp.name for kp in (question.knowledge_points or [])
        if getattr(kp, "name", None)
    ]
    signature = _build_fill_in_grading_signature(
        expected_list=expected_list,
        provided_list=provided_list,
        score=score,
        knowledge_points=knowledge_points,
    )

    if force_recompute:
        # Drop any prior cached verdict so an admin-triggered regrade really
        # re-runs the matchers and the equivalence LLM.
        answer_content.pop(_FILL_IN_GRADING_CACHE_KEY, None)
    else:
        cached = _get_cached_fill_in_grading(answer_content, signature)
        if cached is not None:
            return cached

    if not _has_fill_in_answer(provided_list):
        feedback = {
            "dimensions": [
                {
                    "name": "填空准确率",
                    "score": 0.0,
                    "max_score": score,
                    "comment": "尚未作答。",
                }
            ],
            "strengths": [],
            "deductions": ["未填写答案。"],
            "suggestions": ["请先填写答案。"],
        }
        _set_cached_fill_in_grading(
            answer_content,
            signature=signature,
            score_awarded=0.0,
            is_correct=False,
            feedback=feedback,
        )
        return 0.0, False, feedback

    if expected_list and _is_fill_in_unordered_full_match(provided_list, expected_list):
        feedback = {
            "dimensions": [
                {
                    "name": "填空准确率",
                    "score": score,
                    "max_score": score,
                    "comment": f"共命中 {len(expected_list)}/{len(expected_list)} 个空。",
                }
            ],
            "strengths": ["答案内容完整，顺序差异不影响判定。"],
            "deductions": [],
            "suggestions": [],
        }
        _set_cached_fill_in_grading(
            answer_content,
            signature=signature,
            score_awarded=score,
            is_correct=True,
            feedback=feedback,
        )
        return (
            score,
            True,
            feedback,
        )

    if expected_list and _try_joined_fill_in_match(provided_list, expected_list):
        feedback = {
            "dimensions": [
                {
                    "name": "填空准确率",
                    "score": score,
                    "max_score": score,
                    "comment": f"共命中 {len(expected_list)}/{len(expected_list)} 个空（合并比对）。",
                }
            ],
            "strengths": ["答案内容与标准答案等价（合并比对判定正确）。"],
            "deductions": [],
            "suggestions": [],
        }
        _set_cached_fill_in_grading(
            answer_content,
            signature=signature,
            score_awarded=score,
            is_correct=True,
            feedback=feedback,
        )
        return score, True, feedback

    match_flags = _build_fill_in_unordered_exact_match_flags(provided_list, expected_list)
    # Per-blank fractional score: exact match → 1.0, AI partial credit → 0.5,
    # AI full credit → 1.0, AI no credit → 0.0.
    match_scores: list[float] = [1.0 if flag else 0.0 for flag in match_flags]
    ai_reasons: dict[int, str] = {}
    model_evaluation: dict[str, Any] | None = None
    ai_attempted = False
    ai_succeeded = True  # vacuously true when no AI call is needed

    if expected_list and not all(flag for flag in match_flags):
        ai_attempted = True
        ai_succeeded = False
        try:
            ai_matches = await _request_fill_in_equivalence_with_deepseek(
                question_text=_get_question_plain_text(question),
                expected_answers=expected_list,
                student_answers=[provided_list[index] if index < len(provided_list) else "" for index in range(len(expected_list))],
                knowledge_points=knowledge_points or None,
            )
            for index, item in enumerate(ai_matches[: len(expected_list)]):
                if match_flags[index]:
                    continue
                ai_score = float(item.get("score") or 0.0)
                if ai_score > match_scores[index]:
                    match_scores[index] = ai_score
                reason = item.get("reason")
                if isinstance(reason, str) and reason.strip():
                    ai_reasons[index] = reason.strip()
            model_evaluation = {
                "model": _FILL_IN_GRADING_MODEL,
                "matches": [
                    {
                        "index": index + 1,
                        "expected": expected_list[index] if index < len(expected_list) else "",
                        "score": float(item.get("score") or 0.0),
                        "is_correct": bool(item.get("is_correct")),
                        "reason": str(item.get("reason") or "").strip(),
                    }
                    for index, item in enumerate(ai_matches[: len(expected_list)])
                ],
            }
            ai_succeeded = True
        except Exception as exc:  # noqa: BLE001 - AI grading must not block exam submission.
            logger.warning("DeepSeek fill-in grading unavailable: %s", exc)

    total_credit = sum(match_scores)
    full_matches = sum(1 for s in match_scores if s >= 1.0)
    partial_matches = sum(1 for s in match_scores if 0.0 < s < 1.0)
    missing_points = [
        f"第 {index + 1} 空应为 {expected_item}"
        for index, expected_item in enumerate(expected_list)
        if match_scores[index] <= 0.0
    ]
    actual_score = round(score * total_credit / total, 2)
    correct = full_matches == total
    ai_strengths: list[str] = []
    for index, reason in sorted(ai_reasons.items()):
        if match_scores[index] >= 1.0:
            ai_strengths.append(f"DeepSeek 判定第 {index + 1} 空等价：{reason}")
        elif match_scores[index] > 0.0:
            ai_strengths.append(f"DeepSeek 判定第 {index + 1} 空部分得分：{reason}")

    comment_parts = [f"共命中 {full_matches}/{total} 个空"]
    if partial_matches:
        comment_parts.append(f"另有 {partial_matches} 个空获得部分分")
    feedback = {
        "dimensions": [
            {
                "name": "填空准确率",
                "score": actual_score,
                "max_score": score,
                "comment": "，".join(comment_parts) + "。",
            }
        ],
        "strengths": (
            [f"命中 {full_matches} 个空。"] if full_matches else []
        ) + ai_strengths,
        "deductions": missing_points,
        "suggestions": ["复查拼写、术语与顺序。"] if not correct else [],
    }
    if model_evaluation:
        feedback["model_evaluation"] = model_evaluation
    if ai_attempted and not ai_succeeded:
        # Don't poison the cache with a likely-low score from a failed AI call —
        # the next attempt (or a manual regrade) should retry the LLM.
        feedback["grading_warning"] = "AI 等价判定调用失败，本次评分基于精确匹配，未缓存。"
    else:
        _set_cached_fill_in_grading(
            answer_content,
            signature=signature,
            score_awarded=actual_score,
            is_correct=correct,
            feedback=feedback,
        )
    return actual_score, correct, feedback


async def _grade_question_with_ai(
    question: Question,
    answer_content: dict[str, Any],
    score: float,
    *,
    force_recompute: bool = False,
) -> tuple[float, bool, dict[str, Any]]:
    question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
    if question_type == QuestionType.FILL_IN.value:
        return await _grade_fill_in_question_with_ai(
            question, answer_content, score, force_recompute=force_recompute
        )
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
        if expected_list and _try_joined_fill_in_match(provided_list, expected_list):
            return (
                score,
                True,
                {
                    "dimensions": [{"name": "填空准确率", "score": score, "max_score": score, "comment": f"共命中 {len(expected_list)}/{len(expected_list)} 个空（合并比对）。"}],
                    "strengths": ["答案内容与标准答案等价（合并比对判定正确）。"],
                    "deductions": [],
                    "suggestions": [],
                },
            )
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


def _lazy_expire_attempt(exam: Exam, exam_student: ExamStudent) -> None:
    """Transition in_progress → expired when the exam window has closed."""
    if exam_student.attempt_state == ExamAttemptState.IN_PROGRESS.value:
        end_time = _as_utc(exam.end_time)
        if end_time is not None and end_time < _utcnow():
            exam_student.attempt_state = ExamAttemptState.EXPIRED.value


def _ensure_exam_attempt_in_progress(exam: Exam, exam_student: ExamStudent) -> None:
    _lazy_expire_attempt(exam, exam_student)
    state = exam_student.attempt_state
    if state == ExamAttemptState.CREATED.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam not started")
    if state == ExamAttemptState.SUBMITTED.value or state == ExamAttemptState.GRADED.value:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam already submitted")
    if state == ExamAttemptState.EXPIRED.value:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Exam window closed")


def _ensure_exam_attempt_in_progress_for_websocket(exam: Exam, exam_student: ExamStudent) -> None:
    _lazy_expire_attempt(exam, exam_student)
    state = exam_student.attempt_state
    if state == ExamAttemptState.CREATED.value:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Exam not started")
    if state in (ExamAttemptState.SUBMITTED.value, ExamAttemptState.GRADED.value):
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Exam already submitted")
    if state == ExamAttemptState.EXPIRED.value:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="Exam window closed")


def _get_personal_attempt_deadline(exam: Exam, exam_student: ExamStudent) -> datetime | None:
    started_at = _as_utc(exam_student.started_at)
    if started_at is None or exam.duration_minutes <= 0:
        return None
    duration_deadline = started_at + timedelta(minutes=exam.duration_minutes)
    end_time = _as_utc(exam.end_time)
    if end_time is None:
        return duration_deadline
    return min(duration_deadline, end_time)


def _is_personal_attempt_exhausted(exam: Exam, exam_student: ExamStudent) -> bool:
    deadline = _get_personal_attempt_deadline(exam, exam_student)
    return deadline is not None and deadline <= _utcnow()


def _can_start_retake(exam: Exam, exam_student: ExamStudent) -> bool:
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
    if exam_student.submitted_at is None and not _is_personal_attempt_exhausted(exam, exam_student):
        return False
    return True


def _reset_exam_student_for_retake(exam_student: ExamStudent) -> None:
    exam_student.started_at = _utcnow()
    exam_student.attempt_state = ExamAttemptState.IN_PROGRESS.value
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
    request: Request,
    payload: StartExamRequest | None = None,
) -> StudentExamStartResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    _ensure_exam_open(exam)
    was_retake = False
    wants_retake = bool(payload and payload.retake)
    if wants_retake and (exam_student.started_at is not None or exam_student.submitted_at is not None):
        if not _can_start_retake(exam, exam_student):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Retake is not allowed")

        was_retake = True
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
    elif exam_student.submitted_at is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exam already submitted")

    started_fresh = False
    if exam_student.started_at is None:
        exam_student.started_at = _utcnow()
        exam_student.attempt_state = ExamAttemptState.IN_PROGRESS.value
        await db.commit()
        await db.refresh(exam)
        exam_student = next(item for item in exam.exam_students if item.student_id == user.id)
        started_fresh = True
    elif exam_student.attempt_state == ExamAttemptState.CREATED.value:
        # Self-heal: migration server_default filled existing started rows as "created".
        # Correct to in_progress so save/submit calls don't 400.
        _lazy_expire_attempt(exam, exam_student)
        if exam_student.attempt_state == ExamAttemptState.CREATED.value:
            exam_student.attempt_state = ExamAttemptState.IN_PROGRESS.value
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
            options=(
                sanitize_question_options(eq.question.options)
                if isinstance(eq.question.options, list)
                else eq.question.options
            ),
        )
        for eq in sorted(exam.exam_questions, key=lambda item: item.order)
    ]

    if started_fresh or was_retake:
        await log_event(
            db,
            event_category=CATEGORY_EXAM,
            event_type="exam_retake" if was_retake else "exam_start",
            user=user,
            target_type="exam",
            target_id=exam.id,
            metadata={"title": exam.title, "category": exam.category},
            request=request,
        )
        await db.commit()

    return StudentExamStartResponse(
        exam_id=exam.id,
        title=exam.title,
        category=exam.category,
        ai_explanation_enabled=exam.category == "practice" or exam.hidden_from_list,
        duration_minutes=exam.duration_minutes,
        max_switch_count=exam.max_switch_count,
        allow_retake=exam.allow_retake,
        started_at=exam_student.started_at,
        end_time=exam.end_time,
        questions=questions,
        saved_answers=_build_public_saved_answers(exam_student.saved_answers),
        switch_count=exam_student.switch_count,
    )


def _selection_context_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): _selection_context_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_selection_context_value(item) for item in value]
    if isinstance(value, str):
        return unescape(_strip_html(value))
    return value


async def _stream_selected_text_explanation(
    db: AsyncSession,
    user: User,
    question: Question,
    selected_text: str,
    *,
    include_solution: bool,
) -> StreamingResponse:
    content = question.content if isinstance(question.content, dict) else {}
    raw_context = content.get("text") or content.get("description") or content.get("html") or question.title
    question_context = f"题目：{_strip_html(question.title)}\n题干：{unescape(_strip_html(str(raw_context)))}"
    if isinstance(question.options, dict):
        option_lines = [
            f"{key}. {unescape(_strip_html(str(value)))}"
            for key, value in question.options.items()
            if value is not None
        ]
        if option_lines:
            question_context += "\n选项：\n" + "\n".join(option_lines[:12])
    if include_solution:
        if question.answer:
            question_context += "\n参考答案：\n" + json.dumps(
                _selection_context_value(question.answer), ensure_ascii=False
            )[:2000]
        if question.analysis:
            question_context += "\n题目解析：\n" + unescape(_strip_html(question.analysis))[:2000]
    question_context = question_context[:6000]

    provider, api_key, model_name, base_url = await get_user_ai_config(db, user.id)
    if not api_key or not model_name or not base_url:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="没有可用的 AI 模型配置，请联系管理员或检查模型设置")

    endpoint = base_url.rstrip("/")
    if not endpoint.endswith("/chat/completions"):
        endpoint = f"{endpoint}/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    request_body = {
        "model": model_name,
        "messages": [
            {
                "role": "system",
                "content": (
                    "你是课程学习中的学习助教。根据当前题目背景，简明、准确地解释学生选中的术语或片段，"
                    "说明关键概念、符号或它在题目中的作用。不要把整道题的答案直接照抄给学生。"
                    "必要时使用 Markdown 标题、列表、加粗或行内代码来组织讲解。"
                    "如果选中的是数学表达式，请解释符号含义，并用 $...$ 或 $$...$$ 标记公式。"
                ),
            },
            {
                "role": "user",
                "content": (
                    f"题目类型：{getattr(question.type, 'value', question.type)}\n"
                    f"题目背景：\n{question_context}\n\n"
                    f"请解释这段选中内容：\n{selected_text}"
                ),
            },
        ],
        "temperature": 0.3,
        "max_tokens": 1200,
        "stream": True,
    }

    def sse(event: dict[str, str]) -> str:
        return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    async def event_stream() -> AsyncIterator[str]:
        try:
            async with httpx.AsyncClient(timeout=90.0) as client:
                async with client.stream("POST", endpoint, json=request_body, headers=headers) as response:
                    if response.is_error:
                        logger.warning(
                            "AI selection explanation request failed: provider=%s status=%s",
                            provider,
                            response.status_code,
                        )
                        yield sse({"type": "error", "message": "AI 服务暂时不可用，请稍后重试"})
                        return
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line.removeprefix("data:").strip()
                        if not data:
                            continue
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        choices = chunk.get("choices")
                        if not isinstance(choices, list) or not choices:
                            continue
                        delta = choices[0].get("delta", {})
                        text = delta.get("content") if isinstance(delta, dict) else None
                        if isinstance(text, str) and text:
                            yield sse({"type": "delta", "text": text})
            yield sse({"type": "done"})
        except Exception:
            logger.exception("AI selection explanation stream failed: provider=%s", provider)
            yield sse({"type": "error", "message": "解释生成中断，请稍后重试"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/exams/{exam_id}/questions/{question_id}/explain-selected/stream")
async def explain_selected_question_text(
    exam_id: uuid.UUID,
    question_id: uuid.UUID,
    payload: SelectedTextExplainRequest,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> StreamingResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    question = (
        await db.execute(
            select(Question)
            .join(ExamQuestion, ExamQuestion.question_id == Question.id)
            .where(ExamQuestion.exam_id == exam.id, Question.id == question_id)
        )
    ).scalar_one_or_none()
    if question is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="题目不属于当前考试")

    selected_text = payload.selected_text.strip()
    if not selected_text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="请先选择要解释的内容")

    if exam_student.submitted_at is None:
        if exam.category != "practice" and not exam.hidden_from_list:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="AI 讲解仅在练习中开放")
        if exam_student.started_at is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前练习尚未开始")
        return await _stream_selected_text_explanation(
            db, user, question, selected_text, include_solution=False
        )

    can_view_result = (
        exam.show_result
        or exam.category == "practice"
        or exam_student.grading_status == GradingStatus.PENDING_AI.value
    )
    if not can_view_result:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="教师暂未开放查看结果权限")
    if exam_student.latest_submission_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="没有找到本次提交记录")

    answer = (
        await db.execute(
            select(StudentExamSubmissionAnswer).where(
                StudentExamSubmissionAnswer.submission_id == exam_student.latest_submission_id,
                StudentExamSubmissionAnswer.question_id == question.id,
                StudentExamSubmissionAnswer.student_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if answer is None or answer.is_correct:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅可讲解已确认答错的题目")
    feedback = answer.feedback if isinstance(answer.feedback, dict) else {}
    if feedback.get("grading_failed") or feedback.get("needs_human_review"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="该题评分尚未确认")
    pending_question_ids = await list_active_exam_submission_task_question_ids(
        db,
        exam_id=exam.id,
        student_id=user.id,
        submission_id=exam_student.latest_submission_id,
    )
    if question.id in pending_question_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="该题仍在评分中")

    return await _stream_selected_text_explanation(
        db, user, question, selected_text, include_solution=True
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
    _ensure_exam_attempt_in_progress(exam, exam_student)
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
            _ensure_exam_attempt_in_progress_for_websocket(exam, exam_student)
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
    _ensure_exam_attempt_in_progress(exam, exam_student)
    if exam_student.attempt_state == ExamAttemptState.EXPIRED.value:
        await db.commit()
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Exam window closed")
    end_time = _as_utc(exam.end_time)
    if end_time is not None and end_time < _utcnow():
        exam_student.attempt_state = ExamAttemptState.EXPIRED.value
        await db.commit()
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Exam window closed")

    saved_answers = dict(exam_student.saved_answers or {})
    exam_questions_by_id = {item.question_id: item for item in exam.exam_questions}
    for item in payload.answers:
        previous_answer = saved_answers.get(str(item.question_id))
        answer_content = _carry_forward_fill_in_cache(
            incoming=deepcopy(item.answer_content),
            previous=previous_answer,
        )
        exam_question = exam_questions_by_id.get(item.question_id)
        if exam_question is not None:
            question = exam_question.question
            question_type = question.type.value if isinstance(question.type, QuestionType) else str(question.type)
            if question_type == QuestionType.FILL_IN.value:
                question_score = exam_question.score_override if exam_question.score_override is not None else question.score
                await _grade_question_with_ai(question, answer_content, question_score)
        saved_answers[str(item.question_id)] = answer_content
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
    logger.info(
        "switch endpoint called with client count=%s (deprecated; server now authoritative via /visibility-events)",
        payload.switch_count,
    )
    return {
        "switch_count": exam_student.switch_count,
        "max_switch_count": exam.max_switch_count,
        "force_submit": exam.max_switch_count > 0 and exam_student.switch_count >= exam.max_switch_count,
    }


@router.get("/exams/{exam_id}/attempt-status", response_model=AttemptStatusResponse)
async def get_attempt_status(
    exam_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: ExamActor,
) -> AttemptStatusResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    _lazy_expire_attempt(exam, exam_student)
    await db.commit()
    return AttemptStatusResponse(
        state=exam_student.attempt_state,
        submitted_at=exam_student.submitted_at,
        latest_submission_id=exam_student.latest_submission_id,
        switch_count=exam_student.switch_count,
        deadline_at=exam.end_time,
    )


@router.post("/exams/{exam_id}/visibility-events", response_model=VisibilityEventsResponse)
async def report_visibility_events(
    exam_id: uuid.UUID,
    payload: VisibilityEventsRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: ExamActor,
) -> VisibilityEventsResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)

    if payload.events and exam.max_switch_count >= 0:
        events_sorted = sorted(payload.events, key=lambda e: e.at_ms)
        hide_start: int | None = None
        increments = 0
        for event in events_sorted:
            if event.hidden and hide_start is None:
                hide_start = event.at_ms
            elif not event.hidden and hide_start is not None:
                duration_ms = event.at_ms - hide_start
                if duration_ms >= 3000:
                    increments += 1
                hide_start = None

        if increments > 0:
            exam_student.switch_count += increments
            await db.commit()

    return VisibilityEventsResponse(
        switch_count=exam_student.switch_count,
        max_switch_count=exam.max_switch_count,
    )


@router.post("/exams/{exam_id}/submit", response_model=SubmitExamResponse)
async def submit_exam(
    exam_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: ExamActor,
    request: Request,
    payload: SubmitExamRequest | None = None,
) -> SubmitExamResponse:
    exam, exam_student = await _get_exam_for_student(db, exam_id, user.id)
    state = exam_student.attempt_state
    if state in (ExamAttemptState.SUBMITTED.value, ExamAttemptState.GRADED.value):
        return SubmitExamResponse(
            submitted=True,
            score=exam_student.score,
            grading_status=exam_student.grading_status,
        )
    if state == ExamAttemptState.EXPIRED.value:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="Exam window closed")

    answers_map = dict(exam_student.saved_answers or {})
    for item in payload.answers if payload else []:
        answers_map[str(item.question_id)] = _carry_forward_fill_in_cache(
            incoming=deepcopy(item.answer_content),
            previous=answers_map.get(str(item.question_id)),
        )

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
        if not isinstance(answer_content, dict):
            answer_content = {}
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

        answers_map[str(question.id)] = deepcopy(answer_content)
        public_answer_content = _strip_internal_answer_metadata(answer_content)
        answer_rows.append(
            StudentExamAnswer(
                exam_id=exam.id,
                student_id=user.id,
                question_id=question.id,
                answer_content=public_answer_content,
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
                answer_content=deepcopy(public_answer_content),
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
    exam_student.saved_answers = answers_map
    exam_student.latest_submission_id = submission.id
    exam_student.submission_count = next_attempt_no
    exam_student.objective_score = round(objective_score, 2)
    exam_student.subjective_score = 0.0
    exam_student.score = round(objective_score, 2)
    if has_subjective:
        exam_student.grading_status = GradingStatus.PENDING_AI.value
        exam_student.attempt_state = ExamAttemptState.SUBMITTED.value
        exam_student.ai_scored_at = None
        exam_student.reviewed_at = None
        exam_student.graded_at = None
    else:
        exam_student.grading_status = GradingStatus.REVIEWED.value
        exam_student.attempt_state = ExamAttemptState.GRADED.value
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

    await log_event(
        db,
        event_category=CATEGORY_EXAM,
        event_type="exam_submit",
        user=user,
        target_type="exam",
        target_id=exam.id,
        metadata={
            "title": exam.title,
            "category": exam.category,
            "attempt_no": next_attempt_no,
            "score": exam_student.score,
        },
        request=request,
    )
    await db.commit()

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
            can_retake=_can_start_retake(exam, exam_student),
            show_score=exam.show_score,
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
    pending_question_ids = (
        await list_active_exam_submission_task_question_ids(
            db,
            exam_id=exam.id,
            student_id=user.id,
            submission_id=exam_student.latest_submission_id,
        )
        if is_pending_ai
        else set()
    )

    question_items: list[StudentExamResultQuestionResponse] = []
    for exam_question in sorted(exam.exam_questions, key=lambda item: item.order):
        question = exam_question.question
        answer = answers.get(question.id)
        appeal = appeals.get(question.id)
        answer_feedback = (answer.feedback or {}) if answer else {}
        grading_failed = bool(answer_feedback.get("grading_failed"))
        needs_human_review = bool(answer_feedback.get("needs_human_review"))
        grading_pending = (
            question.id in pending_question_ids
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
        can_retake=_can_start_retake(exam, exam_student),
        show_score=exam.show_score,
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
    rows = await load_student_wrong_answers(db, student_id=user.id, mastered=mastered)
    exams_by_id = await load_exams_by_ids(db, (row.effective_exam_id for row in rows))
    question_orders = await load_exam_question_orders(
        db,
        ((row.effective_exam_id, row.question.id) for row in rows),
    )
    practice_counts = await count_remedial_practices_by_source(db, student_id=user.id)

    items: list[WrongAnswerListItem] = []
    for row in rows:
        progress, question = row.progress, row.question
        if question_type and question.type.value != question_type:
            continue
        tag_names = [item.name for item in question.tags]
        if tag and tag not in tag_names:
            continue
        exam = exams_by_id.get(row.effective_exam_id) if row.effective_exam_id else None
        items.append(
            WrongAnswerListItem(
                id=progress.id,
                question_id=question.id,
                question_title=question.title,
                question_type=question.type.value,
                exam_id=exam.id if exam else None,
                exam_title=exam.title if exam else "历史考试",
                exam_category=exam.category if exam else "exam",
                wrong_count=progress.wrong_count,
                last_wrong_at=progress.last_wrong_at or progress.updated_at,
                mastered_at=progress.mastered_at,
                tags=tag_names,
                mastered=progress.mastered,
                remedial_practice_count=practice_counts.get(str(exam.id) if exam else "", 0),
                exam_question_order=(
                    question_orders.get((exam.id, question.id)) if exam else None
                ),
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
        select(StudentQuestionProgress, Question)
        .join(Question, Question.id == StudentQuestionProgress.question_id)
        .where(
            StudentQuestionProgress.id == progress_id,
            StudentQuestionProgress.student_id == user.id,
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wrong answer not found")

    progress, question = row
    # 与列表保持一致：把错题强化练习里的错题回溯到来源考试/练习。
    hidden_sources = await load_hidden_practice_sources(db, [progress.last_exam_id])
    effective_exam_id = resolve_effective_exam_id(progress.last_exam_id, hidden_sources)
    exams_by_id = await load_exams_by_ids(db, [effective_exam_id])
    exam = exams_by_id.get(effective_exam_id) if effective_exam_id else None
    question_orders = await load_exam_question_orders(db, [(effective_exam_id, question.id)])

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
        exam_id=exam.id if exam else None,
        exam_title=exam.title if exam else "历史考试",
        exam_category=exam.category if exam else "exam",
        wrong_count=progress.wrong_count,
        last_wrong_at=progress.last_wrong_at or progress.updated_at,
        tags=[item.name for item in question.tags],
        mastered=progress.mastered,
        question_content=question.content,
        question_options=question.options,
        standard_answer=question.answer,
        analysis=question.analysis,
        student_answer=latest_answer.answer_content if latest_answer else {},
        feedback=latest_answer.feedback if latest_answer else {},
        exam_question_order=(
            question_orders.get((exam.id, question.id)) if exam else None
        ),
    )


@wrong_answers_router.post("/{progress_id}/explain-selected/stream")
async def explain_selected_wrong_answer_text(
    progress_id: uuid.UUID,
    payload: SelectedTextExplainRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> StreamingResponse:
    result = await db.execute(
        select(StudentQuestionProgress, Question)
        .join(Question, Question.id == StudentQuestionProgress.question_id)
        .where(
            StudentQuestionProgress.id == progress_id,
            StudentQuestionProgress.student_id == user.id,
            StudentQuestionProgress.wrong_count > 0,
        )
    )
    row = result.one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wrong answer not found")

    _, question = row
    selected_text = payload.selected_text.strip()
    if not selected_text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="请先选择要解释的内容")
    return await _stream_selected_text_explanation(
        db, user, question, selected_text, include_solution=True
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


# ── 错题强化练习 ──

# 历史错题（来源考试已删除）在 URL 里用的分组键，与前端保持一致。
REMEDIAL_LEGACY_SOURCE_KEY = "legacy"


def _parse_remedial_source_key(source_key: str) -> uuid.UUID | None:
    if source_key == REMEDIAL_LEGACY_SOURCE_KEY:
        return None
    try:
        return uuid.UUID(source_key)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Wrong answer source not found",
        ) from exc


async def _require_remedial_source(
    db: AsyncSession,
    *,
    student_id: uuid.UUID,
    source_exam_id: uuid.UUID | None,
) -> Exam | None:
    """确认这个考试/练习确实是该学生错题的来源，返回对应的 Exam（历史错题返回 None）。"""
    if source_exam_id is None:
        has_wrong = (
            await db.execute(
                select(StudentQuestionProgress.id)
                .where(
                    StudentQuestionProgress.student_id == student_id,
                    StudentQuestionProgress.wrong_count > 0,
                    StudentQuestionProgress.last_exam_id.is_(None),
                )
                .limit(1)
            )
        ).scalar_one_or_none()
        if has_wrong is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Wrong answer source not found",
            )
        return None

    exam = (
        await db.execute(
            select(Exam).where(Exam.id == source_exam_id, Exam.deleted_at.is_(None))
        )
    ).scalars().unique().one_or_none()
    if exam is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wrong answer source not found")

    # 该来源下的错题可能来自原练习本身，也可能来自它派生的强化练习。
    derived_ids = (
        await db.execute(
            select(Exam.id).where(
                Exam.origin_exam_id == source_exam_id,
                Exam.hidden_from_list.is_(True),
                Exam.deleted_at.is_(None),
            )
        )
    ).scalars().all()
    has_wrong = (
        await db.execute(
            select(StudentQuestionProgress.id)
            .where(
                StudentQuestionProgress.student_id == student_id,
                StudentQuestionProgress.wrong_count > 0,
                StudentQuestionProgress.last_exam_id.in_([source_exam_id, *derived_ids]),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if has_wrong is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Wrong answer source not found")
    return exam


def _remedial_practice_summary_item(
    practice: Any,
) -> RemedialPracticeSummaryItem:
    return RemedialPracticeSummaryItem(
        id=practice.id,
        title=practice.title,
        question_count=practice.question_count,
        duration_minutes=practice.duration_minutes,
        created_at=practice.created_at,
        started_at=practice.started_at,
        submitted_at=practice.submitted_at,
        score=practice.score,
        total_score=practice.total_score,
    )


@wrong_answers_router.get(
    "/practice-analysis/{source_key}",
    response_model=RemedialPracticeAnalysisResponse,
)
async def get_remedial_practice_analysis(
    source_key: str,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> RemedialPracticeAnalysisResponse:
    """列出该考试/练习下可练习的知识点，以及已经生成过的强化练习。

    知识点只统计「未掌握」的错题——已掌握的没有强化必要。没有可练习的错题时
    返回空 groups（而不是 404），方便前端仍然展示已生成的强化练习列表。
    """
    source_exam_id = _parse_remedial_source_key(source_key)
    source_exam = await _require_remedial_source(
        db, student_id=user.id, source_exam_id=source_exam_id
    )
    groups = await collect_wrong_question_groups(
        db,
        student_id=user.id,
        source_exam_id=source_exam_id,
        mastered=False,
    )

    suggested = default_allocations(groups, REMEDIAL_DEFAULT_TOTAL)
    practices = await list_remedial_practices(
        db, student_id=user.id, source_exam_id=source_exam_id
    )
    return RemedialPracticeAnalysisResponse(
        source_exam_id=source_exam_id,
        source_title=source_exam.title if source_exam else "历史考试",
        source_category=source_exam.category if source_exam else "exam",
        wrong_question_count=sum(group.question_count for group in groups),
        default_total_count=REMEDIAL_DEFAULT_TOTAL,
        max_total_count=REMEDIAL_MAX_TOTAL,
        groups=[
            RemedialPracticeGroupItem(
                key=group.key,
                knowledge_point_id=group.knowledge_point_id,
                name=group.name,
                path=group.path,
                wrong_question_count=group.question_count,
                suggested_count=suggested.get(group.key, 0),
            )
            for group in groups
        ],
        practices=[_remedial_practice_summary_item(item) for item in practices],
    )


@wrong_answers_router.post(
    "/practice",
    response_model=RemedialPracticeCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_remedial_practice_endpoint(
    body: RemedialPracticeCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    user: CurrentUser,
) -> RemedialPracticeCreateResponse:
    """按知识点生成同知识点的强化练习，并直接返回可进入的练习 id。"""
    source_exam = await _require_remedial_source(
        db, student_id=user.id, source_exam_id=body.source_exam_id
    )
    groups = await collect_wrong_question_groups(
        db,
        student_id=user.id,
        source_exam_id=body.source_exam_id,
    )
    if not groups:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="该考试/练习下没有可练习的错题",
        )

    group_by_key = {group.key: group for group in groups}
    if body.allocations:
        allocations: dict[str, int] = {}
        unknown_keys = [
            item.group_key
            for item in body.allocations
            if item.group_key not in group_by_key
        ]
        if unknown_keys:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"知识点分组已变化，请刷新后重试（{', '.join(unknown_keys[:3])}）",
            )
        for item in body.allocations:
            if item.count > 0:
                allocations[item.group_key] = item.count
        if not allocations:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="请至少为一个知识点指定题目数",
            )
    else:
        allocations = default_allocations(groups, body.total_count)

    total_count = sum(allocations.values())
    if total_count > REMEDIAL_MAX_TOTAL:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"单次练习最多生成 {REMEDIAL_MAX_TOTAL} 道题",
        )

    try:
        model = AIModelProvider(body.model)
    except ValueError:
        model = AIModelProvider.DEEPSEEK

    try:
        result = await create_remedial_practice(
            db,
            student=user,
            source_exam=source_exam,
            groups=groups,
            allocations=allocations,
            difficulty=body.difficulty,
            model=model,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    await log_event(
        db,
        event_category=CATEGORY_EXAM,
        event_type="remedial_practice_create",
        user=user,
        target_type="exam",
        target_id=result.exam_id,
        metadata={
            "title": result.title,
            "source_exam_id": str(body.source_exam_id) if body.source_exam_id else None,
            "question_count": result.question_count,
        },
    )
    await db.commit()

    return RemedialPracticeCreateResponse(
        exam_id=result.exam_id,
        title=result.title,
        question_count=result.question_count,
        requested_count=result.requested_count,
        duration_minutes=result.duration_minutes,
        total_score=result.total_score,
    )
