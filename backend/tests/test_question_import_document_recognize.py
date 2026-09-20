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


def test_split_questions_glued_after_answers_keeps_ip_addresses_intact() -> None:
    from app.questions.service import split_questions_glued_after_answers

    glued = "答案：B 知识点：网络基础 难度层次：易 29. 语义分割与实例分割的主要区别是()\nA. 更快\n答案：B"
    split = split_questions_glued_after_answers(glued)

    assert "\n29. 语义分割与实例分割的主要区别是()" in split
    # 形如 IP 的「数字.数字」不能被误判成新题
    ip_text = "答案：A 参考 '128.96.39.0' 属于 B 类地址"
    assert split_questions_glued_after_answers(ip_text) == ip_text


def test_reorder_drafts_matches_document_order_reference() -> None:
    from app.questions.service import reorder_drafts_by_document_position

    first = build_import_draft_from_segment("第一题题干内容？\nA. 甲\nB. 乙\n答案：A")
    second = build_import_draft_from_segment("第二题题干内容？\nA. 甲\nB. 乙\n答案：B")
    third = build_import_draft_from_segment("第三题题干内容？\nA. 甲\nB. 乙\n答案：C")

    # 提取时表格内容排在文末，识别顺序为 1/2/3；文档顺序参考文本是 3/1/2
    reference = "第三题题干内容？\nA. 甲\nB. 乙\n答案：C\n第一题题干内容？\n第二题题干内容？"

    ordered = reorder_drafts_by_document_position([first, second, third], reference)

    assert [draft.content_text for draft in ordered] == [
        "第三题题干内容？",
        "第一题题干内容？",
        "第二题题干内容？",
    ]


def test_reorder_drafts_keeps_unmatched_drafts_at_the_end() -> None:
    from app.questions.service import reorder_drafts_by_document_position

    matched = build_import_draft_from_segment("能匹配到的题干？\nA. 甲\nB. 乙\n答案：A")
    unmatched = build_import_draft_from_segment("完全找不到的题干？\nA. 甲\nB. 乙\n答案：B")

    ordered = reorder_drafts_by_document_position([matched, unmatched], "能匹配到的题干？")

    assert [draft.content_text for draft in ordered] == ["能匹配到的题干？", "完全找不到的题干？"]


async def test_chunks_that_return_too_few_questions_are_split_and_retried(monkeypatch) -> None:
    """模型对某个分块少返回题目时必须拆分重识别，不能静默丢题。"""
    from app.questions.schemas import QuestionImportDocumentRecognizeRequest
    from app.questions.service import recognize_question_document

    calls: list[int] = []
    produced_counter = 0

    async def fake_request(prompt: str) -> list[dict]:
        nonlocal produced_counter
        body = prompt.rsplit("文本：", 1)[-1]
        marked = body.count("[Q]")
        calls.append(marked)
        # 模拟模型漏题：非常密集的分块（>20 题）只返回一半；拆小后恢复正常
        produced = marked if marked <= 20 else max(1, marked // 2)
        questions = []
        for _ in range(produced):
            produced_counter += 1
            questions.append(
                {
                    "type": "choice",
                    "content_text": f"第 {produced_counter} 题题干？",
                    "options": {"A": "甲", "B": "乙"},
                    "answer_text": "A",
                    "analysis": "",
                    "difficulty": 3,
                    "raw_text": f"第 {produced_counter} 题题干？",
                    "images": [],
                }
            )
        return questions

    monkeypatch.setattr("app.questions.service._request_doc_recognition_questions", fake_request)

    blocks = [
        f"{index}. 第 {index} 题题干？\nA. 甲\nB. 乙\n答案：A" for index in range(1, 41)
    ]
    response = await recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name="large.md",
            source_format="md",
            raw_text="\n".join(blocks),
            analysis_mode="ai_full",
            import_context="paper",
        )
    )

    assert calls and calls[0] > 10, "首个分块应包含多道题，用于触发漏题分支"
    assert len(calls) > 1, "漏题分块必须被拆分重试"
    assert len(response.drafts) == 40


def _image_only_pdf_bytes(pages: int = 1) -> bytes:
    """Build a PDF whose pages are pure images (no text layer) — a scanned paper."""
    import io

    from PIL import Image, ImageDraw

    pdf_pages = []
    for index in range(pages):
        image = Image.new("RGB", (600, 800), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((40, 40, 560, 760), outline="black", width=2)
        draw.text((60, 60), f"page {index + 1}", fill="black")
        pdf_pages.append(image)
    buffer = io.BytesIO()
    pdf_pages[0].save(buffer, format="PDF", save_all=True, append_images=pdf_pages[1:])
    return buffer.getvalue()


def _text_pdf_bytes(
    text: str = "Overview of Python functions and modules used across the whole course material.",
) -> bytes:
    import io

    from reportlab.pdfgen import canvas

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer)
    pdf.drawString(72, 720, text)
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


async def test_scanned_pdf_without_text_layer_falls_back_to_page_image_vision(monkeypatch, tmp_path) -> None:
    """扫描件（无文本层）必须整页渲染后交给视觉模型，而不是报「未提取到文本内容」。"""
    from app.questions import service

    monkeypatch.setattr(service, "_IMG_UPLOAD_DIR", tmp_path)
    calls: list[list[service.QuestionImportImageInput]] = []

    async def fake_vision_jsonl(*, images, prompt):
        calls.append(list(images))
        assert "知识点" in prompt
        return (
            [
                {
                    "type": "choice",
                    "content_text": "1. 题干",
                    "options": {"A": "甲", "B": "乙"},
                    "answer_text": "A",
                    "analysis": "",
                    "difficulty": 2,
                    "difficulty_label": "易",
                    "knowledge_points": ["人工智能信息技术基础"],
                    "images": [],
                }
            ],
            "stop",
        )

    monkeypatch.setattr(service, "_request_vision_jsonl", fake_vision_jsonl)

    response = await service.recognize_pdf_with_ai(_image_only_pdf_bytes(), "scan.pdf")

    assert response.mode == service.ImportRecognitionMode.VISUAL
    assert len(response.drafts) == 1
    draft = response.drafts[0]
    assert draft.difficulty == 2
    assert draft.recognized_knowledge_points == ["人工智能信息技术基础"]
    assert len(calls) == 1
    assert [image.image_id for image in calls[0]] == ["page-1"]
    # 页面图落盘保存（不把 base64 塞进草稿/会话），识别时再内联成 data URL。
    assert calls[0][0].url.startswith("/api/uploads/files/")
    assert (tmp_path / calls[0][0].url.rsplit("/", 1)[-1]).is_file()


async def test_scanned_pdf_pages_are_batched_for_vision(monkeypatch, tmp_path) -> None:
    """长扫描件按每批若干页送视觉模型，避免单次请求过大导致尾部题目被截断。"""
    from app.questions import service
    from app.questions.schemas import QuestionImportImageInput

    monkeypatch.setattr(service, "_IMG_UPLOAD_DIR", tmp_path)
    page_images = [
        QuestionImportImageInput(
            image_id=f"page-{index}",
            url=f"/api/uploads/files/page-{index}.jpg",
            order=index,
            page=index,
        )
        for index in range(1, 9)
    ]
    monkeypatch.setattr(service, "_render_pdf_pages_to_images", lambda file_bytes: page_images)

    batches: list[int] = []

    async def fake_vision_jsonl(*, images, prompt):
        batches.append(len(images))
        return [], "stop"

    monkeypatch.setattr(service, "_request_vision_jsonl", fake_vision_jsonl)

    await service.recognize_pdf_with_ai(_image_only_pdf_bytes(), "scan.pdf")

    assert sorted(batches) == [2, 3, 3]


async def test_truncated_vision_batch_is_split_and_retried(monkeypatch) -> None:
    """视觉输出被 max_tokens 截断（finish_reason=length）时必须二分重识别，不能丢尾部题目。"""
    from app.questions import service
    from app.questions.schemas import QuestionImportImageInput

    pages = [
        QuestionImportImageInput(image_id=f"page-{index}", url=f"/api/uploads/files/p{index}.jpg", order=index)
        for index in range(1, 7)
    ]
    calls: list[int] = []

    async def fake_vision_jsonl(*, images, prompt):
        calls.append(len(images))
        if len(images) > 1:
            return [], "length"
        return (
            [
                {
                    "type": "true_false",
                    "content_text": f"{images[0].image_id} 题干",
                    "options": None,
                    "answer_text": "正确",
                    "analysis": "",
                    "difficulty": 3,
                    "difficulty_label": "中",
                    "knowledge_points": ["知识点"],
                    "images": [],
                }
            ],
            "stop",
        )

    monkeypatch.setattr(service, "_request_vision_jsonl", fake_vision_jsonl)

    drafts = await service._recognize_vision_batch(pages)

    # 6 → 3+3 → (2+1)×2 → (1+1)×4，共 11 次调用，最终每页单独识别
    assert sorted(calls) == [1, 1, 1, 1, 1, 1, 2, 2, 3, 3, 6]
    assert len(drafts) == 6


async def test_pdf_with_text_layer_keeps_the_text_pipeline(monkeypatch) -> None:
    from app.questions import service
    from app.questions.schemas import QuestionImportDocumentRecognizeResponse

    async def unexpected_vision(**kwargs):
        raise AssertionError("有文本层的 PDF 不应走视觉识别")

    async def fake_text_pipeline(**kwargs):
        return QuestionImportDocumentRecognizeResponse(
            mode="smart",
            summary={
                "total": 0,
                "high_confidence": 0,
                "medium_confidence": 0,
                "low_confidence": 0,
                "issue_count": 0,
                "pending_review": 0,
                "approved": 0,
                "skipped": 0,
            },
            drafts=[],
        )

    monkeypatch.setattr(service, "_request_vision_jsonl", unexpected_vision)
    monkeypatch.setattr(service, "_recognize_full_text_with_ai", fake_text_pipeline)

    response = await service.recognize_pdf_with_ai(_text_pdf_bytes(), "text.pdf")

    assert response.mode == service.ImportRecognitionMode.SMART


def test_ensure_image_data_url_inlines_server_upload_files(monkeypatch, tmp_path) -> None:
    import base64

    from app.questions import service

    monkeypatch.setattr(service, "_IMG_UPLOAD_DIR", tmp_path)
    (tmp_path / "page.jpg").write_bytes(b"\xff\xd8\xff\xe0fake-jpeg")

    data_url = service._ensure_image_data_url("/api/uploads/files/page.jpg?x=1")

    assert data_url.startswith("data:image/jpeg;base64,")
    assert base64.b64encode(b"\xff\xd8\xff\xe0fake-jpeg").decode() in data_url


def test_difficulty_label_maps_to_one_to_five_scale() -> None:
    from app.questions.service import _difficulty_from_label

    assert _difficulty_from_label("易") == 2
    assert _difficulty_from_label("难度层次：中") == 3
    assert _difficulty_from_label("难") == 4
    assert _difficulty_from_label("较难") == 4
    assert _difficulty_from_label("很难") == 5
    assert _difficulty_from_label("很容易") == 1
    assert _difficulty_from_label("") is None
    assert _difficulty_from_label(None) is None


def test_compact_jsonl_keeps_difficulty_and_knowledge_points() -> None:
    from app.questions.service import _parse_doc_recognition_jsonl, _validate_ai_document_questions

    questions = _parse_doc_recognition_jsonl(
        '{"t":"choice","c":"人工智能的英文缩写是()","o":{"A":"AI","B":"IT"},"a":"A","an":"",'
        '"d":4,"dl":"难","kps":["人工智能信息技术基础","  ｜ 重复项 "],"imgs":[]}\n'
        '{"t":"true_false","c":"递归函数必须要有终止条件。","o":null,"a":"正确","an":"","d":3,"dl":"中","kps":["函数"],"imgs":[]}'
    )
    validated = _validate_ai_document_questions({"questions": questions})

    # 原文标注的难度文字优先于模型给出的数字
    assert validated[0]["difficulty"] == 4
    assert validated[0]["knowledge_points"] == ["人工智能信息技术基础", "重复项"]
    assert validated[1]["difficulty"] == 3
    assert validated[1]["knowledge_points"] == ["函数"]


def _vision_drafts(numbers: list[int], options: dict[str, str] | None = None, qtype: str = "true_false"):
    from app.questions.schemas import QuestionImportDraft

    return [
        QuestionImportDraft(
            draft_id=f"q{number}",
            raw_text="",
            title=f"第 {number} 题",
            type=qtype,
            content_text=f"第 {number} 题",
            options=options,
            answer_text="正确",
            segment_source="ai_full",
            type_confidence="high",
            boundary_confidence="medium",
            question_number=number,
        )
        for number in numbers
    ]


async def test_vision_batch_with_question_number_gap_is_split(monkeypatch) -> None:
    """模型漏掉题号（1,2,4）时必须二分重识别，不能接受缺题的结果。"""
    from app.questions import service
    from app.questions.schemas import QuestionImportImageInput

    pages = [
        QuestionImportImageInput(image_id=f"page-{index}", url=f"/u/{index}.jpg", order=index)
        for index in range(1, 3)
    ]
    calls: list[int] = []

    async def fake_vision_jsonl(*, images, prompt):
        calls.append(len(images))
        if len(images) > 1:
            numbers = [1, 2, 4]  # 模型漏掉了第 3 题
        else:
            numbers = [int(images[0].image_id.rsplit("-", 1)[-1])]
        questions = [
            {"type": "true_false", "content_text": "题", "answer_text": "正确", "question_number": number}
            for number in numbers
        ]
        return questions, "stop"

    monkeypatch.setattr(service, "_request_vision_jsonl", fake_vision_jsonl)

    drafts = await service._recognize_vision_batch(pages)

    assert calls[0] == 2 and len(calls) > 1
    assert [draft.question_number for draft in drafts] == [1, 2]


async def test_vision_boundary_gap_is_repaired_from_boundary_pages() -> None:
    """批与批之间的题号断层要重新识别边界两页并插回原位。"""
    from app.questions import service
    from app.questions.schemas import QuestionImportImageInput

    pages = [
        QuestionImportImageInput(image_id=f"page-{index}", url=f"/u/{index}.jpg", order=index)
        for index in range(1, 5)
    ]
    batches = [pages[:2], pages[2:]]
    batch_results = [_vision_drafts([1, 2]), _vision_drafts([5, 6])]
    repaired_calls: list[list[str]] = []

    async def fake_recognize_batch(batch):
        repaired_calls.append([page.image_id for page in batch])
        return _vision_drafts([3, 4])

    await service._repair_vision_batch_boundaries(
        batches,
        batch_results,
        recognition_prompt=None,
        recognize_batch=fake_recognize_batch,
    )

    assert repaired_calls == [["page-2", "page-3"]]
    assert [draft.question_number for draft in batch_results[1]] == [3, 4, 5, 6]
    assert [draft.question_number for group in batch_results for draft in group] == [1, 2, 3, 4, 5, 6]


def test_vision_result_score_prefers_more_questions_then_complete_options() -> None:
    from app.questions.service import _vision_result_score

    # 题目数优先：2 题（含选项缺失）优于 1 题（选项完整）
    assert _vision_result_score(
        _vision_drafts([1, 2], {"A": "甲"}, qtype="choice")
    ) > _vision_result_score(_vision_drafts([1], {"A": "甲", "B": "乙"}, qtype="choice"))
    # 题目数相同时，选项缺失更少者更优
    assert _vision_result_score(
        _vision_drafts([1], {"A": "甲", "B": "乙"}, qtype="choice")
    ) > _vision_result_score(_vision_drafts([1], {"A": "甲"}, qtype="choice"))


# ============================================================
# 标准模板直接走正则解析，不调用大模型
# ============================================================

STANDARD_TEMPLATE_MD = """# 题目导入标准模板

难度映射：
- 容易 = 1
- 较易 = 2
- 中等 = 3
- 较难 = 4
- 很难 = 5

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


def test_standard_template_document_detected_by_field_prefixes() -> None:
    from app.questions.service import is_standard_template_document

    assert is_standard_template_document(STANDARD_TEMPLATE_MD) is True
    # 说明性段落（标题、难度映射表）不含字段，不影响判定
    assert is_standard_template_document("说明：这是一份题库。\n\n" + STANDARD_TEMPLATE_MD) is True
    # 缺答案 → 不能纯规则解析
    assert is_standard_template_document(
        "[题型] 选择题\n题目内容：我国首都是哪里？\nA. 北京\nB. 上海\n"
    ) is False
    # 缺题型 → 不能纯规则解析
    assert is_standard_template_document("题目内容：我国首都是哪里？\n[答案] A\n") is False
    # 只有字段前缀、没有题型的文档（旧版题库导出）不能被误判为模板
    assert (
        is_standard_template_document(
            "1.请提交今日课堂作业：\n1. 提交PDM截图;\n[答案] [难度]简单\n[预期时间]\n"
        )
        is False
    )


async def test_standard_template_md_skips_ai_in_ai_full_mode(monkeypatch) -> None:
    """标准模板 md 即便请求 ai_full，也不应调用大模型。"""
    from app.questions.schemas import QuestionImportDocumentRecognizeRequest
    from app.questions import service as question_service

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("标准模板不应调用大模型")

    monkeypatch.setattr(question_service, "recognize_question_document_with_ai", fail_if_called)
    monkeypatch.setattr(question_service, "_recognize_paper_document_with_ai", fail_if_called)
    monkeypatch.setattr(question_service, "complete_import_draft_with_ai", fail_if_called)

    response = await question_service.recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name="template.md",
            source_format="md",
            raw_text=STANDARD_TEMPLATE_MD,
            analysis_mode="ai_full",
        )
    )

    assert response.mode == "template"
    assert [draft.segment_source for draft in response.drafts] == ["template", "template"]
    assert response.summary.total == 2
    assert response.drafts[0].type == "choice"
    assert response.drafts[0].options == {"A": "北京", "B": "上海", "C": "广州", "D": "深圳"}
    assert response.drafts[0].answer_text == "A"
    assert response.drafts[0].analysis == "北京是中国首都。"
    assert response.drafts[0].difficulty == 1
    assert response.drafts[1].type == "short_answer"
    assert response.drafts[1].answer_text == "原子性、一致性、隔离性、持久性。"


async def test_standard_template_md_skips_ai_for_paper_import_context(monkeypatch) -> None:
    """课程详情的试卷导入（import_context=paper）同样跳过 AI。"""
    from app.questions.schemas import QuestionImportDocumentRecognizeRequest
    from app.questions import service as question_service

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("标准模板不应调用大模型")

    monkeypatch.setattr(question_service, "recognize_question_document_with_ai", fail_if_called)
    monkeypatch.setattr(question_service, "_recognize_paper_document_with_ai", fail_if_called)
    monkeypatch.setattr(question_service, "complete_import_draft_with_ai", fail_if_called)

    response = await question_service.recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name="template.md",
            source_format="md",
            raw_text=STANDARD_TEMPLATE_MD,
            analysis_mode="ai_full",
            import_context="paper",
        )
    )

    assert response.mode == "template"
    assert response.summary.total == 2


async def test_standard_template_md_respects_force_ai(monkeypatch) -> None:
    """页面上的「AI 重新识别」带 force_ai，仍然走智能识别。"""
    from app.questions.schemas import QuestionImportDocumentRecognizeRequest
    from app.questions import service as question_service

    calls: list[str] = []

    async def fake_ai(*_args, **_kwargs):
        calls.append("ai")
        return []

    monkeypatch.setattr(question_service, "recognize_question_document_with_ai", fake_ai)

    await question_service.recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name="template.md",
            source_format="md",
            raw_text=STANDARD_TEMPLATE_MD,
            analysis_mode="ai_full",
            force_ai=True,
        )
    )

    assert calls == ["ai"]


async def test_template_block_missing_answer_falls_back_to_ai(monkeypatch) -> None:
    """只要有一题缺答案，就不能纯规则解析，仍走智能识别。"""
    from app.questions.schemas import QuestionImportDocumentRecognizeRequest
    from app.questions import service as question_service

    raw_text = (
        "[题型] 选择题\n题目内容：我国首都是哪里？\nA. 北京\nB. 上海\n[答案] A\n\n"
        "[题型] 选择题\n题目内容：下列哪项属于关系型数据库？\nA. MySQL\nB. Redis\n"
    )
    calls: list[str] = []

    async def fake_ai(*_args, **_kwargs):
        calls.append("ai")
        return []

    monkeypatch.setattr(question_service, "recognize_question_document_with_ai", fake_ai)

    await question_service.recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name="partial.md",
            source_format="md",
            raw_text=raw_text,
            analysis_mode="ai_full",
        )
    )

    assert calls == ["ai"]


async def test_document_recognize_endpoint_parses_standard_template_without_ai(
    admin_client: AsyncClient,
) -> None:
    """课程详情-题目导入：标准模板 md 由后端规则解析，不依赖大模型可用性。"""
    response = await admin_client.post(
        "/api/questions/import/document-recognize",
        json={
            "file_name": "template.md",
            "source_format": "md",
            "raw_text": STANDARD_TEMPLATE_MD,
            "analysis_mode": "ai_full",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "template"
    assert data["summary"]["total"] == 2
    assert data["drafts"][0]["options"] == {
        "A": "北京",
        "B": "上海",
        "C": "广州",
        "D": "深圳",
    }
    assert data["drafts"][0]["answer_text"] == "A"
    assert data["drafts"][0]["analysis"] == "北京是中国首都。"


async def test_paper_import_endpoint_parses_standard_template_without_ai(
    admin_client: AsyncClient,
) -> None:
    """课程详情-试卷导入：标准模板 md 同样由规则解析。"""
    response = await admin_client.post(
        "/api/papers/import/recognize",
        json={
            "file_name": "template.md",
            "source_format": "md",
            "raw_text": STANDARD_TEMPLATE_MD,
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data["mode"] == "template"
    assert data["summary"]["total"] == 2
    assert data["drafts"][0]["answer_text"] == "A"


# 从网页/Word 导出复制来的题库常见 `&#x20;`（空格实体）残留：它贴在行首会把
# 整行 `[答案]` 字段顶掉，贴在值尾会把垃圾字符带进答案。
HTML_ENTITY_TEMPLATE_MD = (
    "[题型] 判断题\n"
    "题目内容：K均值聚类算法中 K 值的选择对聚类结果没有重要影响。\n"
    "[答案] 错误&#x20;\n"
    "[解析] K 值选择对聚类结果有重要影响，常用肘部法则确定。\n"
    "[难度] 中等\n"
    "\n"
    "[题型] 多选题&#x20;\n"
    "题目内容：机器人控制的主要方式包括（）\n"
    "A. 纯位置控制\n"
    "B. 阻抗控制\n"
    "C. 导纳控制\n"
    "D. 力位混合控制\n"
    "&#x20;[答案] BCD\n"
    "&#x20;[解析] 四种都是机器人控制的主要方式。\n"
    "[难度] 很难\n"
)


async def test_html_entity_artifacts_do_not_break_template_parsing(monkeypatch) -> None:
    """`&#x20;` 残留不应让模板判定失败，也不应污染答案。

    回归用例覆盖两个真实缺陷：
    1. `&#x20;[答案] BCD` 行首带实体 → 该行字段识别不到 → 一道题被判「缺答案」，
       整篇 250 道因此放弃规则解析、退回 AI 重新切题（丢题的直接原因）。
    2. `错误&#x20;` 尾随实体 → 判断题答案变成 ``错误&#x20;``，判分对不上。
    3. 题干里的「K 值的选择」含「选择」二字，不能因此把判断题判成选择题。
    """
    from app.questions.schemas import QuestionImportDocumentRecognizeRequest
    from app.questions import service as question_service

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("标准模板不应调用大模型")

    monkeypatch.setattr(question_service, "recognize_question_document_with_ai", fail_if_called)
    monkeypatch.setattr(question_service, "_recognize_paper_document_with_ai", fail_if_called)
    monkeypatch.setattr(question_service, "complete_import_draft_with_ai", fail_if_called)

    response = await question_service.recognize_question_document(
        QuestionImportDocumentRecognizeRequest(
            file_name="pa2.md",
            source_format="md",
            raw_text=HTML_ENTITY_TEMPLATE_MD,
            analysis_mode="ai_full",
        )
    )

    assert response.mode == "template"
    assert [draft.type.value for draft in response.drafts] == ["true_false", "choice"]
    assert response.drafts[0].answer_text == "错误"
    assert response.drafts[0].content_text == "K均值聚类算法中 K 值的选择对聚类结果没有重要影响。"
    assert response.drafts[1].type.value == "choice"
    assert response.drafts[1].answer_text == "BCD"
    assert response.drafts[1].content_text == "机器人控制的主要方式包括（）"
    assert response.drafts[1].options == {
        "A": "纯位置控制",
        "B": "阻抗控制",
        "C": "导纳控制",
        "D": "力位混合控制",
    }
    assert response.summary.issue_count == 0


def test_template_draft_keeps_declared_type_when_stem_contains_type_word() -> None:
    """题干含「选择」等题型词时，仍以「题型」字段声明为准。"""
    drafts = parse_template_document(
        "[题型] 判断题\n"
        "题目内容：K 值的选择对聚类结果没有重要影响。\n"
        "[答案] 错误\n"
        "[难度] 中等\n"
    )

    assert len(drafts) == 1
    assert drafts[0].type.value == "true_false"
    assert drafts[0].issues == []


def test_markdown_rule_line_is_not_question_content() -> None:
    """Markdown 分隔线 `***` / `---` 是排版装饰，不能混进题干。"""
    drafts = parse_template_document(
        "[题型] 多选题\n"
        "题目内容：机器人控制的主要方式包括（）\n"
        "A. 纯位置控制\n"
        "B. 阻抗控制\n"
        "[答案] BCD\n"
        "***\n"
        "[难度] 很难\n"
        "---\n"
        "[题型] 判断题\n"
        "题目内容：AI 系统由数据驱动。\n"
        "[答案] 正确\n"
    )

    assert len(drafts) == 2
    assert drafts[0].content_text == "机器人控制的主要方式包括（）"
    assert drafts[1].content_text == "AI 系统由数据驱动。"


def test_template_gate_tolerates_a_few_incomplete_blocks() -> None:
    """个别题字段破损不能把整篇文档推回 AI。

    250 道里 1 道缺答案（复制粘贴残留）曾让整篇退回智能识别，结果丢 11 道题。
    """
    from app.questions.service import is_standard_template_document

    blocks = [
        "[题型] 选择题\n题目内容：第 {} 题\nA. 甲\nB. 乙\n[答案] A\n[难度] 容易".format(i)
        for i in range(1, 11)
    ]
    broken = "[题型] 多选题\n题目内容：第 11 题\nA. 甲\nB. 乙"
    raw_text = "\n\n".join([*blocks, broken])

    assert is_standard_template_document(raw_text) is True

    # 破损比例过高（2 道里 1 道）时仍然回退智能识别
    assert (
        is_standard_template_document(f"{blocks[0]}\n\n{broken}") is False
    )


def test_template_document_chunks_at_field_headers() -> None:
    """模板文档按 `[题型]` 断块，且期望题数可被统计（漏题重试才生效）。"""
    from app.questions.service import (
        _normalize_question_boundaries,
        _split_text_at_question_boundaries,
        _TEMPLATE_BLOCK_START_RE,
    )

    raw_text = "\n\n".join(
        f"[题型] 选择题\n题目内容：第 {i} 题\nA. 甲\nB. 乙\n[答案] A\n[解析] 解析 {i}\n[难度] 容易"
        for i in range(1, 201)
    )

    chunks = _split_text_at_question_boundaries(raw_text)

    assert len(chunks) > 1
    assert all(chunk.lstrip().startswith("[题型]") for chunk in chunks)
    expected_questions = sum(
        max(
            _normalize_question_boundaries(chunk).count("[Q]"),
            len(_TEMPLATE_BLOCK_START_RE.findall(chunk)),
        )
        for chunk in chunks
    )
    assert expected_questions == 200


