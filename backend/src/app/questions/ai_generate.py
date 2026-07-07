"""AI question generation via SSE streaming."""

import enum
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from app.activity_logs.service import CATEGORY_QUESTION, log_event
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.config import settings
from app.database import get_db
from app.learning.models import KnowledgePoint
from app.auth.user_settings import get_user_ai_config
from app.questions.models import UserKnowledgePointUsage
from app.questions.ai_generate_prompt import (
    KnowledgePointPromptContext,
    build_ai_generate_system_prompt as _build_system_prompt,
    load_knowledge_point_prompt_contexts,
)
from app.questions.similarity import question_is_too_similar_to_any

logger = logging.getLogger(__name__)

ai_generate_router = APIRouter()

_LEGACY_QWEN_DEFAULT_MODELS = {"qwen-3.6"}
_MATERIAL_SOURCE_PREFIX_RE = re.compile(
    r"^\s*"
    r"(?:"
    r"(?:依据|根据|结合|参考)?\s*(?:教材|资料|学习资料|课件|讲义|文档)\s*"
    r"(?:第\s*)?"
    r"(?:[0-9０-９]+|[一二三四五六七八九十百千万]+)"
    r"(?:\s*[-－—~～至到]\s*(?:[0-9０-９]+|[一二三四五六七八九十百千万]+))?"
    r"\s*(?:页|章|节|部分)?"
    r"(?:\s*(?:【[^】]{1,40}】|\[[^\]]{1,40}\]|（[^）]{1,40}）|\([^)）]{1,40}\)))*"
    r"|"
    r"(?:依据|根据|结合|参考)\s*(?:教材|资料|学习资料|课件|讲义|文档)"
    r")"
    r"\s*(?:[，,、:：。.\-－—]\s*)?"
)


class AIModelProvider(str, enum.Enum):
    QWEN = "qwen"
    DEEPSEEK = "deepseek"
    CLAUDE = "claude"


class AIGenerateRequest(BaseModel):
    total_count: int = Field(default=10, ge=1, le=50)
    difficulty: int = Field(default=3, ge=1, le=5)
    type_distribution: dict[str, int] = Field(default_factory=dict)
    knowledge_point_ids: list[uuid.UUID] = Field(default_factory=list)
    knowledge_keywords: str = Field(default="", max_length=500)
    course_name: str = Field(default="", max_length=200)
    exam_title: str = Field(default="", max_length=300)
    prompt: str = Field(default="", max_length=2000)
    # 学习资料原文（PDF/Word/Markdown 等抽取后的纯文本）。
    # 与 prompt 分开，避免短指令字段被长正文淹没/截断。
    material_text: str = Field(default="", max_length=200000)
    # 学习资料图片（PDF 整页渲染、docx/pptx 嵌入图），data URL 形式。
    # 非空时切换到多模态模型；与前端资料抽取页数上限保持一致。
    material_images: list[str] = Field(default_factory=list, max_length=1000)
    model: AIModelProvider = AIModelProvider.DEEPSEEK


class FrequentKnowledgePointItem(BaseModel):
    id: uuid.UUID
    name: str
    path: str
    use_count: int
    last_used_at: datetime


class FrequentKnowledgePointResponse(BaseModel):
    recent: list[FrequentKnowledgePointItem]
    frequent: list[FrequentKnowledgePointItem]


def _is_missing_usage_table_error(exc: Exception) -> bool:
    return 'user_knowledge_point_usage' in str(exc) and "does not exist" in str(exc)


def _validate_generate_request(request: AIGenerateRequest) -> None:
    if request.type_distribution:
        total_allocated = sum(request.type_distribution.values())
        if total_allocated != request.total_count:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="题型数量之和必须与题目总数一致",
            )


async def record_user_knowledge_point_usage(
    db: AsyncSession,
    user_id: uuid.UUID,
    knowledge_point_ids: list[uuid.UUID],
) -> None:
    if not knowledge_point_ids:
        return
    try:
        now = datetime.now(timezone.utc)
        unique_ids = list(dict.fromkeys(knowledge_point_ids))
        existing_rows = (
            await db.execute(
                select(UserKnowledgePointUsage).where(
                    UserKnowledgePointUsage.user_id == user_id,
                    UserKnowledgePointUsage.knowledge_point_id.in_(unique_ids),
                )
            )
        ).scalars().all()
        existing_map = {row.knowledge_point_id: row for row in existing_rows}

        for knowledge_point_id in unique_ids:
            existing = existing_map.get(knowledge_point_id)
            if existing:
                existing.use_count += 1
                existing.updated_at = now
            else:
                db.add(
                    UserKnowledgePointUsage(
                        user_id=user_id,
                        knowledge_point_id=knowledge_point_id,
                        use_count=1,
                    )
                )
        await db.flush()
    except Exception as exc:
        if _is_missing_usage_table_error(exc):
            logger.warning("user_knowledge_point_usage table missing; skip usage tracking")
            await db.rollback()
            return
        raise


async def list_user_frequent_knowledge_points(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    limit: int = 8,
) -> FrequentKnowledgePointResponse:
    try:
        stmt = (
            select(UserKnowledgePointUsage, KnowledgePoint)
            .join(KnowledgePoint, KnowledgePoint.id == UserKnowledgePointUsage.knowledge_point_id)
            .where(
                UserKnowledgePointUsage.user_id == user_id,
                KnowledgePoint.deleted_at.is_(None),
            )
        )
        rows = (await db.execute(stmt)).all()
    except Exception as exc:
        if _is_missing_usage_table_error(exc):
            logger.warning("user_knowledge_point_usage table missing; return empty frequent knowledge points")
            await db.rollback()
            return FrequentKnowledgePointResponse(recent=[], frequent=[])
        raise

    def to_item(row: tuple[UserKnowledgePointUsage, KnowledgePoint]) -> FrequentKnowledgePointItem:
        usage, kp = row
        return FrequentKnowledgePointItem(
            id=kp.id,
            name=kp.name,
            path=kp.name,
            use_count=usage.use_count,
            last_used_at=usage.updated_at,
        )

    recent = [
        to_item(row)
        for row in sorted(rows, key=lambda pair: pair[0].updated_at, reverse=True)[:limit]
    ]
    frequent = [
        to_item(row)
        for row in sorted(rows, key=lambda pair: (pair[0].use_count, pair[0].updated_at), reverse=True)[:limit]
    ]
    return FrequentKnowledgePointResponse(recent=recent, frequent=frequent)


def _get_system_model_config(model: AIModelProvider) -> tuple[str, str, str]:
    """Return (api_key, base_url, model_name) for the selected provider from system config."""
    if model == AIModelProvider.QWEN:
        return (settings.qwen_api_key or "", settings.qwen_base_url, settings.qwen_model_name)
    elif model == AIModelProvider.DEEPSEEK:
        return (settings.deepseek_api_key or "", settings.deepseek_base_url, settings.deepseek_model_name)
    elif model == AIModelProvider.CLAUDE:
        return (settings.openrouter_api_key or "", settings.openrouter_base_url, settings.openrouter_model_name)
    return (settings.qwen_api_key or "", settings.qwen_base_url, settings.qwen_model_name)


async def _get_model_config(
    db: AsyncSession,
    user_id: uuid.UUID,
    model: AIModelProvider,
) -> tuple[str, str, str, str]:
    """Return (provider, api_key, base_url, model_name)."""
    try:
        provider, api_key, model_name, base_url = await get_user_ai_config(
            db,
            user_id,
            preferred_provider=model.value,
        )
        if provider and api_key and base_url and model_name:
            return provider, api_key, base_url, model_name
    except Exception:
        logger.warning("Failed to load user AI settings, using system defaults")
    api_key, base_url, model_name = _get_system_model_config(model)
    return model.value, api_key, base_url, model_name


def _chat_completions_url(base_url: str) -> str:
    """Normalize either a provider base URL or a full chat-completions endpoint."""
    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    return f"{normalized}/chat/completions"


def _ai_service_error_message(provider_name: str, model_name: str, status_code: int) -> str:
    if status_code == 404:
        provider_label = "千问" if provider_name == AIModelProvider.QWEN.value else provider_name
        return f"{provider_label} 模型或接口地址不存在（当前模型：{model_name}），请检查模型配置后重试"
    return f"AI 服务请求失败（状态码：{status_code}）"


def _request_model_name(provider_name: str, model_name: str, *, use_vision: bool) -> str:
    if provider_name == AIModelProvider.QWEN.value:
        if use_vision:
            return settings.qwen_vl_model_name
        if model_name in _LEGACY_QWEN_DEFAULT_MODELS:
            return settings.qwen_model_name
    return model_name


def _strip_material_source_prefix(text: str) -> str:
    cleaned = text
    for _ in range(2):
        next_cleaned = _MATERIAL_SOURCE_PREFIX_RE.sub("", cleaned, count=1).lstrip()
        if next_cleaned == cleaned:
            break
        cleaned = next_cleaned
    return cleaned or text


def _sanitize_generated_question(question: dict[str, Any]) -> dict[str, Any]:
    title = question.get("title")
    if isinstance(title, str):
        question["title"] = _strip_material_source_prefix(title)

    content = question.get("content")
    if isinstance(content, dict):
        content_text = content.get("text")
        if isinstance(content_text, str):
            content["text"] = _strip_material_source_prefix(content_text)

    return question


def _expected_question_types(type_distribution: dict[str, int]) -> list[str]:
    expected: list[str] = []
    for qtype, count in type_distribution.items():
        if count > 0:
            expected.extend([qtype] * count)
    return expected


def _backend_question_type(qtype: str | None) -> str | None:
    if qtype in {"single_choice", "multi_choice"}:
        return "choice"
    return qtype


def _split_choice_answer_keys(value: str) -> list[str]:
    return [part.strip() for part in re.split(r"[,，;；、\s]+", value) if part.strip()]


def _normalize_generated_choice_variant(
    question: dict[str, Any],
    *,
    expected_type: str | None,
) -> dict[str, Any]:
    if question.get("type") != "choice":
        return question
    answer = question.get("answer")
    if not isinstance(answer, dict):
        answer = {}
    correct = answer.get("correct")
    if expected_type == "multi_choice":
        if isinstance(correct, list):
            normalized_correct = correct
        elif isinstance(correct, str):
            parts = _split_choice_answer_keys(correct)
            normalized_correct = parts if parts else [correct]
        elif correct is None:
            normalized_correct = []
        else:
            normalized_correct = [correct]
        answer = {**answer, "correct": normalized_correct}
        content = question.get("content") if isinstance(question.get("content"), dict) else {}
        question["content"] = {**content, "multi": True}
        question["answer"] = answer
        return question
    if expected_type == "single_choice":
        if isinstance(correct, list):
            answer = {**answer, "correct": next((item for item in correct if item), "")}
        content = question.get("content") if isinstance(question.get("content"), dict) else {}
        question["content"] = {**content, "multi": False}
        question["answer"] = answer
        return question
    content = question.get("content") if isinstance(question.get("content"), dict) else {}
    question["content"] = {**content, "multi": isinstance(correct, list)}
    question["answer"] = answer
    return question


def _answer_text(answer: Any) -> str:
    if not isinstance(answer, dict):
        return ""
    raw_answer = answer.get("text") or answer.get("correct")
    return str(raw_answer).strip() if raw_answer is not None else ""


def _validate_generated_question_shape(
    question: dict[str, Any],
    *,
    expected_type: str | None,
) -> str | None:
    actual_type = question.get("type")
    expected_backend_type = _backend_question_type(expected_type)
    if expected_backend_type is not None and actual_type != expected_backend_type:
        return f"AI 返回题型不符合要求：期望 {expected_backend_type}，实际 {actual_type or '空'}"
    if actual_type == "code":
        if question.get("options") not in (None, {}):
            return "AI 返回的代码题不能包含选择题选项"
        if not _answer_text(question.get("answer")):
            return "AI 返回的代码题缺少参考答案"
    return None


def _extract_generated_questions(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        questions = payload.get("questions")
        if isinstance(questions, list):
            return [
                _sanitize_generated_question(question)
                for question in questions
                if isinstance(question, dict)
            ]
        return [_sanitize_generated_question(payload)]

    if isinstance(payload, list):
        return [
            _sanitize_generated_question(question)
            for question in payload
            if isinstance(question, dict)
        ]

    return []


def _build_generation_user_content(
    *,
    use_vision: bool,
    material_images: list[str],
    skipped_images: bool,
    attempt_index: int,
    generated_count: int,
    remaining_count: int,
    generated_titles: list[str],
) -> Any:
    if attempt_index == 0:
        text = "请开始生成题目。"
    else:
        recent_titles = "、".join(generated_titles[-12:])
        duplicate_instruction = f"已生成题目标题：{recent_titles}。" if recent_titles else ""
        text = (
            f"前面已成功收到 {generated_count} 道题，还差 {remaining_count} 道。"
            f"请继续生成剩余 {remaining_count} 道，只输出新增题目的 JSON，不要重复或改写已生成题目，"
            "也不要生成题干、选项、答案或考查点基本相同的近似题。"
            f"{duplicate_instruction}"
        )

    if use_vision:
        content: list[dict[str, Any]] = [
            {"type": "text", "text": f"{text} 以下为学习资料的整页/嵌入图片，请结合图中信息出题。"},
        ]
        for image_url in material_images:
            content.append({"type": "image_url", "image_url": {"url": image_url}})
        return content

    if skipped_images:
        return f"{text} 注意：当前模型不支持图片理解，本次仅依据可用文本资料生成题目。"

    return text


def _extract_stream_delta_text(choice: Any) -> str | None:
    if not isinstance(choice, dict):
        return None
    delta = choice.get("delta")
    if not isinstance(delta, dict):
        return None

    content = delta.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        text = content.get("text")
        return text if isinstance(text, str) and text else None
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            text = item.get("text")
            if item_type in {None, "text"} and isinstance(text, str) and text:
                parts.append(text)
        return "\n".join(parts) if parts else None
    return None


async def generate_questions_stream(
    db: AsyncSession,
    request: AIGenerateRequest,
    user_id: uuid.UUID,
) -> AsyncIterator[dict[str, Any]]:
    """Stream AI-generated questions as parsed JSON events."""
    _validate_generate_request(request)

    knowledge_contexts: list[KnowledgePointPromptContext] = []
    if request.knowledge_point_ids:
        knowledge_contexts = await load_knowledge_point_prompt_contexts(db, request.knowledge_point_ids)
        try:
            await record_user_knowledge_point_usage(db, user_id, request.knowledge_point_ids)
        except Exception as exc:
            if _is_missing_usage_table_error(exc):
                logger.warning("skip usage tracking during generation because usage table is missing")
            else:
                raise

    system_prompt = _build_system_prompt(
        total_count=request.total_count,
        difficulty=request.difficulty,
        type_distribution=request.type_distribution,
        knowledge_keywords=request.knowledge_keywords,
        course_name=request.course_name,
        exam_title=request.exam_title,
        user_prompt=request.prompt,
        material_text=request.material_text,
        knowledge_contexts=knowledge_contexts,
    )

    provider_name, api_key, base_url, model_name = await _get_model_config(db, user_id, request.model)
    if not api_key:
        yield {"type": "error", "message": f"{provider_name} API key is not configured"}
        return

    # 多模态分支：仅在有图片且 provider 为 Qwen 时启用，强制切到 qwen-vl 模型。
    use_vision = bool(request.material_images) and request.model == AIModelProvider.QWEN
    skipped_images = bool(request.material_images) and request.model != AIModelProvider.QWEN
    if skipped_images:
        logger.info(
            "Skipping %d material images: provider %s does not support vision in this build",
            len(request.material_images),
            request.model.value,
        )

    model_name = _request_model_name(provider_name, model_name, use_vision=use_vision)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    question_count = 0
    generated_titles: list[str] = []
    accepted_questions: list[dict[str, Any]] = []
    expected_types = _expected_question_types(request.type_distribution)

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            max_attempts = max(1, request.total_count)
            for attempt_index in range(max_attempts):
                if question_count >= request.total_count:
                    break

                attempt_start_count = question_count
                remaining_count = request.total_count - question_count
                user_content = _build_generation_user_content(
                    use_vision=use_vision,
                    material_images=request.material_images,
                    skipped_images=skipped_images,
                    attempt_index=attempt_index,
                    generated_count=question_count,
                    remaining_count=remaining_count,
                    generated_titles=generated_titles,
                )
                payload = {
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    "temperature": 0.8,
                    "stream": True,
                }

                accumulated = ""
                brace_depth = 0
                in_string = False
                escape_next = False

                async with client.stream(
                    "POST",
                    _chat_completions_url(base_url),
                    json=payload,
                    headers=headers,
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line.removeprefix("data:").strip()
                        if not data or data == "[DONE]":
                            continue
                        try:
                            parsed = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        choices = parsed.get("choices")
                        if not isinstance(choices, list) or not choices:
                            continue
                        content = _extract_stream_delta_text(choices[0])
                        if not isinstance(content, str) or not content:
                            continue

                        # Accumulate and track JSON object boundaries
                        for ch in content:
                            if escape_next:
                                escape_next = False
                                if brace_depth > 0:
                                    accumulated += ch
                                continue

                            if ch == "\\" and in_string:
                                escape_next = True
                                if brace_depth > 0:
                                    accumulated += ch
                                continue

                            if ch == '"' and brace_depth > 0:
                                in_string = not in_string
                                accumulated += ch
                                continue

                            if in_string:
                                if brace_depth > 0:
                                    accumulated += ch
                                continue

                            if ch == "{":
                                brace_depth += 1
                                accumulated += ch
                            elif ch == "}" and brace_depth > 0:
                                accumulated += ch
                                brace_depth -= 1
                                if brace_depth == 0:
                                    # Complete JSON object or an envelope that contains multiple questions.
                                    try:
                                        parsed_payload = json.loads(accumulated)
                                        for parsed_question in _extract_generated_questions(parsed_payload):
                                            if question_count >= request.total_count:
                                                break
                                            expected_type = (
                                                expected_types[question_count]
                                                if question_count < len(expected_types)
                                                else None
                                            )
                                            parsed_question = _normalize_generated_choice_variant(
                                                parsed_question,
                                                expected_type=expected_type,
                                            )
                                            shape_error = _validate_generated_question_shape(
                                                parsed_question,
                                                expected_type=expected_type,
                                            )
                                            if shape_error:
                                                logger.warning(
                                                    "Reject generated question shape: %s payload=%s",
                                                    shape_error,
                                                    parsed_question,
                                                )
                                                continue
                                            if question_is_too_similar_to_any(parsed_question, accepted_questions):
                                                logger.warning(
                                                    "Reject near-duplicate generated question: payload=%s",
                                                    parsed_question,
                                                )
                                                continue
                                            question_count += 1
                                            accepted_questions.append(parsed_question)
                                            title = parsed_question.get("title")
                                            if isinstance(title, str) and title.strip():
                                                generated_titles.append(title.strip())
                                            yield {
                                                "type": "question",
                                                "index": question_count,
                                                "data": parsed_question,
                                            }
                                    except json.JSONDecodeError:
                                        logger.warning(
                                            "Failed to parse question JSON: %s",
                                            accumulated[:200],
                                        )
                                    accumulated = ""
                                    in_string = False
                            elif brace_depth > 0:
                                accumulated += ch

                if question_count == attempt_start_count:
                    break

        if question_count != request.total_count:
            yield {
                "type": "error",
                "message": f"生成题目数量不足，期望 {request.total_count} 道，实际 {question_count} 道，请重试",
            }
            return

        yield {"type": "done", "total": question_count}
    except httpx.HTTPStatusError as e:
        logger.error(
            "AI provider HTTP error: provider=%s model=%s status=%s",
            provider_name,
            model_name,
            e.response.status_code,
        )
        yield {
            "type": "error",
            "message": _ai_service_error_message(provider_name, model_name, e.response.status_code),
        }
    except Exception as e:
        logger.error("AI question generation error: %s", e)
        yield {"type": "error", "message": str(e)}


@ai_generate_router.get("/frequent-knowledge-points", response_model=FrequentKnowledgePointResponse)
async def frequent_knowledge_points_endpoint(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
) -> FrequentKnowledgePointResponse:
    return await list_user_frequent_knowledge_points(db, user.id)


@ai_generate_router.post("/stream")
async def ai_generate_stream_endpoint(
    request: AIGenerateRequest,
    user: CurrentUser,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Stream AI-generated questions via SSE."""
    _validate_generate_request(request)

    await log_event(
        db,
        event_category=CATEGORY_QUESTION,
        event_type="question_ai_generate",
        user=user,
        metadata={
            "model": request.model.value if hasattr(request.model, "value") else str(request.model),
            "total_count": request.total_count,
            "difficulty": request.difficulty,
            "type_distribution": request.type_distribution,
            "knowledge_point_ids": [str(k) for k in request.knowledge_point_ids],
            "has_material": bool(request.material_text or request.material_images),
        },
        request=http_request,
    )
    await db.commit()

    async def event_stream() -> AsyncIterator[str]:
        async for event in generate_questions_stream(db, request, user.id):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
