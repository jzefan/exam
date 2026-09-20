"""大模型侧的两项能力：把网页正文结构化，或在没有网页正文时还原目录。

复用项目既有约定：`settings` 里的 OpenAI 兼容端点 + `httpx` 直连
`/chat/completions`，低温度、只输出 JSON。按 DeepSeek → Qwen 顺序降级。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 90.0
MAX_SOURCE_TEXT_CHARS = 12000
# 截断抢救时最多回退尝试的 `]` 个数，避免在超长输出上做无谓的反复 json 解析。
_MAX_SALVAGE_ATTEMPTS = 300
_PROVIDER_ORDER = ("deepseek", "qwen")


@dataclass(slots=True)
class BookRef:
    """定位一本书所需的最小信息。"""

    title: str
    edition: str = ""
    author: str = ""
    publisher: str = ""

    def describe(self) -> str:
        parts = [self.title]
        if self.edition:
            parts.append(self.edition)
        if self.author:
            parts.append(f"作者：{self.author}")
        if self.publisher:
            parts.append(f"出版社：{self.publisher}")
        return "；".join(parts)


_STRUCTURE_SYSTEM = "你是图书目录结构化助手，只输出合法 JSON。"

_STRUCTURE_PROMPT = """下面是《{book}》的网页正文（可能来自出版社官网的图书详情页）。

请从这段正文中**逐字抽取**该书目录，还原层级关系（章、节、小节）。

要求：
1. 只输出合法 JSON，不要任何解释、不要 Markdown 代码块。
2. JSON 格式：{{"paths": [["第一章 xxx", "1.1 xxx"], ["第一章 xxx", "1.2 xxx"]]}}。
3. 每个 path 是一条从最顶层到某个叶子节点的完整层级数组。
4. 去除页码、前后空白与多余的装饰符号，保留正文里的书名号、顿号。
5. 只提取章、节及带编号的正文条目；跳过前言、序、参考文献、学习目标、小结、实训及其下属条目。
6. **不得编造正文中不存在的内容。** 如果这段正文里没有目录，返回 {{"paths": []}}。

—— 正文开始 ——
{text}
—— 正文结束 ——"""

_GENERATE_SYSTEM = "你是教材目录助手，只输出合法 JSON。"

_GENERATE_PROMPT = """请给出《{book}》这本书的完整目录。

要求：
1. 只输出合法 JSON，不要任何解释、不要 Markdown 代码块。
2. JSON 格式：{{"paths": [["第一章 xxx", "1.1 xxx"], ["第一章 xxx", "1.2 xxx"]]}}。
3. 每个 path 是一条从最顶层到某个叶子节点的完整层级数组；同一章下的每一节都要单独成一条 path。
4. **必须输出全书完整目录**：从第一章一直排到最后一章，每一章的小节都要列全，
   不要只给第一章就停下，也不要在中途省略后续章节。
5. 层级只到「章 → 节」两层，不要编造三级以下的细节。
6. 章名与节名按这本书的通行写法给出；某一章的小节记不确切时，至少保留该章章名，不要整章漏掉。
7. 跳过前言、序、附录、参考文献、索引这类非正文章节。"""


def _provider_config(provider: str) -> tuple[str | None, str, str]:
    if provider == "deepseek":
        return settings.deepseek_api_key, settings.deepseek_base_url, settings.deepseek_model_name
    if provider == "qwen":
        return settings.qwen_api_key, settings.qwen_base_url, settings.qwen_model_name
    raise ValueError(f"未知的模型提供商：{provider}")


def _strip_code_fence(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    return cleaned.strip()


def _normalize_paths(raw_paths: object) -> list[list[str]]:
    """把 `paths` 字段归一为干净路径数组：丢掉空段、非数组项与重复路径。"""

    if not isinstance(raw_paths, list):
        return []

    normalized: list[list[str]] = []
    seen: set[str] = set()
    for item in raw_paths:
        if not isinstance(item, list):
            continue
        cleaned = [str(seg).strip() for seg in item if str(seg).strip()]
        if not cleaned:
            continue
        key = " > ".join(cleaned)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(cleaned)
    return normalized


def _salvage_truncated_payload(text: str) -> list[list[str]]:
    """抢救被 max_tokens 截断的输出：砍到最后一个完整的 path 元素，再补上闭合括号。

    完整目录动辄六七十条，容易顶到输出上限。若因为尾部不完整就整体判成「没有目录」，
    用户拿到的会是空结果 —— 比拿到前几章更糟，所以这里尽量保住已经生成的部分。
    """

    start = text.find("{")
    if start < 0:
        return []
    body = text[start:]

    attempts = 0
    for index in range(len(body) - 1, -1, -1):
        if body[index] != "]":
            continue
        attempts += 1
        if attempts > _MAX_SALVAGE_ATTEMPTS:
            break
        try:
            payload = json.loads(body[: index + 1] + "]}")
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return _normalize_paths(payload.get("paths"))
    return []


def parse_paths_payload(raw: str) -> list[list[str]]:
    """把模型返回的 JSON 文本归一为 `paths`。格式不对或为空时返回空列表。"""

    text = _strip_code_fence(raw)
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return _salvage_truncated_payload(text)
    if not isinstance(payload, dict):
        return []
    return _normalize_paths(payload.get("paths"))


async def _call_model(system: str, user: str, *, max_tokens: int = 4096) -> str | None:
    """按 DeepSeek → Qwen 顺序调用，全部失败返回 None。"""

    last_error: str | None = None
    for provider in _PROVIDER_ORDER:
        api_key, base_url, model_name = _provider_config(provider)
        if not api_key:
            continue
        try:
            async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
                response = await client.post(
                    f"{base_url.rstrip('/')}/chat/completions",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "model": model_name,
                        "messages": [
                            {"role": "system", "content": system},
                            {"role": "user", "content": user},
                        ],
                        "temperature": 0.1,
                        "max_tokens": max_tokens,
                    },
                )
        except httpx.HTTPError as exc:
            last_error = f"{provider}: {exc}"
            continue

        if response.status_code >= 400:
            last_error = f"{provider}: HTTP {response.status_code} {response.text[:120]}"
            continue

        content = (
            response.json().get("choices", [{}])[0].get("message", {}).get("content", "")
        )
        if isinstance(content, str) and content.strip():
            return content
        last_error = f"{provider}: 空响应"

    logger.warning("目录大模型调用失败：%s", last_error)
    return None


async def structure_catalog_from_text(book: BookRef, text: str) -> list[list[str]]:
    """把出版社官网的网页正文交给大模型，抽取目录。无目录时返回空列表。"""

    source = text.strip()
    if not source:
        return []
    if len(source) > MAX_SOURCE_TEXT_CHARS:
        source = source[:MAX_SOURCE_TEXT_CHARS]

    raw = await _call_model(
        _STRUCTURE_SYSTEM, _STRUCTURE_PROMPT.format(book=book.describe(), text=source)
    )
    if raw is None:
        return []
    return parse_paths_payload(raw)


async def generate_catalog_from_knowledge(book: BookRef) -> list[list[str]]:
    """没有可用的网页正文时，由模型依据书名/版本还原目录。"""

    # 完整目录（含每章小节）经常超过 4000 token，输出上限给满以免中途截断。
    raw = await _call_model(_GENERATE_SYSTEM, _GENERATE_PROMPT.format(book=book.describe()), max_tokens=8192)
    if raw is None:
        return []
    return parse_paths_payload(raw)


__all__ = [
    "BookRef",
    "generate_catalog_from_knowledge",
    "parse_paths_payload",
    "structure_catalog_from_text",
]
