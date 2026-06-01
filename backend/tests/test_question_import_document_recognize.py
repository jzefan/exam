from httpx import AsyncClient

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.rbac.models import Organization, Role, UserOrganization
from app.questions.schemas import (
    QuestionImportDocumentRecognizeResponse,
    QuestionImportTableInput,
)
from app.questions.service import (
    build_import_draft_from_segment,
    detect_import_template_mode,
    parse_template_document,
    preprocess_paper_import_text,
    segment_question_document,
)


def test_document_recognize_response_exposes_review_metadata() -> None:
    payload = QuestionImportDocumentRecognizeResponse.model_validate(
        {
            "mode": "smart",
            "summary": {
                "total": 2,
                "high_confidence": 1,
                "medium_confidence": 1,
                "low_confidence": 0,
                "issue_count": 1,
                "pending_review": 2,
                "approved": 0,
                "skipped": 0,
            },
            "drafts": [
                {
                    "draft_id": "draft-1",
                    "raw_text": "1. 单选题 下列哪项...",
                    "title": "下列哪项...",
                    "type": "choice",
                    "content_text": "下列哪项...",
                    "options": {"A": "关系型数据库", "B": "缓存"},
                    "answer_text": "A",
                    "analysis": "",
                    "difficulty": 2,
                    "segment_source": "rule",
                    "type_confidence": "high",
                    "boundary_confidence": "high",
                    "issues": [],
                    "review_status": "pending",
                    "review_required": True,
                }
            ],
        }
    )

    assert payload.summary.pending_review == 2
    assert payload.drafts[0].review_required is True
    assert payload.drafts[0].review_status == "pending"


def test_document_recognize_request_supports_ai_full_and_images() -> None:
    from app.questions.schemas import QuestionImportDocumentRecognizeRequest

    payload = QuestionImportDocumentRecognizeRequest.model_validate(
        {
            "file_name": "questions.docx",
            "source_format": "docx",
            "raw_text": "观察图片回答问题\n[IMAGE:image-1]",
            "analysis_mode": "ai_full",
            "images": [
                {
                    "image_id": "image-1",
                    "url": "https://example.com/image-1.png",
                    "order": 1,
                    "page": 1,
                    "alt": "示意图",
                }
            ],
        }
    )

    assert payload.analysis_mode == "ai_full"
    assert payload.images[0].image_id == "image-1"
    assert payload.images[0].page == 1


def test_detects_text_template_by_field_prefixes() -> None:
    raw_text = """
题型：单选题
题目内容：下列哪项属于关系型数据库？
答案：A
分析：MySQL 属于关系型数据库
难度：2
"""

    assert detect_import_template_mode(raw_text) == "template"


def test_does_not_misclassify_docx_question_bank_as_template() -> None:
    raw_text = """
数据库技术-题库

1.请提交今日课堂作业：
1. 提交PDM截图;
2. 提交正向工程导出的MySQL数据库脚本截图；

[答案] [难度]简单
[预期时间]

2.请提交今日课堂作业：
1. 提交无人值守超市管理系统的功能模块图;
2. 提交无人值守超市管理系统数据库的概念数据模型E-R图;

[答案] [难度]简单
[预期时间]
"""

    assert detect_import_template_mode(raw_text) == "smart"


def test_detects_bracket_template_and_parses_every_question() -> None:
    raw_text = """
[题型] 选择题
题目内容：我国首都是哪里？
A. 北京
B. 上海
C. 广州
D. 深圳
[答案] A
[解析] 北京是中国首都。
[难度] 容易

[题型] 简答题
题目内容：请简述数据库事务的 ACID 特性。
[答案] 原子性、一致性、隔离性、持久性。
[解析] ACID 是数据库事务的四个核心特性。
[难度] 中等
"""

    assert detect_import_template_mode(raw_text) == "template"

    drafts = parse_template_document(raw_text)

    assert len(drafts) == 2
    assert drafts[0].type == "choice"
    assert drafts[0].options == {"A": "北京", "B": "上海", "C": "广州", "D": "深圳"}
    assert drafts[0].answer_text == "A"
    assert drafts[0].analysis == "北京是中国首都。"
    assert drafts[0].difficulty == 1
    assert drafts[0].issues == []
    assert drafts[0].content_text == "我国首都是哪里？"
    assert drafts[1].type == "short_answer"
    assert drafts[1].answer_text == "原子性、一致性、隔离性、持久性。"
    assert drafts[1].content_text == "请简述数据库事务的 ACID 特性。"
    assert drafts[1].difficulty == 3


def test_segments_questions_by_numbering_and_type_keywords() -> None:
    raw_text = """
1. 单选题 下列哪项属于关系型数据库？
A. MySQL
B. Redis
答案：A

判断 下列说法是否正确：Redis 是关系型数据库。
答案：错误
"""

    segments = segment_question_document(raw_text)

    assert len(segments) == 2
    assert segments[0].raw_text.startswith("1.")
    assert segments[1].raw_text.startswith("判断")


def test_segments_questions_by_paragraph_blocks_and_field_lines() -> None:
    raw_text = """
1. 单选题 下列哪项属于关系型数据库？

A. MySQL
B. Redis
[答案] A
[解析] MySQL 属于关系型数据库。

2. 简答题
请简述事务的 ACID 特性。
[答案] 原子性、一致性、隔离性、持久性。
"""

    segments = segment_question_document(raw_text)

    assert len(segments) == 2
    assert "[答案] A" in segments[0].raw_text
    assert "请简述事务的 ACID 特性。" in segments[1].raw_text


def test_segments_paper_questions_by_chinese_section_and_arabic_numbered_paragraphs() -> None:
    raw_text = """
一、单项选择题

1. 下面关于数据分析说法正确的是（ ）
A. 只做统计
B. 服务决策
C. 无需清洗
D. 不能可视化

2 数据清洗的主要目的是什么（ ）
A. 删除所有数据
B. 提升数据质量
C. 增加字段数量
D. 改变业务含义

二.

3	NumPy 主要用于下面哪类计算（ ）
A. 数值计算
B. 文档排版
C. 视频剪辑
D. 网络布线
"""

    segments = segment_question_document(raw_text)

    assert len(segments) == 3
    assert segments[0].raw_text.startswith("1. 下面关于数据分析说法正确的是")
    assert segments[1].raw_text.startswith("2 数据清洗的主要目的是什么")
    assert segments[2].raw_text.startswith("3\tNumPy 主要用于下面哪类计算")
    assert all("一、" not in segment.raw_text and "二." not in segment.raw_text for segment in segments)


def test_build_draft_keeps_choice_options_when_stem_has_blank_parentheses() -> None:
    draft = build_import_draft_from_segment(
        """
1. 下面关于数据分析说法正确的是（ ）
A. 只做统计
B. 服务决策
C. 无需清洗
D. 不能可视化
"""
    )

    assert draft.type.value == "choice"
    assert draft.options == {
        "A": "只做统计",
        "B": "服务决策",
        "C": "无需清洗",
        "D": "不能可视化",
    }


def test_paper_section_heading_type_is_inherited_without_polluting_content() -> None:
    raw_text = """
一、单项选择题

1. 下面关于数据分析说法正确的是（ ）
A. 只做统计
B. 服务决策
C. 无需清洗
D. 不能可视化

二、判断题

2. NumPy 只能处理文本数据。
"""

    drafts = [
        build_import_draft_from_segment(segment.raw_text, type_hint=segment.type_hint)
        for segment in segment_question_document(raw_text)
    ]

    assert len(drafts) == 2
    assert drafts[0].type.value == "choice"
    assert drafts[0].options and drafts[0].options["B"] == "服务决策"
    assert "单项选择题" not in drafts[0].content_text
    assert drafts[1].type.value == "true_false"


def test_paper_section_splits_continuous_word_text_and_keeps_choice_options() -> None:
    raw_text = """
一、单项选择题
1. 下面关于数据分析说法正确的是（ ）
A.数据分析是数学、统计学理论结合科学的统计分析方法
B.数据分析是一种数学分析方法
C.数据分析是统计学分析方法
D.数据分析是大数据分析方法
2. 下列关于数据分析的描述，说法错误的是（ ）
A.模型优化步骤可以与分析和建模步骤同步进行
B.数据分析过程中最核心的步骤是分析与建模
C.数据分析时只能够使用数值型数据
D.广义的数据分析包括狭义数据分析和数据挖掘
3. 下列关于NumPy的说法错误的是（ ）。
A.NumPy 可快速高效处理多维数组
B.NumPy 可提供在算法之间传递数据的容器
C.NumPy 可实现线性代数运算、傅里叶变换和随机数生成
D.NumPy 不具备将 C++代码继承到 Python 的功能
4. 下列关于 pandas 说法错误的是（ ）。
A.pandas 是 Python 的数据分析核心库
B.pandas 能够快捷处理结构化数据
C.pandas 没有 NumPy 的高性能数字计算功能
D.pandas 提供复杂精细的索引功能
二、填空题
5. NumPy 的核心数据结构是______。
"""

    preprocessed = preprocess_paper_import_text(raw_text, [])
    drafts = [
        build_import_draft_from_segment(segment.raw_text, type_hint=segment.type_hint)
        for segment in segment_question_document(preprocessed)
    ]

    assert len(drafts) == 5
    assert [draft.type.value for draft in drafts[:4]] == ["choice", "choice", "choice", "choice"]
    assert drafts[0].content_text == "下面关于数据分析说法正确的是（ ）"
    assert drafts[0].options and drafts[0].options["A"].startswith("数据分析是数学")
    assert drafts[1].options and drafts[1].options["D"] == "广义的数据分析包括狭义数据分析和数据挖掘"
    assert drafts[2].content_text == "下列关于NumPy的说法错误的是（ ）。"
    assert drafts[3].options and drafts[3].options["C"] == "pandas 没有 NumPy 的高性能数字计算功能"
    assert drafts[4].type.value == "fill_in"


def test_build_import_draft_maps_ordered_list_markers_to_choice_options() -> None:
    draft = build_import_draft_from_segment(
        """
        1. 下面关于数据分析说法正确的是（ ）
        [OL] 数据分析是数学、统计学理论结合科学的统计分析方法
        [OL] 数据分析是一种数学分析方法
        [OL] 数据分析是统计学分析方法
        [OL] 数据分析是大数据分析方法
        """
    )

    assert draft.type == "choice"
    assert draft.options == {
        "A": "数据分析是数学、统计学理论结合科学的统计分析方法",
        "B": "数据分析是一种数学分析方法",
        "C": "数据分析是统计学分析方法",
        "D": "数据分析是大数据分析方法",
    }
    assert draft.content_text == "下面关于数据分析说法正确的是（ ）"


def test_build_import_draft_keeps_unordered_steps_inside_non_choice_content() -> None:
    draft = build_import_draft_from_segment(
        """
        1. 请提交今日课堂作业：
        [UL] 提交 PDM 截图
        [UL] 提交 MySQL 数据库脚本截图
        [答案]
        """
    )

    assert draft.type == "short_answer"
    assert draft.options is None
    assert "提交 PDM 截图" in draft.content_text
    assert "提交 MySQL 数据库脚本截图" in draft.content_text


def test_build_import_draft_does_not_treat_simple_stem_as_question_type_keyword() -> None:
    draft = build_import_draft_from_segment("1. 简单说明数据库事务的概念。\n答案：略")

    assert draft.type == "short_answer"
    assert draft.content_text == "简单说明数据库事务的概念。"


def test_paper_preprocess_splices_table_into_marker_position_and_does_not_split_question() -> None:
    raw_text = """
一、单项选择题
3. 设某路由器建立了如下转发表

[TABLE:1]

现共收到 5 个分组，试分别计算其下一跳。
"""
    table = QuestionImportTableInput(
        order=1,
        rows=[
            ["目的网络", "子网掩码", "下一跳"],
            ["128.96.39.0", "255.255.255.128", "接口 m0"],
            ["192.4.153.0", "255.255.255.192", "R3"],
        ],
    )

    preprocessed = preprocess_paper_import_text(raw_text, [table])

    assert "[TABLE:1]" in preprocessed
    assert "| 目的网络 | 子网掩码 | 下一跳 |" in preprocessed
    assert "| 128.96.39.0 | 255.255.255.128 | 接口 m0 |" in preprocessed
    assert preprocessed.index("设某路由器") < preprocessed.index("128.96.39.0")
    assert preprocessed.index("128.96.39.0") < preprocessed.index("现共收到")

    segments = segment_question_document(preprocessed)
    # All table rows + the question stem + the trailing sentence must remain one question.
    assert len(segments) == 1
    assert "128.96.39.0" in segments[0].raw_text
    assert "现共收到" in segments[0].raw_text


def test_paper_preprocess_drops_cover_before_first_chinese_type_heading() -> None:
    raw_text = """
江苏卫生健康职业学院 2025～2026 学年第 二 学期
《大数据分析技术》期末考试试卷（A）

1. （24年级、卫生信息管理专业）

答题时限：90 分钟    考试形式：闭卷笔试
班级________ 学号________ 姓名________ 得分________

一、单项选择题

1. 下面关于数据分析说法正确的是（ ）
A. 只做统计
B. 服务决策
C. 无需清洗
D. 不能可视化
"""

    preprocessed = preprocess_paper_import_text(raw_text, [])
    segments = segment_question_document(preprocessed)

    assert "24年级" not in preprocessed
    assert "答题时限" not in preprocessed
    assert len(segments) == 1
    assert segments[0].raw_text.startswith("1. 下面关于数据分析说法正确的是")


def test_segments_docx_style_extracted_text_into_multiple_questions() -> None:
    raw_text = """
1. 请提交今日课堂作业：
1. 提交 PDM 截图；
2. 提交 MySQL 数据库脚本截图；

要求写出截图标题，截图清晰。

[答案]
[难度] 简单
[预计时间]

2. 请提交今日课堂作业：
1. 提交无人值守超市管理系统的功能模块图；
2. 提交无人值守超市管理系统数据库的概念数据模型 E-R 图；

[答案]
[难度] 简单
"""

    segments = segment_question_document(raw_text)

    assert len(segments) == 2
    assert segments[0].raw_text.startswith("1. 请提交今日课堂作业：")
    assert segments[1].raw_text.startswith("2. 请提交今日课堂作业：")


def test_segments_multiple_questions_even_when_word_extraction_keeps_them_in_one_block() -> None:
    raw_text = """
1. 请提交今日课堂作业：
1. 提交 PDM 截图；
2. 提交 MySQL 数据库脚本截图；
要求写出截图标题，截图清晰。
[答案]
[难度] 简单
[预计时间]
2. 请提交今日课堂作业：
1. 提交无人值守超市管理系统的功能模块图；
2. 提交无人值守超市管理系统数据库的概念数据模型 E-R 图；
[答案]
[难度] 简单
"""

    segments = segment_question_document(raw_text)

    assert len(segments) == 2
    assert segments[0].raw_text.startswith("1. 请提交今日课堂作业：")
    assert segments[1].raw_text.startswith("2. 请提交今日课堂作业：")


def test_segments_real_docx_style_question_blocks_without_splitting_inner_lists() -> None:
    raw_text = """
数据库技术-题库

1.请提交今日课堂作业：

1. 提交PDM截图;
2. 提交正向工程导出的MySQL数据库脚本截图（只截图开头和结尾部分）;
3. 提交逆向工程生成的物理数据模型截图;
4. 提交MySQL Workbench创建正向工程和逆向工程截图。

要求写出截图标题，截图清晰。

[答案] [难度]简单

[预期时间]

2.请提交今日课堂作业：

1. 提交无人值守超市管理系统的功能模块图;
2. 提交无人值守超市管理系统数据库的概念数据模型E-R图;
3. 提交无人值守超市管理系统数据库的逻辑数据模型CMD图;
4. 提交无人值守超市管理系统数据库的物理数据模型PDM图;

[答案] [难度]简单

[预期时间]

3.[单选题]下列选项中,哪个是配置MySql服务器默认使用的用户

A.A,Dmin
B.scott
C.root
D.test

[答案]C [难度]简单

[预期时间]
"""

    segments = segment_question_document(raw_text)

    assert len(segments) == 3
    assert segments[0].raw_text.startswith("数据库技术-题库\n1.请提交今日课堂作业：")
    assert "1. 提交PDM截图;" in segments[0].raw_text
    assert segments[1].raw_text.startswith("2.请提交今日课堂作业：")
    assert "1. 提交无人值守超市管理系统的功能模块图;" in segments[1].raw_text
    assert segments[2].raw_text.startswith("3.[单选题]下列选项中,哪个是配置MySql服务器默认使用的用户")


def test_keeps_numbered_answer_lines_inside_same_question() -> None:
    raw_text = """
30.[简答题]简述修改MySQL的两种配置方式。

[答案]1.通过DOS命令重新配置MySQL,如 set character_set_client = gbk

2.通过my.ini文件重新配置MySQL,如修改文件 my.ini 的属性 default-character-set=gbk
[难度]困难

[预期时间]

31.[单选题]下列选项中,修改my.ini配置文件中的哪个属性可以修改字符编码

A.character-set
B.default-character-set
[答案]B
"""

    segments = segment_question_document(raw_text)

    assert len(segments) == 2
    assert "2.通过my.ini文件重新配置MySQL" in segments[0].raw_text
    assert segments[1].raw_text.startswith("31.[单选题]下列选项中,修改my.ini配置文件中的哪个属性可以修改字符编码")


def test_build_import_draft_recognizes_true_false_from_answer_tokens() -> None:
    draft = build_import_draft_from_segment(
        "判断 下列说法是否正确：Redis 是关系型数据库。\n答案：错误"
    )

    assert draft.type == "true_false"
    assert draft.answer_text == "错误"
    assert draft.type_confidence == "high"


def test_build_import_draft_marks_choice_with_missing_options_as_issue() -> None:
    draft = build_import_draft_from_segment(
        "1. 单选题 下列哪项属于关系型数据库？\nA. MySQL\n答案：A"
    )

    assert draft.type == "choice"
    assert "选择题选项不完整" in draft.issues


async def test_document_summary_flags_docx_for_manual_review_when_choice_options_still_incomplete(
    monkeypatch,
) -> None:
    from app.questions.schemas import QuestionImportDocumentRecognizeRequest
    from app.questions.service import recognize_question_document

    async def keep_draft_unchanged(draft):
        return draft

    monkeypatch.setattr("app.questions.service.complete_import_draft_with_ai", keep_draft_unchanged)

    response = await recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name="questions.docx",
            source_format="docx",
            raw_text=(
                "1. 单选题 下列哪项属于关系型数据库？\n"
                "A. MySQL\n"
                "答案：A\n\n"
                "2. 单选题 Redis 属于哪一类数据库？\n"
                "A. 关系型数据库\n"
                "答案：A"
            ),
        )
    )

    assert response.summary.total == 2
    assert response.summary.incomplete_choice_count == 2
    assert response.summary.visual_retry_recommended is True
    assert response.summary.issue_count == 2


def test_build_import_draft_collects_multiline_answer_until_next_field() -> None:
    draft = build_import_draft_from_segment(
        """
        [简答题]简述MySQL的事务隔离级别有哪些？
        [答案]
        - READ UNCOMMITTED 是事务中最低的级别，也称为脏读
        - READ COMMITTED 只能读取其它事务已经提交的内容，可以避免脏读。
        - REPEATABLE READ 是 MySQL 默认的事务隔离级别。
        - SERIALIZABLE 是事务的最高隔离级别。
        [预期时间]
        """
    )

    assert draft.answer_text is not None
    assert "READ UNCOMMITTED" in draft.answer_text
    assert "SERIALIZABLE" in draft.answer_text
    assert "[预期时间]" not in draft.answer_text


def test_build_import_draft_recognizes_inline_bracket_answer_between_fields() -> None:
    draft = build_import_draft_from_segment(
        "[判断题]在MySQL中,数据表在创建以后,就不允许对表进行修改操作。 [答案]错误 [难度]简单"
    )

    assert draft.answer_text == "错误"
    assert draft.type == "true_false"


def test_build_import_draft_does_not_keep_standalone_question_type_in_content() -> None:
    draft = build_import_draft_from_segment(
        "选择题\n我国首都是哪里？\nA. 北京\nB. 上海\n答案：A"
    )

    assert draft.type == "choice"
    assert draft.content_text == "我国首都是哪里？"


async def test_ai_full_document_recognize_merges_ai_results_with_rule_flags(
    monkeypatch,
) -> None:
    from app.questions.schemas import QuestionImportDocumentRecognizeRequest
    from app.questions.service import recognize_question_document

    async def fake_request(_prompt: str) -> dict:
        return {
            "questions": [
                {
                    "type": "choice",
                    "content_text": "我国首都是哪里？",
                    "options": {"A": "北京", "B": "上海"},
                    "answer_text": "A",
                    "analysis": "北京是中国首都。",
                    "difficulty": 2,
                    "raw_text": "1. 选择题 我国首都是哪里？",
                    "images": ["image-1"],
                }
            ]
        }

    monkeypatch.setattr("app.questions.service._request_deepseek_json", fake_request)

    response = await recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name="questions.md",
            source_format="md",
            raw_text="1. 选择题 我国首都是哪里？\n[IMAGE:image-1]\nA. 北京\nB. 上海\n[答案] A",
            analysis_mode="ai_full",
            images=[
                {
                    "image_id": "image-1",
                    "url": "https://example.com/a.png",
                    "order": 1,
                }
            ],
        )
    )

    assert response.drafts[0].segment_source == "ai_full+rule"
    assert response.drafts[0].comparison_flags == []
    assert response.drafts[0].images[0].image_id == "image-1"


async def test_ai_full_document_recognize_marks_count_mismatch(monkeypatch) -> None:
    from app.questions.schemas import QuestionImportDocumentRecognizeRequest
    from app.questions.service import recognize_question_document

    async def fake_request(_prompt: str) -> dict:
        return {
            "questions": [
                {
                    "type": "choice",
                    "content_text": "第一题",
                    "options": {"A": "甲", "B": "乙"},
                    "answer_text": "A",
                    "analysis": "",
                    "difficulty": 3,
                    "raw_text": "1. 第一题",
                    "images": [],
                }
            ]
        }

    monkeypatch.setattr("app.questions.service._request_deepseek_json", fake_request)

    response = await recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name="questions.md",
            source_format="md",
            raw_text="1. 第一题\nA. 甲\nB. 乙\n[答案] A\n\n2. 第二题\nA. 丙\nB. 丁\n[答案] B",
            analysis_mode="ai_full",
        )
    )

    assert "count_mismatch" in response.drafts[0].comparison_flags
    assert "AI识别题目数量与规则识别不一致" not in response.drafts[0].issues


async def test_document_recognize_endpoint_returns_pending_review_drafts(
    admin_client: AsyncClient,
) -> None:
    response = await admin_client.post(
        "/api/questions/import/document-recognize",
        json={
            "file_name": "questions.md",
            "source_format": "md",
            "raw_text": "1. 单选题 下列哪项属于关系型数据库？\nA. MySQL\nB. Redis\n答案：A",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "smart"
    assert data["drafts"][0]["review_status"] == "pending"
    assert data["drafts"][0]["review_required"] is True


async def test_document_recognize_endpoint_allows_school_admin_and_platform_admin(
    client: AsyncClient,
    db_session,
) -> None:
    async def build_role_client(role_name: str, username: str) -> AsyncClient:
        user = await create_user(
            db_session,
            UserCreate(
                username=username,
                email=f"{username}@example.com",
                password="pass123456",
                full_name=username,
            ),
        )
        org = Organization(name=f"{role_name} Org", type="school", is_active=True)
        db_session.add(org)
        await db_session.flush()

        role = Role(name=role_name, display_name=role_name, is_system=True)
        db_session.add(role)
        await db_session.flush()

        db_session.add(
            UserOrganization(
                user_id=user.id,
                org_id=org.id,
                role_id=role.id,
                is_primary=True,
            )
        )
        await db_session.commit()
        client.headers.update({"Authorization": f"Bearer {create_access_token(user.id, '')}"})
        return client

    for role_name in ("school_admin", "platform_admin"):
        role_client = await build_role_client(role_name, f"{role_name}_importer")
        response = await role_client.post(
            "/api/questions/import/document-recognize",
            json={
                "file_name": "questions.md",
                "source_format": "md",
                "raw_text": "[题型] 选择题\n题目内容：我国首都是哪里？\nA. 北京\nB. 上海\n[答案] A\n[难度] 容易",
            },
        )

        assert response.status_code == 200
        assert response.json()["mode"] == "template"
