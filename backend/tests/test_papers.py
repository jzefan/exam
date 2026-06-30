import pytest
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.learning.models import KnowledgePoint
from app.papers.models import Paper, PaperImportSession, PaperQuestion, PaperQuestionKnowledgeSuggestion, PaperSourceType
from app.papers.schemas import PaperCreate, PaperImportRecognizeRequest, PaperQuestionItem, PaperUpdate
from app.papers.service import (
    create_import_session_from_recognition,
    create_paper,
    get_paper_by_id,
    list_papers_for_user,
    update_paper,
)
from app.questions.models import Question, QuestionSource, QuestionType, question_knowledge_points
from app.rbac.models import Organization, Role


async def _teacher(db_session, username: str = "paper-teacher"):
    org = Organization(name=f"Org {username}", type="school", is_active=True)
    role = await db_session.scalar(select(Role).where(Role.name == "teacher"))
    if role is None:
        role = Role(name="teacher", display_name="Teacher", is_system=True)
        db_session.add(role)
    db_session.add(org)
    await db_session.flush()
    return await create_user(
        db_session,
        UserCreate(
            username=username,
            email=f"{username}@example.com",
            password="teacherpass123",
            full_name="Paper Teacher",
            role_name="teacher",
            org_id=org.id,
        ),
    )


@pytest.mark.asyncio
async def test_paper_model_links_questions_without_import_status(db_session):
    teacher = await _teacher(db_session)
    question = Question(
        type=QuestionType.CHOICE,
        title="数据库单选题",
        content={"text": "MySQL 属于哪类数据库？"},
        options={"A": "关系型", "B": "缓存"},
        answer={"correct": "A"},
        analysis=None,
        difficulty=2,
        score=10,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    paper = Paper(
        title="历史试卷 A",
        description=None,
        source_type=PaperSourceType.IMPORT.value,
        source_paper_id=None,
        root_knowledge_point_id=None,
        is_reusable=True,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([question, paper])
    await db_session.flush()
    db_session.add(PaperQuestion(paper_id=paper.id, question_id=question.id, order=0, score_override=10))
    await db_session.commit()
    db_session.expunge_all()

    saved = (await db_session.execute(select(Paper).where(Paper.id == paper.id))).scalar_one()
    assert saved.source_type == PaperSourceType.IMPORT.value
    assert not hasattr(saved, "import_status")
    assert len(saved.paper_questions) == 1


@pytest.mark.asyncio
async def test_paper_import_session_keeps_preview_without_status(db_session):
    teacher = await _teacher(db_session, username="paper-import-teacher")
    session = PaperImportSession(
        file_name="history-paper.pdf",
        source_format="pdf",
        preview_payload={"questions": [{"title": "题目 1"}]},
        created_by=teacher.id,
    )
    db_session.add(session)
    await db_session.commit()
    db_session.expunge_all()

    saved = (await db_session.execute(select(PaperImportSession).where(PaperImportSession.id == session.id))).scalar_one()
    assert saved.preview_payload["questions"][0]["title"] == "题目 1"
    assert not hasattr(saved, "status")


@pytest.mark.asyncio
async def test_paper_import_filters_header_and_answer_sheet_blocks(db_session):
    teacher = await _teacher(db_session, username="paper-import-filter-teacher")
    raw_text = """
江苏卫生健康职业学院 2025～2026 学年第二学期
《大数据分析技术》期末考试试卷（A）
答题时限：90 分钟 考试形式：闭卷笔试
班级__________ 学号__________ 姓名__________ 得分__________
得分统计表：
题号 一 二 三 四 核查人签名
得分
阅卷教师

一、单项选择题（请从 4 个备选答案中选择最适合的一项，每小题 2 分，共 50 分）
选择题答案请填写下表中！
1. 2. 3. 4. 5.
6. 7. 8. 9. 10.
11. 12. 13. 14. 15.
16. 17. 18. 19. 20.
21. 22. 23. 24. 25.

1. 数据清洗的主要目的是什么？
A. 删除所有数据
B. 提升数据质量
C. 增加字段数量
D. 改变业务含义
答案：B
"""

    _session, recognition = await create_import_session_from_recognition(
        db_session,
        user=teacher,
        request=PaperImportRecognizeRequest(file_name="paper.docx", raw_text=raw_text, source_format="docx"),
    )

    assert recognition.summary.total == 1
    assert recognition.drafts[0].content_text.startswith("数据清洗的主要目的")
    assert "江苏卫生健康职业学院" not in recognition.drafts[0].raw_text
    assert "选择题答案请填写下表中" not in recognition.drafts[0].raw_text


@pytest.mark.asyncio
async def test_create_paper_service_returns_ordered_questions(db_session):
    teacher = await _teacher(db_session, "paper-create-teacher")
    q1 = Question(
        type=QuestionType.CHOICE,
        title="题目 1",
        content={"text": "题目 1"},
        options={"A": "是", "B": "否"},
        answer={"correct": "A"},
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    q2 = Question(
        type=QuestionType.CHOICE,
        title="题目 2",
        content={"text": "题目 2"},
        options={"A": "是", "B": "否"},
        answer={"correct": "B"},
        difficulty=3,
        score=8,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([q1, q2])
    await db_session.flush()

    paper = await create_paper(
        db_session,
        PaperCreate(
            title="服务创建试卷",
            description=None,
            source_type="manual",
            root_knowledge_point_id=None,
            question_items=[
                PaperQuestionItem(question_id=q2.id, order=0, score_override=8),
                PaperQuestionItem(question_id=q1.id, order=1, score_override=5),
            ],
        ),
        user=teacher,
        is_admin=False,
    )
    await db_session.commit()

    detail = await get_paper_by_id(db_session, paper.id, user=teacher, is_admin=False)
    assert detail is not None
    assert [item.question.title for item in detail.paper_questions] == ["题目 2", "题目 1"]


@pytest.mark.asyncio
async def test_list_papers_for_user_is_owner_scoped(db_session):
    teacher = await _teacher(db_session, "paper-owner-a")
    other = await _teacher(db_session, "paper-owner-b")
    db_session.add_all(
        [
            Paper(title="我的试卷", source_type=PaperSourceType.MANUAL.value, created_by=teacher.id, owner_id=teacher.id),
            Paper(title="别人的试卷", source_type=PaperSourceType.MANUAL.value, created_by=other.id, owner_id=other.id),
        ]
    )
    await db_session.commit()

    papers, total = await list_papers_for_user(db_session, user=teacher, is_admin=False)
    assert total == 1
    assert [paper.title for paper in papers] == ["我的试卷"]


@pytest.mark.asyncio
async def test_create_paper_assigns_default_question_order_by_input_sequence(db_session):
    teacher = await _teacher(db_session, "paper-default-order")
    q1 = Question(
        type=QuestionType.CHOICE,
        title="默认顺序 1",
        content={"text": "默认顺序 1"},
        options={"A": "是", "B": "否"},
        answer={"correct": "A"},
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    q2 = Question(
        type=QuestionType.CHOICE,
        title="默认顺序 2",
        content={"text": "默认顺序 2"},
        options={"A": "是", "B": "否"},
        answer={"correct": "B"},
        difficulty=3,
        score=8,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([q1, q2])
    await db_session.flush()

    paper = await create_paper(
        db_session,
        PaperCreate(
            title="默认顺序试卷",
            question_items=[
                PaperQuestionItem(question_id=q1.id),
                PaperQuestionItem(question_id=q2.id),
            ],
        ),
        user=teacher,
        is_admin=False,
    )
    await db_session.commit()

    detail = await get_paper_by_id(db_session, paper.id, user=teacher, is_admin=False)
    assert detail is not None
    assert [(item.question.title, item.order) for item in detail.paper_questions] == [
        ("默认顺序 1", 0),
        ("默认顺序 2", 1),
    ]


@pytest.mark.asyncio
async def test_update_paper_replaces_question_collection_without_stale_items(db_session):
    teacher = await _teacher(db_session, "paper-update-teacher")
    q1 = Question(
        type=QuestionType.CHOICE,
        title="旧题目",
        content={"text": "旧题目"},
        options={"A": "是", "B": "否"},
        answer={"correct": "A"},
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    q2 = Question(
        type=QuestionType.CHOICE,
        title="新题目",
        content={"text": "新题目"},
        options={"A": "是", "B": "否"},
        answer={"correct": "B"},
        difficulty=3,
        score=8,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([q1, q2])
    await db_session.flush()
    paper = await create_paper(
        db_session,
        PaperCreate(title="更新试卷", question_items=[PaperQuestionItem(question_id=q1.id, order=0)]),
        user=teacher,
        is_admin=False,
    )

    updated = await update_paper(
        db_session,
        paper,
        PaperUpdate(question_items=[PaperQuestionItem(question_id=q2.id, order=0)]),
        user=teacher,
        is_admin=False,
    )
    await db_session.commit()

    assert [item.question.title for item in updated.paper_questions] == ["新题目"]
    detail = await get_paper_by_id(db_session, paper.id, user=teacher, is_admin=False)
    assert detail is not None
    assert [item.question.title for item in detail.paper_questions] == ["新题目"]


@pytest.mark.asyncio
async def test_create_paper_rejects_cross_owner_private_question(db_session):
    teacher = await _teacher(db_session, "paper-secure-teacher")
    other = await _teacher(db_session, "paper-secure-other")
    private_question = Question(
        type=QuestionType.CHOICE,
        title="别人的私有题目",
        content={"text": "别人的私有题目"},
        options={"A": "是", "B": "否"},
        answer={"correct": "A"},
        difficulty=2,
        score=5,
        created_by=other.id,
        owner_id=other.id,
    )
    db_session.add(private_question)
    await db_session.flush()

    with pytest.raises(ValueError, match="question"):
        await create_paper(
            db_session,
            PaperCreate(title="越权试卷", question_items=[PaperQuestionItem(question_id=private_question.id)]),
            user=teacher,
            is_admin=False,
        )


@pytest.mark.asyncio
async def test_create_paper_rejects_cross_owner_source_paper_and_root_knowledge_point(db_session):
    teacher = await _teacher(db_session, "paper-source-teacher")
    other = await _teacher(db_session, "paper-source-other")
    private_source = Paper(
        title="别人的试卷",
        source_type=PaperSourceType.MANUAL.value,
        created_by=other.id,
        owner_id=other.id,
    )
    private_kp = KnowledgePoint(
        name="别人的知识点",
        owner_id=other.id,
        visibility=VisibilityScope.PRIVATE,
    )
    db_session.add_all([private_source, private_kp])
    await db_session.flush()

    with pytest.raises(ValueError, match="source paper"):
        await create_paper(
            db_session,
            PaperCreate(title="越权源试卷", source_paper_id=private_source.id),
            user=teacher,
            is_admin=False,
        )

    with pytest.raises(ValueError, match="knowledge point"):
        await create_paper(
            db_session,
            PaperCreate(title="越权知识点", root_knowledge_point_id=private_kp.id),
            user=teacher,
            is_admin=False,
        )


@pytest.mark.asyncio
async def test_update_paper_rejects_cross_owner_paper_even_if_instance_is_passed(db_session):
    teacher = await _teacher(db_session, "paper-update-secure-teacher")
    other = await _teacher(db_session, "paper-update-secure-other")
    foreign_paper = Paper(
        title="别人的试卷",
        source_type=PaperSourceType.MANUAL.value,
        created_by=other.id,
        owner_id=other.id,
    )
    db_session.add(foreign_paper)
    await db_session.flush()

    with pytest.raises(ValueError, match="paper"):
        await update_paper(
            db_session,
            foreign_paper,
            PaperUpdate(title="不该成功"),
            user=teacher,
            is_admin=False,
        )

    await db_session.refresh(foreign_paper)
    assert foreign_paper.title == "别人的试卷"


@pytest.mark.asyncio
async def test_paper_crud_api(client, db_session):
    teacher = await _teacher(db_session, "paper-api-teacher")
    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})

    create_response = await client.post(
        "/api/papers",
        json={"title": "API 试卷", "description": None, "question_items": []},
    )
    assert create_response.status_code == 201
    paper_id = create_response.json()["id"]
    assert create_response.json()["question_count"] == 0

    list_response = await client.get("/api/papers")
    assert list_response.status_code == 200
    assert list_response.headers["x-total-count"] == "1"
    assert [item["title"] for item in list_response.json()] == ["API 试卷"]

    detail_response = await client.get(f"/api/papers/{paper_id}")
    assert detail_response.status_code == 200
    assert detail_response.json()["title"] == "API 试卷"

    patch_response = await client.patch(f"/api/papers/{paper_id}", json={"title": "改名试卷"})
    assert patch_response.status_code == 200
    assert patch_response.json()["title"] == "改名试卷"

    archive_response = await client.post(f"/api/papers/{paper_id}/archive")
    assert archive_response.status_code == 200
    assert archive_response.json()["archived_at"] is not None


@pytest.mark.asyncio
async def test_get_paper_exam_seed_returns_question_items(client, db_session):
    teacher = await _teacher(db_session, "paper-seed-teacher")
    question = Question(
        type=QuestionType.CHOICE,
        title="种子题",
        content={"text": "种子题"},
        options={"A": "是", "B": "否"},
        answer={"correct": "A"},
        difficulty=2,
        score=6,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    paper = Paper(
        title="种子试卷",
        source_type=PaperSourceType.MANUAL,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([question, paper])
    await db_session.flush()
    db_session.add(PaperQuestion(paper_id=paper.id, question_id=question.id, order=0, score_override=6))
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get(f"/api/papers/{paper.id}/exam-seed")
    assert response.status_code == 200
    payload = response.json()
    assert payload["paper_id"] == str(paper.id)
    assert payload["title"] == "种子试卷"
    assert payload["total_score"] == 6.0
    assert payload["question_items"] == [
        {"question_id": str(question.id), "order": 0, "score_override": 6.0}
    ]


@pytest.mark.asyncio
async def test_export_paper_endpoint_reuses_standard_paper_renderer(client, db_session):
    teacher = await _teacher(db_session, "paper-export-teacher")
    course = KnowledgePoint(name="数据库课程", description=None, owner_id=teacher.id)
    db_session.add(course)
    await db_session.flush()
    question = Question(
        type=QuestionType.CHOICE,
        title="多选题",
        content={"text": "哪些属于关系型数据库？"},
        options={"A": "MySQL", "B": "Redis", "C": "PostgreSQL", "D": "MongoDB"},
        answer={"correct": ["A", "C"]},
        analysis="MySQL 和 PostgreSQL 是关系型数据库。",
        difficulty=2,
        score=6,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    paper = Paper(
        title="导出试卷",
        source_type=PaperSourceType.MANUAL,
        root_knowledge_point_id=course.id,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    db_session.add_all([course, question, paper])
    await db_session.flush()
    db_session.add(PaperQuestion(paper_id=paper.id, question_id=question.id, order=0, score_override=6))
    await db_session.commit()

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.get(
        f"/api/papers/{paper.id}/export",
        params={"format": "docx", "answers": "true"},
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    assert "attachment" in response.headers["content-disposition"]
    assert "filename*=UTF-8''" in response.headers["content-disposition"]
    assert response.content[:4] == b"PK\x03\x04"

    import io
    import zipfile

    xml = zipfile.ZipFile(io.BytesIO(response.content)).read("word/document.xml").decode("utf-8")
    assert "A、C" in xml
    assert "0 分钟" not in xml


@pytest.mark.asyncio
async def test_start_paper_knowledge_recognition_targets_imported_root_only_questions(client, db_session, monkeypatch):
    teacher = await _teacher(db_session, "paper-kp-recognition-teacher")
    root = KnowledgePoint(
        name="数据分析课程",
        parent_id=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE.value,
    )
    db_session.add(root)
    await db_session.flush()
    child = KnowledgePoint(
        name="数据清洗",
        parent_id=root.id,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE.value,
    )
    imported_root_question = Question(
        type=QuestionType.CHOICE,
        title="导入根知识点题",
        content={"text": "缺失值处理通常属于哪一步？"},
        options={"A": "清洗", "B": "展示"},
        answer={"correct": "A"},
        difficulty=2,
        score=6,
        source=QuestionSource.IMPORTED.value,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    manual_root_question = Question(
        type=QuestionType.CHOICE,
        title="手动根知识点题",
        content={"text": "手动题不应自动识别"},
        options={"A": "是", "B": "否"},
        answer={"correct": "A"},
        difficulty=2,
        score=6,
        source=QuestionSource.MANUAL.value,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    imported_child_question = Question(
        type=QuestionType.CHOICE,
        title="已有子知识点题",
        content={"text": "已有具体知识点不应自动识别"},
        options={"A": "是", "B": "否"},
        answer={"correct": "A"},
        difficulty=2,
        score=6,
        source=QuestionSource.IMPORTED.value,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    paper = Paper(
        title="知识点识别试卷",
        source_type=PaperSourceType.IMPORT,
        root_knowledge_point_id=root.id,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    imported_root_question.knowledge_points = [root]
    manual_root_question.knowledge_points = [root]
    imported_child_question.knowledge_points = [child]
    db_session.add_all([child, imported_root_question, manual_root_question, imported_child_question, paper])
    await db_session.flush()
    db_session.add_all([
        PaperQuestion(paper_id=paper.id, question_id=imported_root_question.id, order=0, score_override=6),
        PaperQuestion(paper_id=paper.id, question_id=manual_root_question.id, order=1, score_override=6),
        PaperQuestion(paper_id=paper.id, question_id=imported_child_question.id, order=2, score_override=6),
    ])
    await db_session.commit()

    async def noop_background_task(**_kwargs):
        return None

    monkeypatch.setattr("app.papers.router.process_existing_question_knowledge_match_job", noop_background_task)

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(f"/api/papers/{paper.id}/knowledge-recognition")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total_count"] == 1
    assert payload["question_ids"] == [str(imported_root_question.id)]


@pytest.mark.asyncio
async def test_generate_paper_knowledge_suggestions_persists_virtual_only(client, db_session, monkeypatch):
    teacher = await _teacher(db_session, "paper-kp-suggestion-teacher")
    root = KnowledgePoint(
        name="数据分析课程",
        parent_id=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE.value,
    )
    db_session.add(root)
    await db_session.flush()
    child = KnowledgePoint(
        name="数据可视化",
        parent_id=root.id,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE.value,
    )
    outside = KnowledgePoint(
        name="市场营销",
        parent_id=None,
        owner_id=teacher.id,
        visibility=VisibilityScope.PRIVATE.value,
    )
    db_session.add_all([child, outside])
    await db_session.flush()

    root_only_question = Question(
        type=QuestionType.CHOICE,
        title="缺失值处理",
        content={"text": "缺失值处理通常属于哪一步？"},
        options={"A": "数据清洗", "B": "图表展示"},
        answer={"correct": "A"},
        difficulty=2,
        score=6,
        source=QuestionSource.IMPORTED.value,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    no_kp_question = Question(
        type=QuestionType.CHOICE,
        title="无知识点题",
        content={"text": "这道题导入后没有任何知识点。"},
        options={"A": "是", "B": "否"},
        answer={"correct": "A"},
        difficulty=2,
        score=6,
        source=QuestionSource.IMPORTED.value,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    outside_kp_question = Question(
        type=QuestionType.CHOICE,
        title="课程外知识点题",
        content={"text": "这道题错误关联到了课程外知识点。"},
        options={"A": "是", "B": "否"},
        answer={"correct": "A"},
        difficulty=2,
        score=6,
        source=QuestionSource.IMPORTED.value,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    child_question = Question(
        type=QuestionType.CHOICE,
        title="柱状图读取",
        content={"text": "柱状图适合展示什么？"},
        options={"A": "分类对比", "B": "文本朗读"},
        answer={"correct": "A"},
        difficulty=2,
        score=6,
        source=QuestionSource.IMPORTED.value,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    paper = Paper(
        title="虚拟知识点建议试卷",
        source_type=PaperSourceType.IMPORT,
        root_knowledge_point_id=root.id,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    root_only_question.knowledge_points = [root]
    outside_kp_question.knowledge_points = [outside]
    child_question.knowledge_points = [child]
    db_session.add_all([root_only_question, no_kp_question, outside_kp_question, child_question, paper])
    await db_session.flush()
    stale_suggestion = PaperQuestionKnowledgeSuggestion(
        paper_id=paper.id,
        question_id=child_question.id,
        suggested_name="旧建议",
        reason="已有子知识点后不应继续展示。",
        created_by=teacher.id,
    )
    db_session.add(stale_suggestion)
    db_session.add_all([
        PaperQuestion(paper_id=paper.id, question_id=root_only_question.id, order=0, score_override=6),
        PaperQuestion(paper_id=paper.id, question_id=no_kp_question.id, order=1, score_override=6),
        PaperQuestion(paper_id=paper.id, question_id=outside_kp_question.id, order=2, score_override=6),
        PaperQuestion(paper_id=paper.id, question_id=child_question.id, order=3, score_override=6),
    ])
    await db_session.commit()

    async def fake_deepseek_json(prompt):
        if "无知识点题" in prompt:
            return {
                "suggested_name": "导入补全",
                "reason": "题目未关联知识点。",
            }
        if "课程外知识点题" in prompt:
            return {
                "suggested_name": "课程范围校正",
                "reason": "题目未覆盖当前课程子知识点。",
            }
        return {
            "suggested_name": "数据清洗",
            "reason": "题干考查缺失值处理。",
        }

    monkeypatch.setattr("app.papers.service._request_deepseek_json", fake_deepseek_json)

    client.headers.update({"Authorization": f"Bearer {create_access_token(teacher.id, '')}"})
    response = await client.post(f"/api/papers/{paper.id}/knowledge-suggestions")

    assert response.status_code == 200
    payload = response.json()
    suggestions_by_question_id = {
        item["question_id"]: item
        for item in payload["suggestions"]
    }
    assert len(suggestions_by_question_id) == 3
    assert suggestions_by_question_id[str(root_only_question.id)]["suggested_name"] == "数据清洗"
    assert suggestions_by_question_id[str(no_kp_question.id)]["suggested_name"] == "导入补全"
    assert suggestions_by_question_id[str(outside_kp_question.id)]["suggested_name"] == "课程范围校正"
    assert all(item["suggested_name"] != "旧建议" for item in payload["suggestions"])

    detail_response = await client.get(f"/api/papers/{paper.id}")
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert len(detail["knowledge_suggestions"]) == 3
    assert all(item["suggested_name"] != "旧建议" for item in detail["knowledge_suggestions"])

    kp_rows = (
        await db_session.execute(
            select(question_knowledge_points.c.knowledge_point_id).where(
                question_knowledge_points.c.question_id == root_only_question.id
            )
        )
    ).scalars().all()
    assert kp_rows == [root.id]
    suggestion_count = await db_session.scalar(select(PaperQuestionKnowledgeSuggestion))
    assert suggestion_count is not None
    assert stale_suggestion.deleted_at is not None


@pytest.mark.asyncio
async def test_pick_existing_question_stays_within_course_scope(db_session):
    """AI 生成新试卷复用题库题时，只能取本课程范围内的题，绝不串到其它课程。"""
    from types import SimpleNamespace

    from app.papers.service import _pick_existing_question_for_slot

    teacher = await _teacher(db_session, "paper-scope-teacher")
    course_kp = KnowledgePoint(
        name="计算机网络", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE
    )
    other_kp = KnowledgePoint(
        name="市场营销", owner_id=teacher.id, visibility=VisibilityScope.PRIVATE
    )
    db_session.add_all([course_kp, other_kp])
    await db_session.flush()

    source_q = Question(
        type=QuestionType.CHOICE,
        title="源题",
        content={"text": "TCP 三次握手的作用是什么"},
        options={"A": "建立连接", "B": "释放连接"},
        answer={"correct": "A"},
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    off_topic = Question(
        type=QuestionType.CHOICE,
        title="无关题",
        content={"text": "市场营销 4P 不包括以下哪一项"},
        options={"A": "价格", "B": "天气"},
        answer={"correct": "B"},
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    source_q.knowledge_points = [course_kp]
    off_topic.knowledge_points = [other_kp]
    db_session.add_all([source_q, off_topic])
    await db_session.flush()

    # 选题器只读 slot.source_item / question_type / knowledge_point_ids，用轻量对象即可。
    slot = SimpleNamespace(
        source_item=SimpleNamespace(question=source_q, question_id=source_q.id, order=0),
        question_type="choice",
        knowledge_point_ids=[course_kp.id],
    )

    # 仅有的候选是挂在其它课程(market)上的无关题 → 被课程范围过滤，不应选中。
    picked = await _pick_existing_question_for_slot(
        db_session,
        slot,
        excluded_question_ids={source_q.id},
        selected_questions=[],
        user=teacher,
        is_admin=False,
        course_scope_kp_ids={course_kp.id},
    )
    assert picked is None

    # 课程内新增一道同类型题 → 现在能选到它（且绝不是其它课程的题）。
    in_course = Question(
        type=QuestionType.CHOICE,
        title="课程内另一题",
        content={"text": "子网掩码 255.255.255.0 对应的前缀长度是"},
        options={"A": "/24", "B": "/16"},
        answer={"correct": "A"},
        difficulty=2,
        score=5,
        created_by=teacher.id,
        owner_id=teacher.id,
    )
    in_course.knowledge_points = [course_kp]
    db_session.add(in_course)
    await db_session.flush()

    picked2 = await _pick_existing_question_for_slot(
        db_session,
        slot,
        excluded_question_ids={source_q.id},
        selected_questions=[],
        user=teacher,
        is_admin=False,
        course_scope_kp_ids={course_kp.id},
    )
    assert picked2 is not None
    assert picked2.id == in_course.id
