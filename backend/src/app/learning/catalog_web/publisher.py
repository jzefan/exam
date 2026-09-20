"""出版社官网检索（尽力而为，失败即降级给大模型）。

设计取舍：**不为每家出版社写专属适配器**。只维护「出版社 → 官网域名 + 站内搜索
模板」的配置表，页面正文抽取走通用逻辑，目录结构化统一交给大模型。

出版社站点普遍是 SPA/CMS（实测人邮 / 高教社是 Nuxt 客户端渲染，电子工业社、
人卫社不稳定），因此本模块的契约是「拿不到就返回 None」，由上层降级到
`llm_toc.generate_catalog`，绝不抛错中断整条链路。
"""

from __future__ import annotations

import html as html_lib
import logging
import re
import urllib.parse
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SECONDS = 10.0
MAX_DETAIL_PAGES = 2

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


@dataclass(frozen=True, slots=True)
class PublisherSite:
    """一个出版社官网的检索入口。`search_template` 里 `{query}` 是已编码关键词。"""

    name: str
    domain: str
    search_template: str
    aliases: tuple[str, ...] = ()


@dataclass(slots=True)
class PublisherCatalogSource:
    """从出版社官网抓到的、疑似含有目录的正文。"""

    site_name: str
    source_url: str
    text: str


# 覆盖用户所在的高职教育 / 计算机 / 医学方向常见社。命中不了会自动降级到 LLM。
PUBLISHER_SITES: tuple[PublisherSite, ...] = (
    PublisherSite("高等教育出版社", "www.hep.com.cn", "https://www.hep.com.cn/search?keyword={query}", ("高教社",)),
    PublisherSite("人民邮电出版社", "www.ptpress.com.cn", "https://www.ptpress.com.cn/search?keyword={query}", ("人邮", "人邮社")),
    PublisherSite("机械工业出版社", "www.cmpbook.com", "https://www.cmpbook.com/search?keyword={query}", ("机工社", "机工")),
    PublisherSite("电子工业出版社", "www.phei.com.cn", "https://www.phei.com.cn/search?keyword={query}", ("电子工业社",)),
    PublisherSite("清华大学出版社", "www.tup.tsinghua.edu.cn", "http://www.tup.tsinghua.edu.cn/search?keyword={query}", ("清华社",)),
    PublisherSite("人民卫生出版社", "www.pmph.com", "https://www.pmph.com/search?keyword={query}", ("人卫社", "人卫")),
    PublisherSite("科学出版社", "www.sciencep.com", "https://www.sciencep.com/search?keyword={query}", ("科学社",)),
    PublisherSite("中国中医药出版社", "www.cptcm.com", "https://www.cptcm.com/search?keyword={query}", ()),
    PublisherSite("北京大学出版社", "www.pup.cn", "https://www.pup.cn/search?keyword={query}", ("北大社",)),
    PublisherSite("上海交通大学出版社", "www.jiaodapress.com.cn", "https://www.jiaodapress.com.cn/search?keyword={query}", ("上海交大社",)),
    PublisherSite("西安电子科技大学出版社", "www.xduph.com", "https://www.xduph.com/search?keyword={query}", ("西电社",)),
    PublisherSite("化学工业出版社", "www.cip.com.cn", "https://www.cip.com.cn/search?keyword={query}", ("化工社",)),
)

_NOISE_SUFFIXES = (
    "出版集团有限公司",
    "出版传媒股份有限公司",
    "出版有限责任公司",
    "有限公司",
    "有限责任公司",
    "出版集团",
    "股份有限公司",
    "出版社",
    "出版公司",
)

_SCRIPT_STYLE_RE = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.DOTALL | re.IGNORECASE)
_BLOCK_BREAK_RE = re.compile(r"</(p|div|li|tr|h[1-6]|section|article)>|<br\s*/?>", re.IGNORECASE)
_TAG_RE = re.compile(r"<[^>]+>")
_HREF_RE = re.compile(r"""href=["']([^"']+)["']""", re.IGNORECASE)
_CHARSET_RE = re.compile(r"""charset=["']?([\w-]+)""", re.IGNORECASE)
_BOOK_LINK_HINTS = ("book", "product", "detail", "goods", "item", "shu", "isbn")
_CATALOG_LINE_RE = re.compile(
    r"^\s*(?:"
    r"第[一二三四五六七八九十百千万两\d]+(?:部分|单元|章节|章|节|篇|编|卷)"
    r"|(?:Chapter|Unit|Part|Module|Section)\s+(?:[IVXLCDM]+|\d+(?:\.\d+)*)"
    r"|\d+(?:\.\d+){1,3}"
    r")\s*\S+",
    re.IGNORECASE,
)
# 「detail」「item」这类词也出现在新闻/公告链接里，必须排除，否则会抓错页面。
_NON_BOOK_LINK_HINTS = (
    "news",
    "article",
    "notice",
    "zixun",
    "blog",
    "about",
    "login",
    "help",
    "video",
    "download",
    "search",
)


def normalize_publisher_name(name: str) -> str:
    """把「高等教育出版社有限公司」这类写法归一为可匹配的核心名。

    反复剥离后缀，保证「高等教育出版社有限公司」与「高等教育出版社」归一到同一结果。
    """

    cleaned = re.sub(r"\s+", "", name.strip())
    changed = True
    while changed:
        changed = False
        for suffix in _NOISE_SUFFIXES:
            if cleaned.endswith(suffix) and len(cleaned) > len(suffix):
                cleaned = cleaned[: -len(suffix)]
                changed = True
                break
    return cleaned


# 归一后至少要有这么多字，才允许用「前缀」做模糊匹配。
# 否则「人民出版社」会被错误匹配到「人民邮电出版社」。
_MIN_FUZZY_MATCH_LENGTH = 4


def resolve_publisher_site(publisher: str | None) -> PublisherSite | None:
    """按出版社名（含别名、后缀归一）匹配官网配置。"""

    target = normalize_publisher_name(publisher or "")
    if not target:
        return None

    for site in PUBLISHER_SITES:
        if target == normalize_publisher_name(site.name) or target in site.aliases:
            return site

    if len(target) >= _MIN_FUZZY_MATCH_LENGTH:
        for site in PUBLISHER_SITES:
            normalized_name = normalize_publisher_name(site.name)
            if normalized_name.startswith(target) or target.startswith(normalized_name):
                return site
        for site in PUBLISHER_SITES:
            if any(alias and alias in target for alias in site.aliases):
                return site

    return None


def html_to_text(html: str) -> str:
    """去脚本样式与标签，保留块级换行，得到可交给大模型的纯文本。"""

    body = _SCRIPT_STYLE_RE.sub(" ", html)
    body = _BLOCK_BREAK_RE.sub("\n", body)
    body = re.sub(r"<!--.*?-->", " ", body, flags=re.DOTALL)
    body = _TAG_RE.sub(" ", body)
    body = html_lib.unescape(body)
    lines = [re.sub(r"[ \t\u00a0]+", " ", line).strip() for line in body.splitlines()]
    kept = [line for line in lines if line]
    return "\n".join(kept)


def catalog_confidence(text: str) -> int:
    """统计疑似目录行的数量，用于判断这一页是否值得送去结构化。"""

    if "目录" not in text:
        return 0
    return sum(1 for line in text.splitlines() if _CATALOG_LINE_RE.match(line))


def extract_book_links(html: str, base_url: str) -> list[str]:
    """从搜索结果页挑出疑似图书详情页的链接，按出现顺序去重。"""

    links: list[str] = []
    seen: set[str] = set()
    for raw in _HREF_RE.findall(html):
        href = raw.strip()
        if not href or href.startswith(("javascript:", "#", "mailto:")):
            continue
        absolute = urllib.parse.urljoin(base_url, href)
        if not absolute.startswith(("http://", "https://")):
            continue
        lowered = absolute.lower()
        if any(hint in lowered for hint in _NON_BOOK_LINK_HINTS):
            continue
        if not any(hint in lowered for hint in _BOOK_LINK_HINTS):
            continue
        if not re.search(r"\d", absolute):
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        links.append(absolute)
    return links


def _decode_html(response: httpx.Response) -> str:
    declared = _CHARSET_RE.search(response.text[:2000])
    candidates = []
    if declared:
        candidates.append(declared.group(1))
    candidates.extend(["utf-8", "gb18030"])
    for codec in candidates:
        try:
            return response.content.decode(codec, errors="strict")
        except (UnicodeDecodeError, LookupError):
            continue
    return response.content.decode("utf-8", errors="replace")


async def fetch_publisher_catalog_text(
    *, title: str, publisher: str | None
) -> PublisherCatalogSource | None:
    """在出版社官网检索该书并抓取疑似含有目录的正文。

    任何一步失败都返回 None（由上层降级到 LLM），不抛异常。
    """

    site = resolve_publisher_site(publisher)
    if site is None:
        return None

    keyword = title.strip()
    if not keyword:
        return None

    query = urllib.parse.quote(keyword, encoding="utf-8")
    search_url = site.search_template.format(query=query)

    try:
        async with httpx.AsyncClient(
            timeout=DEFAULT_TIMEOUT_SECONDS, follow_redirects=True, headers=_HEADERS
        ) as client:
            search_response = await client.get(search_url)
            if search_response.status_code >= 400:
                return None
            search_html = _decode_html(search_response)

            links = extract_book_links(search_html, str(search_response.url))

            # 站内搜索页本身可能已经是详情页（部分出版社直达）。
            direct_text = html_to_text(search_html)
            if catalog_confidence(direct_text) >= 8:
                return PublisherCatalogSource(site.name, str(search_response.url), direct_text)

            for link in links[:MAX_DETAIL_PAGES]:
                try:
                    detail_response = await client.get(link)
                except httpx.HTTPError:
                    continue
                if detail_response.status_code >= 400:
                    continue
                detail_text = html_to_text(_decode_html(detail_response))
                if catalog_confidence(detail_text) >= 8:
                    return PublisherCatalogSource(site.name, str(detail_response.url), detail_text)
    except httpx.HTTPError as exc:
        logger.info("出版社官网检索失败 publisher=%s error=%s", publisher, exc)
        return None

    return None


__all__ = [
    "PUBLISHER_SITES",
    "PublisherCatalogSource",
    "PublisherSite",
    "catalog_confidence",
    "extract_book_links",
    "fetch_publisher_catalog_text",
    "html_to_text",
    "normalize_publisher_name",
    "resolve_publisher_site",
]
