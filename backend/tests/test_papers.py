import pytest
from sqlalchemy import select

from app.auth.schemas import UserCreate
from app.auth.service import create_user
from app.common.data_visibility import VisibilityScope
from app.learning.models import KnowledgePoint
from app.papers.models import Paper, PaperImportSession, PaperQuestion, PaperSourceType
from app.papers.schemas import PaperCreate, PaperQuestionItem, PaperUpdate
from app.papers.service import create_paper, get_paper_by_id, list_papers_for_user, update_paper
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
