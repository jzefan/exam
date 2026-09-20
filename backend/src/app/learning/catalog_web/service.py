"""「获取目录」编排层：检索候选 → 出版社官网 → 大模型兜底。

返回值始终带 `source` 标注，前端据此明确提示用户该目录是抓来的还是模型推断的，
并强制人工审核后再导入课程目录。
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

import httpx

from app.config import settings
from app.learning.catalog_web import dangdang, llm_toc
from app.learning.catalog_web import publisher as publisher_sites

logger = logging.getLogger(__name__)

SOURCE_PUBLISHER_SITE = "publisher_site"
SOURCE_LLM = "llm"

COVER_TIMEOUT_SECONDS = 90.0


@dataclass(slots=True)
class CatalogFetchResult:
    paths: list[list[str]] = field(default_factory=list)
    source: str = SOURCE_LLM
    source_url: str = ""
    publisher_site: str = ""
    notes: str = ""


async def search_book_candidates(keyword: str, limit: int = 8) -> list[dangdang.BookCandidate]:
    """按书名 / ISBN 检索候选图书。"""

    return await dangdang.search_books(keyword, limit=limit)


async def fetch_catalog(
    *,
    title: str,
    edition: str = "",
    author: str = "",
    publisher: str = "",
) -> CatalogFetchResult:
    """获取目录：优先出版社官网，失败则交给大模型还原。

    Raises:
        ValueError: 书名缺失，或两条链路都拿不到任何条目。
    """

    book = llm_toc.BookRef(
        title=title.strip(), edition=edition.strip(), author=author.strip(), publisher=publisher.strip()
    )
    if not book.title:
        raise ValueError("请填写书名。")

    site = publisher_sites.resolve_publisher_site(book.publisher)
    if site is not None:
        source = await publisher_sites.fetch_publisher_catalog_text(
            title=book.title, publisher=book.publisher
        )
        if source is not None:
            paths = await llm_toc.structure_catalog_from_text(book, source.text)
            if paths:
                logger.info(
                    "目录取自出版社官网 site=%s title=%s count=%s", source.site_name, book.title, len(paths)
                )
                return CatalogFetchResult(
                    paths=paths,
                    source=SOURCE_PUBLISHER_SITE,
                    source_url=source.source_url,
                    publisher_site=source.site_name,
                    notes=f"目录抽取自{source.site_name}官网页面，请核对后导入。",
                )
        logger.info("出版社官网未取到目录，降级到大模型 title=%s publisher=%s", book.title, book.publisher)

    paths = await llm_toc.generate_catalog_from_knowledge(book)
    if not paths:
        raise ValueError(
            "没能获取到这本书的目录。请确认书名/版本是否准确，或换用「书籍目录拍照导入」。"
        )

    note = (
        "该目录由大模型依据书名与版本推断生成，未经原书核对，请逐条确认后再导入。"
        if not book.publisher
        else f"未能在{book.publisher}官网取到目录，以下内容由大模型推断，请逐条确认后再导入。"
    )
    return CatalogFetchResult(paths=paths, source=SOURCE_LLM, notes=note)


_COVER_PROMPT = """请识别这张图书封面上印的信息，只输出合法 JSON，不要任何解释、不要 Markdown 代码块。

JSON 格式：{"title": "书名", "edition": "版次（如 第8版，没有就留空）", "author": "作者或编者（没有就留空）", "publisher": "出版社（没有就留空）"}

注意：
1. 书名要去掉「教材」「辅导」这类非书名主体的后缀营销词，保留完整书名。
2. 认不出来的字段一律留空字符串，不要猜测。"""


def _ensure_data_url(image: str) -> str:
    if image.strip().lower().startswith("data:"):
        return image
    return f"data:image/jpeg;base64,{image}"


def parse_cover_payload(raw: str) -> dict[str, str]:
    """把封面识别结果归一为固定字段。"""

    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\s*", "", text)
        text = re.sub(r"\s*```\s*$", "", text)

    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}

    result: dict[str, str] = {}
    for key in ("title", "edition", "author", "publisher"):
        value = payload.get(key)
        result[key] = str(value).strip() if value is not None else ""
    return result


async def recognize_book_cover(image: str) -> dict[str, str]:
    """用 Qwen VL 从封面读出书名/版次/作者/出版社。"""

    api_key = settings.qwen_api_key
    if not api_key:
        raise RuntimeError("未配置 Qwen API Key，无法识别封面。")

    base_url = settings.qwen_base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=COVER_TIMEOUT_SECONDS) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": settings.qwen_vl_model_name,
                    "messages": [
                        {"role": "system", "content": "你只输出合法 JSON。"},
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": _COVER_PROMPT},
                                {"type": "image_url", "image_url": {"url": _ensure_data_url(image)}},
                            ],
                        },
                    ],
                    "temperature": 0.1,
                    "max_tokens": 1024,
                },
            )
    except httpx.HTTPError as exc:
        logger.warning("封面识别请求失败：%s", exc)
        raise RuntimeError("封面识别服务暂时不可用，请稍后重试。") from exc

    if response.status_code >= 400:
        raise RuntimeError(f"封面识别失败：{response.text.strip()[:200] or '请稍后重试'}")

    content = response.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("没能从这张封面读出书名，请换一张更清晰的照片，或手动填写书名。")

    parsed = parse_cover_payload(content)
    if not parsed.get("title"):
        raise ValueError("没能从这张封面读出书名，请换一张更清晰的照片，或手动填写书名。")
    return parsed


__all__ = [
    "SOURCE_LLM",
    "SOURCE_PUBLISHER_SITE",
    "CatalogFetchResult",
    "fetch_catalog",
    "parse_cover_payload",
    "recognize_book_cover",
    "search_book_candidates",
]
