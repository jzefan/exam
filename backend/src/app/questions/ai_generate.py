"""AI question generation via SSE streaming."""

import enum
import json
import logging
import uuid
from datetime import datetime, timezone
from collections.abc import AsyncIterator
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import CurrentUser
from app.config import settings
from app.database import get_db
from app.learning.models import KnowledgePoint
from app.questions.models import UserKnowledgePointUsage

logger = logging.getLogger(__name__)

ai_generate_router = APIRouter()


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
    prompt: str = Field(default="", max_length=2000)
    model: AIModelProvider = AIModelProvider.QWEN


class FrequentKnowledgePointItem(BaseModel):
    id: uuid.UUID
    name: str
    path: str
    use_count: int
    last_used_at: datetime


class FrequentKnowledgePointResponse(BaseModel):
    recent: list[FrequentKnowledgePointItem]
    frequent: list[FrequentKnowledgePointItem]


DIFFICULTY_LABELS = {1: "容易", 2: "较易", 3: "中等", 4: "较难", 5: "很难"}


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


def _get_model_config(model: AIModelProvider) -> tuple[str, str, str]:
    """Return (api_key, base_url, model_name) for the selected provider."""
    if model == AIModelProvider.QWEN:
        return (settings.qwen_api_key or "", settings.qwen_base_url, settings.qwen_model_name)
    elif model == AIModelProvider.DEEPSEEK:
        return (settings.deepseek_api_key or "", settings.deepseek_base_url, settings.deepseek_model_name)
    elif model == AIModelProvider.CLAUDE:
        return (settings.openrouter_api_key or "", settings.openrouter_base_url, settings.openrouter_model_name)
    return (settings.qwen_api_key or "", settings.qwen_base_url, settings.qwen_model_name)


def _build_system_prompt(
    request: AIGenerateRequest,
    knowledge_point_names: list[str],
) -> str:
    difficulty_label = DIFFICULTY_LABELS.get(request.difficulty, "中等")

    type_instruction = ""
    if request.type_distribution:
        parts = [f"{qtype} {count}题" for qtype, count in request.type_distribution.items()]
        type_instruction = f"题型分布要求：{', '.join(parts)}。"
    else:
        type_instruction = f"共生成 {request.total_count} 道题目，题型自行合理分配。"

    kp_instruction = ""
    all_kp = list(knowledge_point_names)
    if request.knowledge_keywords.strip():
        all_kp.extend(k.strip() for k in request.knowledge_keywords.split(",") if k.strip())
    if all_kp:
        kp_instruction = f"涉及的知识点：{', '.join(all_kp)}。"

    user_extra = ""
    if request.prompt.strip():
        user_extra = f"额外要求：{request.prompt.strip()}"

    return f"""你是一位专业的考试命题教师。请根据以下要求生成考试题目。

要求：
- 难度级别：{difficulty_label}（{request.difficulty}/5）
- {type_instruction}
- {kp_instruction}
- {user_extra}

支持的题型代码：choice（选择题）、true_false（判断题）、fill_in（填空题）、short_answer（简答题）、essay（论述题）、code（编程题）

输出格式要求：
- 每道题目输出为一个独立的 JSON 对象，题目之间用换行分隔
- 不要输出 JSON 数组，不要添加 ```json 等标记
- 支持 LaTeX 公式：行内公式用 $...$，块级公式用 $$...$$
- 所有内容使用中文

每道题目的 JSON 格式：
{{
  "type": "题型代码",
  "title": "简短题目标题",
  "content": {{"text": "完整题目内容"}},
  "options": {{"A": "选项A", "B": "选项B", "C": "选项C", "D": "选项D"}} 或 null,
  "answer": {{"correct": "A"}} 或 {{"text": "答案文本"}},
  "analysis": "详细解析",
  "difficulty": {request.difficulty}
}}

说明：
- 选择题(choice)的 answer 使用 {{"correct": "A"}} 格式，options 为选项字典
- 判断题(true_false)的 answer 使用 {{"correct": "true"}} 或 {{"correct": "false"}}，options 设为 null
- 其他题型的 answer 使用 {{"text": "答案内容"}} 格式，options 设为 null

请现在开始生成题目。"""


async def generate_questions_stream(
    db: AsyncSession,
    request: AIGenerateRequest,
    user_id: uuid.UUID,
) -> AsyncIterator[dict[str, Any]]:
    """Stream AI-generated questions as parsed JSON events."""
    _validate_generate_request(request)

    # Fetch knowledge point names if provided
    knowledge_point_names: list[str] = []
    if request.knowledge_point_ids:
        result = await db.execute(
            select(KnowledgePoint.name).where(
                KnowledgePoint.id.in_(request.knowledge_point_ids)
            )
        )
        knowledge_point_names = list(result.scalars().all())
        try:
            await record_user_knowledge_point_usage(db, user_id, request.knowledge_point_ids)
        except Exception as exc:
            if _is_missing_usage_table_error(exc):
                logger.warning("skip usage tracking during generation because usage table is missing")
            else:
                raise

    system_prompt = _build_system_prompt(request, knowledge_point_names)

    api_key, base_url, model_name = _get_model_config(request.model)
    if not api_key:
        yield {"type": "error", "message": f"{request.model.value} API key is not configured"}
        return

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "请开始生成题目。"},
        ],
        "temperature": 0.8,
        "stream": True,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    question_count = 0
    accumulated = ""
    brace_depth = 0
    in_string = False
    escape_next = False

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            async with client.stream(
                "POST",
                f"{base_url}/chat/completions",
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
                    delta = choices[0].get("delta") if isinstance(choices[0], dict) else None
                    content = delta.get("content") if isinstance(delta, dict) else None
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
                                # Complete JSON object
                                try:
                                    parsed_question = json.loads(accumulated)
                                    if question_count >= request.total_count:
                                        accumulated = ""
                                        in_string = False
                                        continue
                                    question_count += 1
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

        if question_count != request.total_count:
            yield {
                "type": "error",
                "message": f"生成题目数量不足，期望 {request.total_count} 道，实际 {question_count} 道，请重试",
            }
            return

        yield {"type": "done", "total": question_count}
    except httpx.HTTPStatusError as e:
        logger.error("DeepSeek API HTTP error: %s", e)
        yield {"type": "error", "message": f"AI service error: {e.response.status_code}"}
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
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Stream AI-generated questions via SSE."""
    _validate_generate_request(request)

    async def event_stream() -> AsyncIterator[str]:
        async for event in generate_questions_stream(db, request, user.id):
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
