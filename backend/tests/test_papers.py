import pytest
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.security import create_access_token
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.learning.models import KnowledgePoint
from app.papers.models import Paper, PaperImportSession, PaperQuestion, PaperSourceType
from app.papers.schemas import PaperCreate, PaperImportRecognizeRequest, PaperQuestionItem, PaperUpdate
from app.papers.service import (
    create_import_session_from_recognition,
    create_paper,
    get_paper_by_id,
    list_papers_for_user,
    update_paper,
)
from app.questions.models import Question, QuestionType
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
