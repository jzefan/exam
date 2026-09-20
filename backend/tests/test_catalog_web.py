"""「获取目录」（catalog-web）适配器与编排层的单元测试。

不触网：所有 HTTP 结果都用固定 HTML 片段或 monkeypatch 构造。
真实站点结构见 docs/plans/2026-09-19-001-feat-course-catalog-web-fetch-plan.md。
"""

import pytest

from app.learning import router as learning_router
from app.learning.catalog_web import dangdang, llm_toc, publisher
from app.learning.catalog_web import service as catalog_web_service
from app.learning.schemas import CatalogWebSearchRequest, CatalogWebSearchResponse

# 按当当搜索页真实 DOM 结构裁剪的最小样例：两个商品 + 一个无结果的空块。
SEARCH_HTML = """
<html><head><title>高等数学-当当网</title></head><body>
<ul class="bigimg">
<li ddt-pit="1" class="line1" id="p29589834">
  <a title=" 高等数学 同济大学第八版 上册 " class="pic" href="//product.dangdang.com/29589834.html"><img/></a>
  <p class="name" name="title"><a title=" 高等数学 同济大学第八版 上册 " href="//product.dangdang.com/29589834.html">高等数学</a></p>
  <p class="price"><span class="search_now_price">&yen;47.00</span><span class="search_pre_price">&yen;58.00</span></p>
  <p class="search_book_author">
    <span><a href='//search.dangdang.com/?key2=x' name='itemlist-author' title='同济大学数学科学学院'>同济大学数学科学学院</a></span>
    <span> /2023-06-01</span>
    <span> /<a href='//search.dangdang.com/?key3=y' name='P_cbs' title='高等教育出版社'>高等教育出版社</a></span>
  </p>
</li>
<li ddt-pit="2" class="line2" id="p12100017846">
  <p class="name" name="title"><a title="高等数学同济大学第八版教材辅导" href="//product.dangdang.com/12100017846.html">高等数学同济大学第八版教材辅导</a></p>
  <p class="price"><span class="search_now_price">&yen;12.50</span></p>
  <p class="search_book_author"><span></span></p>
</li>
</ul>
</body></html>
"""

NO_RESULT_HTML = """
<html><head><title>搜索无结果页</title></head><body>
<p>抱歉，没有找到与“楂樼瓑鏁板”相关的商品！</p>
</body></html>
"""

# 同一本书在当当上常因卖家 / 新旧不同排成多条，元数据却一模一样：
# 界面上是几行看起来完全相同的候选（用户实测截图）。
DUPLICATE_HTML = """
<html><body><ul class="bigimg">
<li id="p111">
  <p class="name"><a title="计算机网络简明教程">计算机网络简明教程</a></p>
  <p class="search_book_author">
    <span><a name='itemlist-author' title='谢希仁'>谢希仁</a></span>
    <span> /2017-01-01</span>
    <span> /<a name='P_cbs' title='电子工业出版社'>电子工业出版社</a></span>
  </p>
</li>
<li id="p222">
  <p class="name"><a title="计算机网络简明教程">计算机网络简明教程</a></p>
  <p class="search_book_author">
    <span><a name='itemlist-author' title='谢希仁'>谢希仁</a></span>
    <span> /2017-08-01</span>
    <span> /<a name='P_cbs' title='电子工业出版社'>电子工业出版社</a></span>
  </p>
</li>
<li id="p333">
  <p class="name"><a title="计算机网络简明教程">计算机网络简明教程</a></p>
  <p class="search_book_author">
    <span><a name='itemlist-author' title='谢希仁'>谢希仁</a></span>
    <span> /2017-01-01</span>
    <span> /<a name='P_cbs' title='电子工业出版社'>电子工业出版社</a></span>
  </p>
</li>
<li id="p444">
  <p class="name"><a title="计算机网络（第8版）">计算机网络（第8版）</a></p>
  <p class="search_book_author">
    <span><a name='itemlist-author' title='谢希仁'>谢希仁</a></span>
    <span> /2017-01-01</span>
    <span> /<a name='P_cbs' title='电子工业出版社'>电子工业出版社</a></span>
  </p>
</li>
</ul></body></html>
"""


# ---------------------------------------------------------------- 当当适配器


def test_encode_keyword_uses_gbk_percent_encoding() -> None:
    """当当搜索页是 GB2312，必须按 GBK 编码，否则命中无结果页。"""

    assert dangdang.encode_keyword("高等数学") == "%B8%DF%B5%C8%CA%FD%D1%A7"
    # UTF-8 编码是错误答案，回归时不要退回它。
    assert dangdang.encode_keyword("高等数学") != "%E9%AB%98%E7%AD%89%E6%95%B0%E5%AD%A6"


def test_encode_keyword_falls_back_when_gb2312_cannot_encode() -> None:
    """GB2312 覆盖不全的字符（如 ②）要能降级到 GBK/GB18030 而不是抛错。"""

    encoded = dangdang.encode_keyword("高数②")
    assert encoded.startswith("%B8%DF%CA%FD")


def test_parse_search_results_extracts_all_fields() -> None:
    candidates = dangdang.parse_search_results(SEARCH_HTML)

    assert len(candidates) == 2
    first = candidates[0]
    assert first.title == "高等数学 同济大学第八版 上册"
    assert first.url == "https://product.dangdang.com/29589834.html"
    assert first.author == "同济大学数学科学学院"
    assert first.publisher == "高等教育出版社"
    assert first.publish_date == "2023-06-01"
    assert first.edition == "第八版"
    assert first.price == "47.00"


def test_parse_search_results_tolerates_missing_optional_fields() -> None:
    second = dangdang.parse_search_results(SEARCH_HTML)[1]

    assert second.title == "高等数学同济大学第八版教材辅导"
    assert second.author == ""
    assert second.publisher == ""
    assert second.price == "12.50"


def test_parse_search_results_respects_limit_and_no_result_page() -> None:
    assert len(dangdang.parse_search_results(SEARCH_HTML, limit=1)) == 1
    assert dangdang.parse_search_results(NO_RESULT_HTML) == []
    assert dangdang._has_no_results(NO_RESULT_HTML) is True


def test_candidate_signature_ignores_whitespace_and_day_precision() -> None:
    """指纹按「书名 + 作者 + 出版社 + 年份 + 版次」算，忽略空格与具体日期。"""

    first = dangdang.BookCandidate(
        title="计算机网络简明教程",
        author="谢希仁",
        publisher="电子工业出版社",
        publish_date="2017-01-01",
        edition="第8版",
    )
    same_year_other_print = dangdang.BookCandidate(
        title="计算机网络简明 教程",
        author=" 谢希仁 ",
        publisher="电子工业出版社",
        publish_date="2017-08-09",
        edition="第8版",
    )
    other_year = dangdang.BookCandidate(
        title="计算机网络简明教程",
        author="谢希仁",
        publisher="电子工业出版社",
        publish_date="2022-01-01",
        edition="第8版",
    )

    assert dangdang.candidate_signature(first) == dangdang.candidate_signature(same_year_other_print)
    assert dangdang.candidate_signature(first) != dangdang.candidate_signature(other_year)


def test_parse_search_results_dedupes_identical_listings() -> None:
    """三行完全一样的候选只保留第一条，不同版次的书不受影响。"""

    candidates = dangdang.parse_search_results(DUPLICATE_HTML)

    assert [candidate.title for candidate in candidates] == [
        "计算机网络简明教程",
        "计算机网络（第8版）",
    ]
    # 保留下来的应该是页面顺序里的第一条。
    assert candidates[0].url == "https://product.dangdang.com/111.html"


def test_parse_search_results_dedupe_does_not_shrink_limit() -> None:
    """去重后要继续往后扫，limit 不能被重复条目吃掉。"""

    assert len(dangdang.parse_search_results(DUPLICATE_HTML, limit=2)) == 2
    assert len(dangdang.parse_search_results(DUPLICATE_HTML, limit=1)) == 1


# 当当的商品标题形如「书名 作者 著 出版社 [ISBN] 营销词…」，展示和喂给大模型前都要清洗。
MARKETING_TITLE = (
    "计算机网络简明教程 谢希仁 著 电子工业出版社 正版旧书，保证质量，此书为单本而非一套，电子发票。"
)


def test_clean_book_title_strips_author_publisher_and_marketing() -> None:
    assert (
        dangdang.clean_book_title(
            MARKETING_TITLE, author="谢希仁", publisher="电子工业出版社"
        )
        == "计算机网络简明教程"
    )


def test_clean_book_title_falls_back_to_segment_stripping() -> None:
    """作者 / 出版社都没解析出来时，靠标点分段兜底，至少不能把整串广告端出去。"""

    assert (
        dangdang.clean_book_title(MARKETING_TITLE)
        == "计算机网络简明教程 谢希仁 著 电子工业出版社"
    )


def test_clean_book_title_keeps_a_title_that_looks_like_marketing() -> None:
    """剥光了就退回原文 —— 不能让《正版语文》这类书名被清成空字符串。"""

    assert dangdang.clean_book_title("正版语文") == "正版语文"


def test_clean_person_name_drops_role_suffix() -> None:
    assert dangdang.clean_person_name("谢希仁 著") == "谢希仁"
    assert dangdang.clean_person_name("严蔚敏 编著") == "严蔚敏"
    assert dangdang.clean_person_name("谢希仁") == "谢希仁"


def test_extract_edition_from_title() -> None:
    assert dangdang.extract_edition("高等数学 同济大学第八版 上册") == "第八版"
    assert dangdang.extract_edition("数据结构（C语言版）第2版") == "第2版"
    assert dangdang.extract_edition("计算机网络") == ""


# ---------------------------------------------------------------- 出版社官网


def test_normalize_and_resolve_publisher_name() -> None:
    # 后缀要反复剥离，保证带「有限公司」与不带的写法归一到同一结果。
    assert publisher.normalize_publisher_name("高等教育出版社有限公司") == "高等教育"
    assert publisher.normalize_publisher_name("高等教育出版社") == "高等教育"
    assert publisher.normalize_publisher_name(" 人民卫生出版社 ") == "人民卫生"

    assert publisher.resolve_publisher_site("高等教育出版社").name == "高等教育出版社"
    assert publisher.resolve_publisher_site("高等教育出版社有限公司").name == "高等教育出版社"
    assert publisher.resolve_publisher_site("电子工业出版社有限公司").name == "电子工业出版社"
    assert publisher.resolve_publisher_site("人卫社").name == "人民卫生出版社"
    assert publisher.resolve_publisher_site("") is None
    assert publisher.resolve_publisher_site(None) is None
    assert publisher.resolve_publisher_site("某不存在的出版社") is None
    # 「人民」这类过短的名字不允许被模糊匹配到「人民邮电出版社」。
    assert publisher.resolve_publisher_site("人民出版社") is None


def test_html_to_text_drops_scripts_and_keeps_block_breaks() -> None:
    raw = (
        "<html><head><style>a{color:red}</style><script>var x=1;</script></head>"
        "<body><div>目录</div><div>第一章 概述</div><p>1.1 计算机网络</p></body></html>"
    )

    text = publisher.html_to_text(raw)

    assert "color:red" not in text
    assert "var x=1" not in text
    assert text.splitlines() == ["目录", "第一章 概述", "1.1 计算机网络"]


def test_catalog_confidence_requires_catalog_word_and_numbered_lines() -> None:
    rich = "目录\n第一章 概述\n1.1 计算机网络在信息时代的作用\n1.2 互联网概述\n第二章 物理层"
    assert publisher.catalog_confidence(rich) == 4
    # 没有「目录」二字时一律视为不可信。
    assert publisher.catalog_confidence(rich.replace("目录", "")) == 0
    assert publisher.catalog_confidence("目录\n好好学习天天向上") == 0


def test_extract_book_links_keeps_only_bookish_links() -> None:
    raw = (
        '<a href="/book/12345.html">书</a>'
        '<a href="/news/detail?id=1">新闻</a>'
        '<a href="javascript:void(0)">脚本</a>'
        '<a href="/product/99">商品</a>'
        '<a href="/about">关于</a>'
    )

    links = publisher.extract_book_links(raw, "https://www.example.com/search?keyword=x")

    assert links == ["https://www.example.com/book/12345.html", "https://www.example.com/product/99"]


async def test_fetch_publisher_catalog_text_returns_none_without_matching_site() -> None:
    assert await publisher.fetch_publisher_catalog_text(title="高等数学", publisher="查无此社") is None
    assert await publisher.fetch_publisher_catalog_text(title="   ", publisher="高等教育出版社") is None


# ---------------------------------------------------------------- 大模型侧


def test_parse_paths_payload_handles_fences_and_dedupes() -> None:
    raw = """```json
{"paths": [["第一章 概述", "1.1 互联网概述"], ["第一章 概述", "1.1 互联网概述"], [], "x", ["第二章 物理层"]]}
```"""

    assert llm_toc.parse_paths_payload(raw) == [
        ["第一章 概述", "1.1 互联网概述"],
        ["第二章 物理层"],
    ]


def test_parse_paths_payload_returns_empty_on_bad_shape() -> None:
    assert llm_toc.parse_paths_payload("不是 JSON") == []
    assert llm_toc.parse_paths_payload('{"paths": "nope"}') == []
    assert llm_toc.parse_paths_payload('{"paths": []}') == []


def test_parse_paths_payload_salvages_truncated_output() -> None:
    """完整目录顶到输出上限被截断时，应保住已生成的条目，而不是整体判成空。"""

    truncated = (
        '{"paths": [["第一章 概述", "1.1 计算机网络在信息时代的作用"], '
        '["第一章 概述", "1.2 互联网概述"], ["第二章 物理层", "2.1'
    )

    assert llm_toc.parse_paths_payload(truncated) == [
        ["第一章 概述", "1.1 计算机网络在信息时代的作用"],
        ["第一章 概述", "1.2 互联网概述"],
    ]


def test_generate_prompt_demands_the_whole_table_of_contents() -> None:
    """回归：提示词曾写「只输出你有把握的章」，实测导致只返回第一章 6 条。"""

    prompt = llm_toc._GENERATE_PROMPT  # noqa: SLF001

    assert "完整目录" in prompt
    assert "只输出你有把握的内容" not in prompt


# ---------------------------------------------------------------- 编排层降级


async def _no_publisher_source(**_kwargs):
    return None


async def test_fetch_catalog_prefers_publisher_site(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_source(**kwargs):
        return publisher.PublisherCatalogSource(
            site_name="高等教育出版社",
            source_url="https://www.hep.com.cn/book/1",
            text="目录\n第一章 概述\n1.1 互联网概述",
        )

    async def _fake_structure(book, text):  # noqa: ANN001
        assert "第一章" in text
        return [["第一章 概述", "1.1 互联网概述"]]

    async def _boom(book):  # noqa: ANN001
        raise AssertionError("命中出版社官网时不应调用大模型推断")

    monkeypatch.setattr(publisher, "fetch_publisher_catalog_text", _fake_source)
    monkeypatch.setattr(llm_toc, "structure_catalog_from_text", _fake_structure)
    monkeypatch.setattr(llm_toc, "generate_catalog_from_knowledge", _boom)

    result = await catalog_web_service.fetch_catalog(
        title="高等数学", publisher="高等教育出版社"
    )

    assert result.source == catalog_web_service.SOURCE_PUBLISHER_SITE
    assert result.publisher_site == "高等教育出版社"
    assert result.source_url == "https://www.hep.com.cn/book/1"
    assert result.paths == [["第一章 概述", "1.1 互联网概述"]]


async def test_fetch_catalog_falls_back_to_llm_when_site_has_no_catalog(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(publisher, "fetch_publisher_catalog_text", _no_publisher_source)

    async def _fake_generate(book):  # noqa: ANN001
        assert book.publisher == "电子工业出版社"
        return [["第一章 概述", "1.1 互联网概述"], ["第二章 物理层"]]

    monkeypatch.setattr(llm_toc, "generate_catalog_from_knowledge", _fake_generate)

    result = await catalog_web_service.fetch_catalog(
        title="计算机网络", edition="第8版", publisher="电子工业出版社"
    )

    assert result.source == catalog_web_service.SOURCE_LLM
    assert result.paths == [["第一章 概述", "1.1 互联网概述"], ["第二章 物理层"]]
    assert "电子工业出版社" in result.notes


async def test_fetch_catalog_falls_back_when_structured_text_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """官网抓到了正文但里面没有目录时，也要降级到大模型。"""

    async def _fake_source(**kwargs):
        return publisher.PublisherCatalogSource("某社", "https://example.com/b/1", "本书介绍了……")

    async def _empty_structure(book, text):  # noqa: ANN001
        return []

    async def _fake_generate(book):  # noqa: ANN001
        return [["第一章 概述"]]

    monkeypatch.setattr(publisher, "fetch_publisher_catalog_text", _fake_source)
    monkeypatch.setattr(llm_toc, "structure_catalog_from_text", _empty_structure)
    monkeypatch.setattr(llm_toc, "generate_catalog_from_knowledge", _fake_generate)

    result = await catalog_web_service.fetch_catalog(title="某书", publisher="某社")

    assert result.source == catalog_web_service.SOURCE_LLM
    assert result.paths == [["第一章 概述"]]


async def test_fetch_catalog_raises_when_both_paths_come_up_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(publisher, "fetch_publisher_catalog_text", _no_publisher_source)

    async def _empty_generate(book):  # noqa: ANN001
        return []

    monkeypatch.setattr(llm_toc, "generate_catalog_from_knowledge", _empty_generate)

    with pytest.raises(ValueError, match="没能获取到这本书的目录"):
        await catalog_web_service.fetch_catalog(title="某本冷门书")


async def test_fetch_catalog_rejects_blank_title() -> None:
    with pytest.raises(ValueError, match="请填写书名"):
        await catalog_web_service.fetch_catalog(title="   ")


# ---------------------------------------------------------------- 封面识别


def test_parse_cover_payload_normalizes_fields() -> None:
    raw = '```json\n{"title":"计算机网络","edition":"第8版","author":null,"publisher":"电子工业出版社"}\n```'

    assert catalog_web_service.parse_cover_payload(raw) == {
        "title": "计算机网络",
        "edition": "第8版",
        "author": "",
        "publisher": "电子工业出版社",
    }
    assert catalog_web_service.parse_cover_payload("不是 JSON") == {}


# ---------------------------------------------------------------- 路由响应模型
# 回归背景：`/catalog-web/search` 曾把数据层的 dataclass 直接交给 Pydantic 响应模型，
# v2 默认不从对象读取属性 → ResponseValidationError → 前端只看到 500 Internal Server Error。


def test_search_response_accepts_dataclass_candidates() -> None:
    response = CatalogWebSearchResponse(
        candidates=[dangdang.BookCandidate(title="计算机网络", publisher="电子工业出版社")]
    )

    assert response.candidates[0].title == "计算机网络"
    assert response.candidates[0].publisher == "电子工业出版社"
    assert response.candidates[0].source == "dangdang"


async def test_search_route_serializes_dataclass_candidates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_search(keyword: str, limit: int = 8) -> list[dangdang.BookCandidate]:
        del limit
        return [dangdang.BookCandidate(title=f"{keyword} 第{i}版") for i in range(2)]

    monkeypatch.setattr(catalog_web_service, "search_book_candidates", fake_search)

    response = await learning_router.search_catalog_books(
        CatalogWebSearchRequest(keyword="计算机网络"), user=None
    )

    assert [item.title for item in response.candidates] == [
        "计算机网络 第0版",
        "计算机网络 第1版",
    ]
