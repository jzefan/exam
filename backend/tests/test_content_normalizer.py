"""Import-time line-break normalization.

Word soft wraps used to survive import as `<br>` inside a single paragraph (and
as newlines in the plain-text twin), so questions rendered with a break in the
middle of a sentence.
"""

from app.questions.content_normalizer import (
    normalize_html_breaks,
    normalize_question_content,
    normalize_text_breaks,
    split_soft_wrapped_paragraphs,
)


def test_joins_a_wrap_inside_a_sentence():
    html = "<p>包括 IP 地址、子网掩码、<br> 的 IP 地址和域名服务器。</p>"
    assert normalize_html_breaks(html) == "<p>包括 IP 地址、子网掩码、 的 IP 地址和域名服务器。</p>"


def test_joins_a_wrap_that_splits_a_word():
    html = "<p>高速缓存的作用是<br>什么？（6 分）</p>"
    assert normalize_html_breaks(html) == "<p>高速缓存的作用是什么？（6 分）</p>"


def test_keeps_the_break_after_sentence_punctuation():
    html = "<p>第一问是什么？<br>第二问是什么？</p>"
    assert normalize_html_breaks(html) == html


def test_keeps_the_break_before_a_list_item():
    html = "<p>请选择：<br>A. 甲<br>B. 乙</p>"
    assert normalize_html_breaks(html) == html


def test_keeps_a_space_between_ascii_neighbours():
    html = "<p>tb_department(dept_id, dept_name)<br>tb_registration(reg_id)</p>"
    assert normalize_html_breaks(html) == (
        "<p>tb_department(dept_id, dept_name) tb_registration(reg_id)</p>"
    )


def test_leaves_pre_and_code_blocks_alone():
    html = "<pre>def f():\n    return 1</pre><p>说明<br>文字</p>"
    assert normalize_html_breaks(html) == html


def test_text_twin_keeps_blank_lines_as_paragraphs():
    assert normalize_text_breaks("子网掩码、\n的 IP 地址。\n\n第二段") == (
        "子网掩码、的 IP 地址。\n\n第二段"
    )


def test_code_questions_are_not_touched():
    content = {"html": "<p>a<br>b</p>", "text": "a\nb"}
    assert normalize_question_content(content, question_type="code") is content


def test_split_groups_wrapped_lines_into_one_paragraph():
    assert split_soft_wrapped_paragraphs("由下而上\n分别为：网络接口层、\n运输层。") == [
        "由下而上分别为：网络接口层、运输层。"
    ]


def test_split_honours_blank_lines_and_list_items():
    text = "第一段内容\n\n第二段：\n1、甲\n2、乙"
    assert split_soft_wrapped_paragraphs(text) == ["第一段内容", "第二段：", "1、甲", "2、乙"]


def test_paper_import_html_no_longer_makes_a_paragraph_per_line():
    from app.papers.service import _build_import_content_html

    html = _build_import_content_html("连接到 Internet 的计算机需要配置的项目包括\nIP 地址、子网掩码。")
    assert html == "<p>连接到 Internet 的计算机需要配置的项目包括IP 地址、子网掩码。</p>"
