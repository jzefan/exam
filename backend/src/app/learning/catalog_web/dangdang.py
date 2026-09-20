"""当当网图书检索适配器（仅用搜索页，不碰商品详情页）。

⚠️ 编码陷阱：当当搜索页声明 `charset=GB2312`。关键词必须先用 gb2312 百分号编码
再拼进 URL，否则服务端会把 UTF-8 字节按 GB2312 解读，返回「搜索无结果页」
（实测：传 UTF-8 的 `高等数学` 会变成 `楂樼瓑鏁板`，命中 0 条）。
"""

from __future__ import annotations

import logging
import re
import urllib.parse
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

SEARCH_ENDPOINT = "https://search.dangdang.com/"
DEFAULT_TIMEOUT_SECONDS = 15.0
MAX_LIMIT = 20

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

_ITEM_SPLIT_RE = re.compile(r'(?=<li[^>]*id="p\d+")')
_ITEM_ID_RE = re.compile(r'<li[^>]*id="p(\d+)"')
_NAME_BLOCK_RE = re.compile(r'<p\s+class="name"[^>]*>(.*?)</p>', re.DOTALL)
_PRICE_RE = re.compile(r'<span\s+class="search_now_price">[^0-9]*([\d.]+)')
_LIST_PRICE_RE = re.compile(r'<span\s+class="search_pre_price">[^0-9]*([\d.]+)')
_AUTHOR_RE = re.compile(r"""name=['"]itemlist-author['"][^>]*?title=['"]([^'"]*)['"]""")
_PUBLISHER_RE = re.compile(r"""name=['"]P_cbs['"][^>]*?title=['"]([^'"]*)['"]""")
_DATE_RE = re.compile(r"<span[^>]*>\s*/(\d{4}-\d{2}-\d{2})\s*</span>")
_NO_RESULT_MARKERS = ("搜索无结果页", "没有找到与", "noresult=1")

# 当当的商品标题是「书名 作者 著 出版社 [ISBN] 营销词…」拼起来的，
# 例如「计算机网络简明教程 谢希仁 著 电子工业出版社 正版旧书，保证质量，此书为单本而非一套，电子发票。」。
# 直接展示会带一串广告，交给大模型还会污染目录生成，所以统一剥掉。
_MARKETING_KEYWORDS = (
    "正版",
    "旧书",
    "二手",
    "全新",
    "发票",
    "包邮",
    "现货",
    "速发",
    "当日发",
    "次日达",
    "保证质量",
    "单本",
    "套装",
    "全套",
    "特价",
    "促销",
    "赠品",
    "旗舰店",
    "专营店",
    "新华书店",
    "无理由",
    "清仓",
    "秒杀",
    "限时",
    "库存",
)
_TITLE_SEGMENT_SPLIT_RE = re.compile(r"[，,。！!；;、]+")
_EDITION_RE = re.compile(r"第\s*([0-9０-９一二三四五六七八九十百]+)\s*版")
_ROLE_SUFFIX_RE = re.compile(r"(?:编著|主编|编|著|译|等)\s*$")
# 营销词把一段切成这么短时，说明这段本身就是广告（如「电子」「此书为」），整段丢掉。
_MIN_TITLE_SEGMENT_CHARS = 4


def _earliest_marketing_index(segment: str) -> int | None:
    positions = [segment.find(keyword) for keyword in _MARKETING_KEYWORDS]
    positions = [index for index in positions if index >= 0]
    return min(positions) if positions else None


def _strip_marketing_segments(title: str) -> str:
    """按标点逐段剥离营销文案。全被剥光时退回原文，避免连书名一起吃掉。"""

    segments = [seg.strip() for seg in _TITLE_SEGMENT_SPLIT_RE.split(title) if seg.strip()]
    if not segments:
        return title

    kept: list[str] = []
    for segment in segments:
        index = _earliest_marketing_index(segment)
        if index is None:
            kept.append(segment)
            continue
        remaining = segment[:index].strip()
        if len(remaining) >= _MIN_TITLE_SEGMENT_CHARS:
            kept.append(remaining)

    return " ".join(kept).strip() or title


def clean_book_title(raw_title: str, *, author: str = "", publisher: str = "") -> str:
    """从商品标题里剥出纯书名：先按已知作者/出版社切尾，再兜底剥营销文案。"""

    title = re.sub(r"\s+", " ", raw_title).strip()
    if not title:
        return ""

    # 1) 当当标题的拼接顺序就是 书名 → 作者 → 出版社，所以用已解析出的字段倒着切最准。
    for marker in (publisher.strip(), author.strip()):
        if not marker:
            continue
        index = title.find(marker)
        if index > 0:
            title = title[:index]

    # 2) 作者/出版社缺失时的兜底。
    title = _strip_marketing_segments(title)
    title = _ROLE_SUFFIX_RE.sub("", title.strip())
    return re.sub(r"\s+", " ", title).strip(" -—·:：，,、。")


def extract_edition(*candidates: str) -> str:
    """从标题里抓「第八版 / 第8版」这类版次，抓不到返回空串。"""

    for text in candidates:
        match = _EDITION_RE.search(text or "")
        if match:
            return f"第{match.group(1)}版"
    return ""


def clean_person_name(name: str) -> str:
    """作者字段常带角色后缀（「谢希仁 著」「严蔚敏 编著」），展示时去掉。"""

    return _ROLE_SUFFIX_RE.sub("", name.strip()).strip()


@dataclass(slots=True)
class BookCandidate:
    """一条图书检索结果。"""

    title: str
    url: str = ""
    author: str = ""
    publisher: str = ""
    publish_date: str = ""
    edition: str = ""
    price: str = ""
    source: str = "dangdang"


def encode_keyword(keyword: str) -> str:
    """按 GB2312 家族编码关键词。GB2312 覆盖不全时逐级降级到 GBK / GB18030。"""

    for codec in ("gb2312", "gbk", "gb18030"):
        try:
            return urllib.parse.quote(keyword, encoding=codec, errors="strict")
        except UnicodeEncodeError:
            continue
    return urllib.parse.quote(keyword, encoding="gb18030", errors="ignore")


def _find_attr(fragment: str, attr: str) -> str:
    """在 HTML 片段里取属性值，兼容单/双引号。"""

    match = re.search(rf"""{attr}\s*=\s*(?:"([^"]*)"|'([^']*)')""", fragment)
    if not match:
        return ""
    value = match.group(1) if match.group(1) is not None else (match.group(2) or "")
    return value.strip()


def _has_no_results(html: str) -> bool:
    return any(marker in html for marker in _NO_RESULT_MARKERS)


def candidate_signature(candidate: BookCandidate) -> str:
    """去重指纹：书名 + 作者 + 出版社 + 年份 + 版次。

    当当搜索页里同一本书常因卖家 / 新旧不同而排成多条，元数据却完全一样，
    界面上就是几行看起来一模一样的候选。年份只取前 4 位 —— 同一年内的不同印次
    在列表里也显示成同一个年份，拆开去重对用户没有意义。
    """

    parts = (
        candidate.title,
        candidate.author,
        candidate.publisher,
        candidate.publish_date[:4],
        candidate.edition,
    )
    return "|".join(re.sub(r"\s+", "", part).lower() for part in parts)


def parse_search_results(html: str, limit: int = MAX_LIMIT) -> list[BookCandidate]:
    """解析当当搜索结果页。返回按页面顺序排列的候选图书。

    元数据完全一致的条目标视为重复，只保留页面顺序里的第一条；去重后仍会继续
    往后扫描，直到凑满 `limit`，所以清理重复不会让候选变少。
    """

    candidates: list[BookCandidate] = []
    seen_ids: set[str] = set()
    seen_signatures: set[str] = set()

    for block in _ITEM_SPLIT_RE.split(html)[1:]:
        id_match = _ITEM_ID_RE.search(block)
        if not id_match:
            continue
        product_id = id_match.group(1)
        if product_id in seen_ids:
            continue

        name_match = _NAME_BLOCK_RE.search(block)
        if not name_match:
            continue
        title = _find_attr(name_match.group(1), "title") or re.sub(
            r"<[^>]+>", "", name_match.group(1)
        ).strip()
        if not title:
            continue

        seen_ids.add(product_id)
        price_match = _PRICE_RE.search(block)
        author_match = _AUTHOR_RE.search(block)
        publisher_match = _PUBLISHER_RE.search(block)
        date_match = _DATE_RE.search(block)

        author = clean_person_name(author_match.group(1)) if author_match else ""
        publisher = publisher_match.group(1).strip() if publisher_match else ""

        candidate = BookCandidate(
            title=clean_book_title(title, author=author, publisher=publisher),
            url=f"https://product.dangdang.com/{product_id}.html",
            author=author,
            publisher=publisher,
            publish_date=date_match.group(1).strip() if date_match else "",
            edition=extract_edition(title),
            price=price_match.group(1).strip() if price_match else "",
        )

        signature = candidate_signature(candidate)
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)

        candidates.append(candidate)
        if len(candidates) >= limit:
            break

    return candidates


async def search_books(keyword: str, limit: int = 8) -> list[BookCandidate]:
    """按书名/ISBN 检索当当，返回候选图书。失败时抛 RuntimeError。"""

    cleaned = keyword.strip()
    if not cleaned:
        raise ValueError("请填写书名或 ISBN。")

    url = f"{SEARCH_ENDPOINT}?key={encode_keyword(cleaned)}&act=input"
    try:
        async with httpx.AsyncClient(
            timeout=DEFAULT_TIMEOUT_SECONDS, follow_redirects=True, headers=_HEADERS
        ) as client:
            response = await client.get(url)
    except httpx.HTTPError as exc:
        logger.warning("当当检索失败 keyword=%s error=%s", cleaned, exc)
        raise RuntimeError("图书检索服务暂时不可用，请稍后重试。") from exc

    if response.status_code >= 400:
        logger.warning("当当检索返回 %s keyword=%s", response.status_code, cleaned)
        raise RuntimeError("图书检索服务暂时不可用，请稍后重试。")

    html = response.content.decode("gb18030", errors="replace")
    if _has_no_results(html) and not parse_search_results(html, limit=1):
        return []

    return parse_search_results(html, limit=limit)


# 价格展示位是「定价」，导出到前端时无需区分，保留原始字符串即可。
__all__ = [
    "BookCandidate",
    "candidate_signature",
    "clean_book_title",
    "clean_person_name",
    "encode_keyword",
    "extract_edition",
    "parse_search_results",
    "search_books",
]
